/**
 * Suggestion Service
 * Next-run suggestions: almost complete, nearest gaps, milestone, clusters.
 * Homepage: one primary + alternates with cooldownKey, reason, focus (bbox, streetIds, startPoint).
 */

import prisma from "../lib/prisma.js";
import { getProjectById, getProjectMapData } from "./project.service.js";
import { getMapStreets, getGeometriesInArea } from "./map.service.js";
import { pointToLineDistance } from "./geo.service.js";
import { getStreak } from "./streak.service.js";
import { getNextMilestone } from "./milestone.service.js";
import type { ProjectMapStreet } from "../types/project.types.js";
import type { MapStreet, MapStreetsResponse } from "../types/map.types.js";
import type { StreakData } from "./streak.service.js";
import type { MilestoneWithProgress } from "../types/milestone.types.js";
import type { OsmStreet } from "../types/run.types.js";

/** Homepage suggestion shape (one primary action + alternates) */
export interface HomepageSuggestion {
  type:
    | "quick_win"
    | "nearby_cluster"
    | "explore"
    | "milestone_push"
    | "streak_saver"
    | "repeat_street"
    | "cluster";
  title: string;
  shortCopy: string;
  cooldownKey: string;
  reason: string;
  clusterStats?: {
    newStreets: number;
    toFinish: number;
    totalDistanceM: number;
    estimatedDistanceM: number;
    streetCount: number;
  };
  focus: {
    bbox: [number, number, number, number];
    streetIds?: number[];
    startPoint?: { lat: number; lng: number };
  };
}

export interface HomepageSuggestionsResult {
  primary: HomepageSuggestion | null;
  alternates: HomepageSuggestion[];
}

/** Result of getHomepageSuggestions when area context is used; includes map data to avoid a second GET /map/streets. */
export type HomepageSuggestionsWithMap = HomepageSuggestionsResult & {
  mapStreetsResponse?: MapStreetsResponse;
  /** Same milestone as used for milestone_push suggestions (single fetch for homepage payload). */
  nextMilestone: MilestoneWithProgress | null;
};

export interface StreetSuggestion {
  osmId: string;
  name: string;
  lengthMeters: number;
  currentProgress: number;
  remainingMeters?: number;
  distanceFromPoint?: number;
  reason: string;
  geometry: Array<{ lat: number; lng: number }>;
}

export interface SuggestionsResponse {
  almostComplete: StreetSuggestion[];
  nearest: StreetSuggestion[];
  milestone: {
    target: number;
    currentProgress: number;
    streetsNeeded: number;
    streets: StreetSuggestion[];
  } | null;
  clusters: Array<{
    centroid: { lat: number; lng: number };
    streets: StreetSuggestion[];
    totalLength: number;
    streetCount: number;
  }>;
  /** Street with runCount 3–4 (close to 5-run goal) for repeat_street suggestion */
  repeatStreet: StreetSuggestion | null;
}

const DEFAULT_MAX_PER_TYPE = 5;
const MILESTONES = [25, 50, 75, 100];
const ALMOST_COMPLETE_MIN = 50;
const ALMOST_COMPLETE_MAX = 94;
const CLUSTER_RADIUS_METERS = 500;
const MILESTONE_PREVIEW_MAX = 8;

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function streetToGeometry(
  street: ProjectMapStreet,
): Array<{ lat: number; lng: number }> {
  const coords = street.geometry?.coordinates ?? [];
  return coords.map(([lng, lat]) => ({ lat, lng }));
}

function streetCentroid(street: ProjectMapStreet): {
  lat: number;
  lng: number;
} {
  const coords = street.geometry?.coordinates ?? [];
  if (coords.length === 0) return { lat: 0, lng: 0 };
  const sumLat = coords.reduce((s, c) => s + c[1], 0);
  const sumLng = coords.reduce((s, c) => s + c[0], 0);
  return {
    lat: sumLat / coords.length,
    lng: sumLng / coords.length,
  };
}

function toSuggestion(
  street: ProjectMapStreet,
  reason: string,
  extra?: { remainingMeters?: number; distanceFromPoint?: number },
): StreetSuggestion {
  return {
    osmId: street.osmId,
    name: street.name,
    lengthMeters: street.lengthMeters,
    currentProgress: street.percentage,
    reason,
    geometry: streetToGeometry(street),
    ...extra,
  };
}

/**
 * Get suggestions for a project.
 */
export async function getSuggestions(
  projectId: string,
  userId: string,
  options?: {
    maxResults?: number;
    lat?: number;
    lng?: number;
  },
): Promise<SuggestionsResponse> {
  const maxResults = options?.maxResults ?? DEFAULT_MAX_PER_TYPE;
  const refLat = options?.lat ?? undefined;
  const refLng = options?.lng ?? undefined;

  const [detailResult, mapData] = await Promise.all([
    getProjectById(projectId, userId),
    getProjectMapData(projectId, userId),
  ]);
  const project = detailResult.project;

  const streets = mapData.streets;
  const centerLat = mapData.centerLat;
  const centerLng = mapData.centerLng;
  const useRef = refLat != null && refLng != null;
  const refPointLat = useRef ? refLat : (centerLat ?? 0);
  const refPointLng = useRef ? refLng : (centerLng ?? 0);

  const currentProgressPct =
    project.totalStreets > 0
      ? (project.completedStreets / project.totalStreets) * 100
      : 0;
  const nextTarget = MILESTONES.find((m) => m > currentProgressPct);
  const streetsNeeded =
    nextTarget != null && project.totalStreets > 0
      ? Math.ceil(
          ((nextTarget - currentProgressPct) / 100) * project.totalStreets,
        )
      : 0;

  const almostComplete: StreetSuggestion[] = streets
    .filter(
      (s) =>
        s.percentage >= ALMOST_COMPLETE_MIN &&
        s.percentage <= ALMOST_COMPLETE_MAX,
    )
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, maxResults)
    .map((s) => {
      const remaining = s.lengthMeters * (1 - s.percentage / 100);
      return toSuggestion(
        s,
        `${Math.round(s.percentage)}% complete — just ${Math.round(remaining)}m left!`,
        { remainingMeters: remaining },
      );
    });

  const unrun = streets.filter((s) => s.percentage === 0);
  const nearest: StreetSuggestion[] = unrun
    .map((s) => {
      const c = streetCentroid(s);
      const dist = haversineMeters(refPointLat, refPointLng, c.lat, c.lng);
      return { street: s, dist };
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, maxResults)
    .map(({ street, dist }) =>
      toSuggestion(
        street,
        `${Math.round(dist)}m from ${useRef ? "you" : "center"}`,
        { distanceFromPoint: dist },
      ),
    );

  const milestoneStreets: StreetSuggestion[] =
    nextTarget != null && streetsNeeded > 0
      ? unrun
          .sort((a, b) => a.lengthMeters - b.lengthMeters)
          .slice(0, Math.min(streetsNeeded, MILESTONE_PREVIEW_MAX))
          .map((s) =>
            toSuggestion(
              s,
              `Complete ${streetsNeeded} street(s) to reach ${nextTarget}%`,
            ),
          )
      : [];

  const milestone =
    nextTarget != null
      ? {
          target: nextTarget,
          currentProgress: Math.round(currentProgressPct * 100) / 100,
          streetsNeeded,
          streets: milestoneStreets,
        }
      : null;

  const clusters: SuggestionsResponse["clusters"] = [];
  if (unrun.length > 0) {
    const withCentroid = unrun.map((s) => ({
      street: s,
      centroid: streetCentroid(s),
    }));
    const used = new Set<string>();
    for (const { street, centroid } of withCentroid) {
      if (used.has(street.osmId)) continue;
      const group = [street];
      used.add(street.osmId);
      for (const other of withCentroid) {
        if (used.has(other.street.osmId)) continue;
        const d = haversineMeters(
          centroid.lat,
          centroid.lng,
          other.centroid.lat,
          other.centroid.lng,
        );
        if (d <= CLUSTER_RADIUS_METERS) {
          group.push(other.street);
          used.add(other.street.osmId);
        }
      }
      if (group.length >= 2) {
        const totalLength = group.reduce((s, st) => s + st.lengthMeters, 0);
        const avgLat =
          group.reduce((s, st) => s + streetCentroid(st).lat, 0) / group.length;
        const avgLng =
          group.reduce((s, st) => s + streetCentroid(st).lng, 0) / group.length;
        clusters.push({
          centroid: { lat: avgLat, lng: avgLng },
          streets: group
            .slice(0, maxResults)
            .map((st) =>
              toSuggestion(
                st,
                `${group.length} unrun streets in this area (${(totalLength / 1000).toFixed(1)} km)`,
              ),
            ),
          totalLength,
          streetCount: group.length,
        });
      }
    }
    clusters.sort((a, b) => b.streetCount - a.streetCount);
  }

  let repeatStreet: StreetSuggestion | null = null;
  const osmIds = streets.map((s) => s.osmId);
  const progressRows = await prisma.userStreetProgress.findMany({
    where: {
      userId,
      osmId: { in: osmIds },
      runCount: { gte: 3, lte: 4 },
    },
    select: { osmId: true, runCount: true },
    orderBy: { runCount: "desc" },
    take: 1,
  });
  if (progressRows.length > 0) {
    const row = progressRows[0];
    const street = streets.find((s) => s.osmId === row.osmId);
    if (street) {
      repeatStreet = toSuggestion(
        street,
        `${row.runCount}/5 runs — one more gets you closer`,
      );
    }
  }

  return {
    almostComplete,
    nearest,
    milestone,
    clusters: clusters.slice(0, 3),
    repeatStreet,
  };
}

// ============================================
// Homepage suggestions (primary + alternates, cooldown, focus)
// ============================================

const PADDING_DEGREES = 0.0001;
const COOLDOWN_DAYS_PRIMARY = 4;
const COOLDOWN_DAYS_ALTERNATE = 2;
const CLUSTER_MAX_STREETS = 8;
const CLUSTER_MAX_DISTANCE_M = 2000;
const CLUSTER_MAX_BBOX_DIAMETER_M = 500;
const CLUSTER_CANDIDATE_RADIUS_M = 1000;
const CLUSTER_CONNECTING_OVERHEAD = 1.3;
const CLUSTER_IN_PROGRESS_THRESHOLD = 50;
const CLUSTER_MAX_COUNT = 5;

function bboxFromGeometry(
  coords: Array<[number, number]>,
  padding = PADDING_DEGREES
): [number, number, number, number] {
  if (coords.length === 0)
    return [0, 0, 0, 0];
  let minLat = coords[0][1];
  let maxLat = coords[0][1];
  let minLng = coords[0][0];
  let maxLng = coords[0][0];
  for (const [lng, lat] of coords) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return [
    minLat - padding,
    minLng - padding,
    maxLat + padding,
    maxLng + padding,
  ];
}

function osmIdToNum(osmId: string): number {
  const n = parseInt(osmId, 10);
  return Number.isNaN(n) ? 0 : n;
}

async function isOnCooldown(
  userId: string,
  cooldownKey: string,
  days: number
): Promise<boolean> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const row = await prisma.suggestionCooldown.findUnique({
    where: { userId_cooldownKey: { userId, cooldownKey } },
  });
  return row != null && row.expiresAt > cutoff;
}

async function setCooldown(
  userId: string,
  cooldownKey: string,
  days: number
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  await prisma.suggestionCooldown.upsert({
    where: { userId_cooldownKey: { userId, cooldownKey } },
    create: { userId, cooldownKey, expiresAt },
    update: { expiresAt },
  });
}

function mapStreetToBbox(street: MapStreet): [number, number, number, number] {
  const coords = street.geometry?.coordinates ?? [];
  return coords.length > 0
    ? bboxFromGeometry(coords)
    : ([0, 0, 0, 0] as [number, number, number, number]);
}

/** Distance from map center to street midpoint (same heuristic as explore sorting). */
function distanceMapStreetToPoint(
  street: MapStreet,
  centerLat: number,
  centerLng: number,
): number {
  const coords = street.geometry?.coordinates ?? [];
  if (coords.length === 0) return Infinity;
  const mid = Math.floor(coords.length / 2);
  const [lng, lat] = coords[mid] ?? [0, 0];
  return haversineMeters(centerLat, centerLng, lat, lng);
}

function centroidMapStreet(street: MapStreet): { lat: number; lng: number } {
  const coords = street.geometry?.coordinates ?? [];
  if (coords.length === 0) return { lat: 0, lng: 0 };
  const sumLat = coords.reduce((sum, point) => sum + point[1], 0);
  const sumLng = coords.reduce((sum, point) => sum + point[0], 0);
  return {
    lat: sumLat / coords.length,
    lng: sumLng / coords.length,
  };
}

function bboxDiameterMeters(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
): number {
  const avgLat = (minLat + maxLat) / 2;
  const latSpanM = (maxLat - minLat) * 111_320;
  const lngSpanM =
    (maxLng - minLng) * 111_320 * Math.cos((avgLat * Math.PI) / 180);
  return Math.max(latSpanM, lngSpanM);
}

function streetValue(
  street: MapStreet,
  distFromCenter: number,
): number {
  if (street.percentage >= CLUSTER_IN_PROGRESS_THRESHOLD) {
    return 200 + street.percentage;
  }
  return 100 - Math.min(distFromCenter / 10, 99);
}

function buildClusterCandidates(
  streets: MapStreet[],
  centerLat: number,
  centerLng: number,
  max: number = CLUSTER_MAX_COUNT,
): HomepageSuggestion[] {
  const candidates = streets.filter((street) => {
    if (!street.name || street.name.trim() === "") return false;
    if (street.percentage >= 100) return false;
    const coords = street.geometry?.coordinates ?? [];
    if (coords.length < 2) return false;
    if (
      distanceMapStreetToPoint(street, centerLat, centerLng) >
      CLUSTER_CANDIDATE_RADIUS_M
    ) {
      return false;
    }
    return (
      street.percentage === 0 ||
      street.percentage >= CLUSTER_IN_PROGRESS_THRESHOLD
    );
  });
  if (candidates.length === 0) return [];

  type ClusterPoolItem = {
    street: MapStreet;
    centroid: { lat: number; lng: number };
    distFromCenter: number;
  };

  let pool: ClusterPoolItem[] = candidates.map((street) => ({
    street,
    centroid: centroidMapStreet(street),
    distFromCenter: distanceMapStreetToPoint(street, centerLat, centerLng),
  }));
  const grouped: HomepageSuggestion[] = [];

  for (let clusterIndex = 0; clusterIndex < max && pool.length > 0; clusterIndex++) {
    const completionSeed =
      [...pool]
        .filter((item) => item.street.percentage >= CLUSTER_IN_PROGRESS_THRESHOLD)
        .sort(
          (a, b) =>
            b.street.percentage - a.street.percentage ||
            a.distFromCenter - b.distFromCenter,
        )[0] ?? null;
    const explorationSeed =
      [...pool]
        .filter((item) => item.street.percentage === 0)
        .sort((a, b) => a.distFromCenter - b.distFromCenter)[0] ?? null;

    const seed =
      clusterIndex % 2 === 0
        ? (completionSeed ??
          [...pool].sort((a, b) => a.distFromCenter - b.distFromCenter)[0])
        : (explorationSeed ??
          [...pool].sort((a, b) => a.distFromCenter - b.distFromCenter)[0]);
    if (!seed) break;

    const group: MapStreet[] = [seed.street];
    const picked = new Set<string>([seed.street.osmId]);
    let remainingBudget = CLUSTER_MAX_DISTANCE_M - seed.street.lengthMeters;
    let minLat = seed.centroid.lat;
    let maxLat = seed.centroid.lat;
    let minLng = seed.centroid.lng;
    let maxLng = seed.centroid.lng;

    while (group.length < CLUSTER_MAX_STREETS && remainingBudget > 0) {
      const next = [...pool]
        .filter((item) => !picked.has(item.street.osmId))
        .filter((item) => item.street.lengthMeters <= remainingBudget)
        .filter((item) => {
          const nextMinLat = Math.min(minLat, item.centroid.lat);
          const nextMaxLat = Math.max(maxLat, item.centroid.lat);
          const nextMinLng = Math.min(minLng, item.centroid.lng);
          const nextMaxLng = Math.max(maxLng, item.centroid.lng);
          return (
            bboxDiameterMeters(nextMinLat, nextMaxLat, nextMinLng, nextMaxLng) <=
            CLUSTER_MAX_BBOX_DIAMETER_M
          );
        })
        .sort(
          (a, b) =>
            streetValue(b.street, b.distFromCenter) -
              streetValue(a.street, a.distFromCenter) ||
            a.distFromCenter - b.distFromCenter,
        )[0];

      if (!next) break;
      group.push(next.street);
      picked.add(next.street.osmId);
      remainingBudget -= next.street.lengthMeters;
      minLat = Math.min(minLat, next.centroid.lat);
      maxLat = Math.max(maxLat, next.centroid.lat);
      minLng = Math.min(minLng, next.centroid.lng);
      maxLng = Math.max(maxLng, next.centroid.lng);
    }

    pool = pool.filter((item) => !picked.has(item.street.osmId));

    const partiallyRun = group.filter((street) => street.percentage > 0);
    const anchor =
      partiallyRun.length > 0
        ? [...partiallyRun].sort((a, b) => b.percentage - a.percentage)[0]
        : [...group].sort((a, b) => b.lengthMeters - a.lengthMeters)[0];

    const newStreets = group.filter((street) => street.percentage === 0).length;
    const toFinish = group.filter(
      (street) =>
        street.percentage >= CLUSTER_IN_PROGRESS_THRESHOLD &&
        street.percentage < 100,
    ).length;
    const totalDistanceM = Math.round(
      group.reduce((sum, street) => sum + street.lengthMeters, 0),
    );
    const estimatedDistanceM = Math.round(
      totalDistanceM * CLUSTER_CONNECTING_OVERHEAD,
    );
    const allCoords = group.flatMap((street) => street.geometry?.coordinates ?? []);
    const bbox =
      allCoords.length > 0
        ? bboxFromGeometry(allCoords)
        : ([0, 0, 0, 0] as [number, number, number, number]);
    const streetIds = group
      .map((street) => osmIdToNum(street.osmId))
      .filter((id) => id > 0);
    const km = (estimatedDistanceM / 1000).toFixed(1);
    const shortCopy = `${newStreets} new streets · ${toFinish} to finish · ~${km} km`;
    grouped.push({
      type: "nearby_cluster",
      title: `Go for a run around ${anchor.name}`,
      shortCopy,
      cooldownKey: `nearby_cluster:anchor:${anchor.osmId}:size:${group.length}`,
      reason: `Area run around ${anchor.name}`,
      clusterStats: {
        newStreets,
        toFinish,
        totalDistanceM,
        estimatedDistanceM,
        streetCount: newStreets + toFinish,
      },
      focus: {
        bbox,
        ...(streetIds.length > 0 && { streetIds }),
        startPoint:
          anchor.geometry?.coordinates?.[0] != null
            ? {
                lat: anchor.geometry.coordinates[0][1],
                lng: anchor.geometry.coordinates[0][0],
              }
            : undefined,
      },
    });
  }

  return grouped
    .sort(
      (a, b) =>
        (a.clusterStats?.estimatedDistanceM ?? Infinity) -
          (b.clusterStats?.estimatedDistanceM ?? Infinity) ||
        (a.clusterStats?.streetCount ?? Infinity) -
          (b.clusterStats?.streetCount ?? Infinity),
    )
    .slice(0, max);
}

/**
 * Tiered ladder for area-only map suggestions. Returns one candidate or null.
 * Tries 500m radius first, then caller may retry with 1000m.
 */
function findBestCandidate(
  streets: MapStreet[],
  centerLat: number,
  centerLng: number,
  maxDistM: number,
): HomepageSuggestion | null {
  const withDist = streets.map((street) => ({
    street,
    dist: distanceMapStreetToPoint(street, centerLat, centerLng),
  }));
  const inBand = withDist.filter((x) => x.dist <= maxDistM);
  const pickNearest = (items: typeof withDist): (typeof withDist)[0] | undefined =>
    [...items].sort((a, b) => a.dist - b.dist)[0];

  // 1. Near + almost done: 75–100%, remaining ≤200m
  const tier1 = inBand.filter(({ street: s }) => {
    if (s.percentage < 75 || s.percentage >= 100) return false;
    const remaining = s.lengthMeters * (1 - s.percentage / 100);
    return remaining <= 200;
  });
  const w1 = pickNearest(tier1);
  if (w1) {
    const s = w1.street;
    const rem = Math.round(s.lengthMeters * (1 - s.percentage / 100));
    const bbox = mapStreetToBbox(s);
    const coords = s.geometry?.coordinates ?? [];
    return {
      type: "quick_win",
      title: s.name,
      shortCopy: `${rem}m left to finish · ${Math.round(s.percentage)}% done`,
      cooldownKey: `quick_win:street:${s.osmId}`,
      reason: `${rem}m left on ${s.name}`,
      focus: {
        bbox,
        streetIds: [osmIdToNum(s.osmId)],
        startPoint:
          coords[0] != null
            ? { lat: coords[0][1], lng: coords[0][0] }
            : undefined,
      },
    };
  }

  // 2. Near + any progress: 0–100%, length 50–500m
  const tier2 = inBand.filter(
    ({ street: s }) =>
      s.percentage > 0 &&
      s.percentage < 100 &&
      s.lengthMeters >= 50 &&
      s.lengthMeters <= 500,
  );
  const w2 = pickNearest(tier2);
  if (w2) {
    const s = w2.street;
    const pct = Math.round(s.percentage);
    const bbox = mapStreetToBbox(s);
    const coords = s.geometry?.coordinates ?? [];
    return {
      type: "quick_win",
      title: s.name,
      shortCopy: `${Math.round(s.lengthMeters)}m long · you're at ${pct}%`,
      cooldownKey: `quick_win:street:${s.osmId}`,
      reason: `In progress on ${s.name}`,
      focus: {
        bbox,
        streetIds: [osmIdToNum(s.osmId)],
        startPoint:
          coords[0] != null
            ? { lat: coords[0][1], lng: coords[0][0] }
            : undefined,
      },
    };
  }

  // 3. Unrun, good length: 100–500m
  const tier3 = inBand.filter(
    ({ street: s }) =>
      s.percentage === 0 &&
      s.lengthMeters >= 100 &&
      s.lengthMeters <= 500,
  );
  const w3 = pickNearest(tier3);
  if (w3) {
    const s = w3.street;
    const len = Math.round(s.lengthMeters);
    const bbox = mapStreetToBbox(s);
    const coords = s.geometry?.coordinates ?? [];
    return {
      type: "explore",
      title: s.name,
      shortCopy: `${len}m long · new street for you`,
      cooldownKey: `explore:street:${s.osmId}`,
      reason: `Discover ${s.name}`,
      focus: {
        bbox,
        streetIds: [osmIdToNum(s.osmId)],
        startPoint:
          coords[0] != null
            ? { lat: coords[0][1], lng: coords[0][0] }
            : undefined,
      },
    };
  }

  // 4. Unrun, any reasonable length: >50m
  const tier4 = inBand.filter(
    ({ street: s }) => s.percentage === 0 && s.lengthMeters > 50,
  );
  const w4 = pickNearest(tier4);
  if (w4) {
    const s = w4.street;
    const len = Math.round(s.lengthMeters);
    const bbox = mapStreetToBbox(s);
    const coords = s.geometry?.coordinates ?? [];
    return {
      type: "explore",
      title: s.name,
      shortCopy: `${len}m long · nearby`,
      cooldownKey: `explore:street:${s.osmId}`,
      reason: `Discover ${s.name}`,
      focus: {
        bbox,
        streetIds: [osmIdToNum(s.osmId)],
        startPoint:
          coords[0] != null
            ? { lat: coords[0][1], lng: coords[0][0] }
            : undefined,
      },
    };
  }

  return null;
}

/**
 * Get homepage suggestions: one primary + up to 2 alternates.
 * Fallback ladder: streak_saver > quick_win > milestone_push > repeat_street > explore > null.
 * With projectId: project-scoped suggestions; with lat/lng/radius only: area-only suggestions.
 * When using lat/lng/radius, also returns mapStreetsResponse so the homepage payload can inline map segments.
 */
export async function getHomepageSuggestions(
  userId: string,
  context: {
    projectId?: string;
    lat?: number;
    lng?: number;
    radius?: number;
  },
): Promise<HomepageSuggestionsWithMap> {
  const prefs = await prisma.userPreferences.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  const timezone = prefs?.timezone ?? "UTC";
  const [streakData, nextMilestone] = await Promise.all([
    getStreak(userId, timezone),
    getNextMilestone(userId, context.projectId),
  ]);

  const candidates: HomepageSuggestion[] = [];
  let mapStreetsResponse: MapStreetsResponse | undefined;

  if (context.projectId) {
    const response = await getSuggestions(context.projectId, userId, {
      lat: context.lat,
      lng: context.lng,
      maxResults: 5,
    });
    await buildCandidatesFromProjectResponse(
      userId,
      context,
      streakData,
      nextMilestone,
      response,
      candidates,
    );
  } else if (
    context.lat != null &&
    context.lng != null &&
    context.radius != null &&
    (context.lat !== 0 || context.lng !== 0)
  ) {
    const [mapResult, rawGeometries] = await Promise.all([
      getMapStreets(userId, context.lat, context.lng, context.radius),
      getGeometriesInArea(context.lat, context.lng, context.radius),
    ]);
    mapStreetsResponse = mapResult;

    const progressOsmIds = new Set(mapResult.streets.map((s) => s.osmId));
    const unrunStreets: MapStreet[] = rawGeometries
      .filter(
        (g) =>
          !progressOsmIds.has(g.osmId) &&
          g.name &&
          g.name.trim() !== "" &&
          g.lengthMeters > 50 &&
          g.geometry?.coordinates?.length >= 2,
      )
      .map((g) => ({
        osmId: g.osmId,
        name: g.name,
        highwayType: g.highwayType,
        lengthMeters: g.lengthMeters,
        percentage: 0,
        status: "partial" as const,
        geometry: g.geometry,
        stats: {
          runCount: 0,
          completionCount: 0,
          firstRunDate: null,
          lastRunDate: null,
          totalLengthMeters: g.lengthMeters,
          currentPercentage: 0,
          everCompleted: false,
          weightedCompletionRatio: 0,
          segmentCount: 1,
          connectorCount: 0,
        },
      }));

    const allStreets = [...mapResult.streets, ...unrunStreets];
    buildCandidatesFromMapStreets(
      context.lat,
      context.lng,
      streakData,
      allStreets,
      candidates,
    );
  }

  if (candidates.length === 0) {
    return mapStreetsResponse != null
      ? { primary: null, alternates: [], mapStreetsResponse, nextMilestone }
      : { primary: null, alternates: [], nextMilestone };
  }

  const filtered: HomepageSuggestion[] = [];
  for (const c of candidates) {
    const onCd = await isOnCooldown(userId, c.cooldownKey, COOLDOWN_DAYS_PRIMARY);
    if (!onCd) filtered.push(c);
  }

  const primary =
    filtered.length > 0
      ? (() => {
          if (streakData.isAtRisk && filtered.some((c) => c.type === "streak_saver"))
            return filtered.find((c) => c.type === "streak_saver")!;
          if (filtered.some((c) => c.type === "quick_win"))
            return filtered.find((c) => c.type === "quick_win")!;
          if (filtered.some((c) => c.type === "milestone_push"))
            return filtered.find((c) => c.type === "milestone_push")!;
          if (filtered.some((c) => c.type === "repeat_street"))
            return filtered.find((c) => c.type === "repeat_street")!;
          return filtered[0];
        })()
      : null;

  if (primary) {
    await setCooldown(userId, primary.cooldownKey, COOLDOWN_DAYS_PRIMARY);
  }

  const alternates = filtered
    .filter((c) => c.cooldownKey !== primary?.cooldownKey)
    .slice(0, 5);

  return mapStreetsResponse != null
    ? { primary, alternates, mapStreetsResponse, nextMilestone }
    : { primary, alternates, nextMilestone };
}

async function buildCandidatesFromProjectResponse(
  userId: string,
  context: { projectId?: string; lat?: number; lng?: number; radius?: number },
  streakData: StreakData,
  nextMilestone: MilestoneWithProgress | null,
  response: SuggestionsResponse,
  candidates: HomepageSuggestion[],
): Promise<void> {

  if (streakData.isAtRisk && streakData.currentWeeks > 0) {
    const nearest = response.nearest[0];
    if (nearest) {
      const coords = (nearest as unknown as { geometry: Array<{ lat: number; lng: number }> }).geometry;
      const bbox = coords?.length
        ? bboxFromGeometry(coords.map((c) => [c.lng, c.lat]))
        : ([0, 0, 0, 0] as [number, number, number, number]);
      candidates.push({
        type: "streak_saver",
        title: nearest.name,
        shortCopy: `${Math.round(nearest.lengthMeters)}m · keep your streak going`,
        cooldownKey: "streak_saver",
        reason: "Streak at risk this week",
        focus: {
          bbox,
          streetIds: [osmIdToNum(nearest.osmId)],
          startPoint: coords?.[0] ? { lat: coords[0].lat, lng: coords[0].lng } : undefined,
        },
      });
    }
  }

  const almostOne = response.almostComplete[0];
  if (almostOne && almostOne.currentProgress >= 85) {
    const geom = (almostOne as unknown as { geometry: Array<{ lat: number; lng: number }> }).geometry;
    const bbox = geom?.length
      ? bboxFromGeometry(geom.map((c) => [c.lng, c.lat]))
      : ([0, 0, 0, 0] as [number, number, number, number]);
    candidates.push({
      type: "quick_win",
      title: almostOne.name,
      shortCopy: `${Math.round(almostOne.remainingMeters ?? 0)}m left to finish · ${Math.round(almostOne.currentProgress)}% done`,
      cooldownKey: `quick_win:street:${almostOne.osmId}`,
      reason: `You're at ${Math.round(almostOne.currentProgress)}% on ${almostOne.name}`,
      focus: {
        bbox,
        streetIds: [osmIdToNum(almostOne.osmId)],
        startPoint: geom?.[0] ? { lat: geom[0].lat, lng: geom[0].lng } : undefined,
      },
    });
  }

  if (nextMilestone && response.milestone && response.milestone.streets.length > 0) {
    const streets = response.milestone.streets;
    const allCoords = streets.flatMap((s) =>
      (s as unknown as { geometry: Array<{ lat: number; lng: number }> }).geometry ?? []
    );
    const bbox =
      allCoords.length > 0
        ? bboxFromGeometry(allCoords.map((c) => [c.lng, c.lat]))
        : ([0, 0, 0, 0] as [number, number, number, number]);
    candidates.push({
      type: "milestone_push",
      title: `${response.milestone.streetsNeeded} streets to ${nextMilestone.name}`,
      shortCopy: `${response.milestone.streetsNeeded} street(s) to reach ${response.milestone.target}%`,
      cooldownKey: `milestone_push:milestone:${nextMilestone.id}`,
      reason: `${response.milestone.streetsNeeded} streets to your ${nextMilestone.name} milestone`,
      focus: {
        bbox,
        streetIds: streets.map((s) => osmIdToNum(s.osmId)),
      },
    });
  }

  if (response.repeatStreet) {
    const r = response.repeatStreet;
    const geom = r.geometry;
    const bbox =
      geom?.length > 0
        ? bboxFromGeometry(geom.map((c) => [c.lng, c.lat]))
        : ([0, 0, 0, 0] as [number, number, number, number]);
    candidates.push({
      type: "repeat_street",
      title: r.name,
      shortCopy: `Run ${(r as unknown as { runCount?: number }).runCount ?? "?"} of 5 · one more to master it`,
      cooldownKey: `repeat_street:street:${r.osmId}`,
      reason: r.reason,
      focus: {
        bbox,
        streetIds: [osmIdToNum(r.osmId)],
        startPoint: geom?.[0] ? { lat: geom[0].lat, lng: geom[0].lng } : undefined,
      },
    });
  }

  if (response.nearest.length >= 1 && !candidates.some((c) => c.type === "streak_saver")) {
    const n = response.nearest[0];
    const geom = (n as unknown as { geometry: Array<{ lat: number; lng: number }> }).geometry;
    const bbox = geom?.length
      ? bboxFromGeometry(geom.map((c) => [c.lng, c.lat]))
      : ([0, 0, 0, 0] as [number, number, number, number]);
    candidates.push({
      type: "explore",
      title: n.name,
      shortCopy: `${Math.round(n.lengthMeters)}m long · new street for you`,
      cooldownKey: `explore:street:${n.osmId}`,
      reason: `Discover ${n.name}`,
      focus: {
        bbox,
        streetIds: [osmIdToNum(n.osmId)],
        startPoint: geom?.[0] ? { lat: geom[0].lat, lng: geom[0].lng } : undefined,
      },
    });
  }

  if (response.clusters.length > 0) {
    const clusterCards = response.clusters.slice(0, 3).map((cluster, index) => {
      const sorted = [...cluster.streets].sort(
        (a, b) => b.currentProgress - a.currentProgress || b.lengthMeters - a.lengthMeters,
      );
      const anchor = sorted[0];
      const newStreets = cluster.streets.filter((street) => street.currentProgress === 0).length;
      const toFinish = cluster.streets.filter(
        (street) =>
          street.currentProgress >= CLUSTER_IN_PROGRESS_THRESHOLD &&
          street.currentProgress < 100,
      ).length;
      const totalDistanceM = Math.round(cluster.totalLength);
      const estimatedDistanceM = Math.round(
        totalDistanceM * CLUSTER_CONNECTING_OVERHEAD,
      );
      const km = (estimatedDistanceM / 1000).toFixed(1);
      const allCoords = cluster.streets.flatMap((street) =>
        (street as unknown as { geometry: Array<{ lat: number; lng: number }> }).geometry ?? [],
      );
      const bbox =
        allCoords.length > 0
          ? bboxFromGeometry(allCoords.map((point) => [point.lng, point.lat]))
          : ([0, 0, 0, 0] as [number, number, number, number]);
      const streetIds = cluster.streets
        .map((street) => osmIdToNum(street.osmId))
        .filter((id) => id > 0);

      const title =
        anchor?.name && anchor.name.trim().length > 0
          ? `Go for a run around ${anchor.name}`
          : "Run suggestions nearby";

      return {
        type: "nearby_cluster" as const,
        title,
        shortCopy: `${newStreets} new streets · ${toFinish} to finish · ~${km} km`,
        cooldownKey: `nearby_cluster:project:${context.projectId ?? "none"}:${index}:${anchor?.osmId ?? "na"}`,
        reason: `${cluster.streetCount} streets in this nearby run area`,
        clusterStats: {
          newStreets,
          toFinish,
          totalDistanceM,
          estimatedDistanceM,
          streetCount: newStreets + toFinish,
        },
        focus: {
          bbox,
          ...(streetIds.length > 0 && { streetIds }),
          startPoint:
            anchor?.geometry?.[0] != null
              ? { lat: anchor.geometry[0].lat, lng: anchor.geometry[0].lng }
              : undefined,
        },
      };
    });
    candidates.push(...clusterCards);
  }
}

function buildCandidatesFromMapStreets(
  centerLat: number,
  centerLng: number,
  streakData: StreakData,
  streets: MapStreet[],
  candidates: HomepageSuggestion[],
): void {
  if (streets.length === 0) return;

  // streak_saver and repeat_street run before the tiered ladder
  if (streakData.isAtRisk && streakData.currentWeeks > 0) {
    const unrun = streets.filter((s) => s.percentage === 0);
    if (unrun.length > 0) {
      const byDist = unrun
        .map((s) => ({
          street: s,
          dist: distanceMapStreetToPoint(s, centerLat, centerLng),
        }))
        .sort((a, b) => a.dist - b.dist);
      const explore = byDist[0].street;
      const bbox = mapStreetToBbox(explore);
      const coords = explore.geometry?.coordinates ?? [];
      candidates.push({
        type: "streak_saver",
        title: explore.name,
        shortCopy: `${Math.round(explore.lengthMeters)}m · keep your streak going`,
        cooldownKey: "streak_saver",
        reason: "Streak at risk this week",
        focus: {
          bbox,
          streetIds: [osmIdToNum(explore.osmId)],
          startPoint:
            coords[0] != null
              ? { lat: coords[0][1], lng: coords[0][0] }
              : undefined,
        },
      });
    }
  }

  const repeatStreet = streets.find(
    (s) => s.stats.runCount >= 3 && s.stats.runCount <= 4,
  );
  if (repeatStreet) {
    const bbox = mapStreetToBbox(repeatStreet);
    const coords = repeatStreet.geometry?.coordinates ?? [];
    candidates.push({
      type: "repeat_street",
      title: repeatStreet.name,
      shortCopy: `Run ${repeatStreet.stats.runCount} of 5 · one more to master it`,
      cooldownKey: `repeat_street:street:${repeatStreet.osmId}`,
      reason: `${repeatStreet.stats.runCount} runs on ${repeatStreet.name}`,
      focus: {
        bbox,
        streetIds: [osmIdToNum(repeatStreet.osmId)],
        startPoint:
          coords[0] != null
            ? { lat: coords[0][1], lng: coords[0][0] }
            : undefined,
      },
    });
  }

  const ladder =
    findBestCandidate(streets, centerLat, centerLng, 500) ??
    findBestCandidate(streets, centerLat, centerLng, 1000);
  if (ladder) {
    candidates.push(ladder);
  }

  const clusters = buildClusterCandidates(streets, centerLat, centerLng);
  if (clusters.length > 0) {
    candidates.push(...clusters);
  }
}

/**
 * Find the nearest shortest street to the user's actual location.
 * Used for new user onboarding - gives them a concrete first street to run.
 * 
 * @param userLat - User's actual GPS latitude
 * @param userLng - User's actual GPS longitude
 * @param radiusMeters - Search radius (default 500m)
 * @returns Street info with distance from user, or null if none found
 */
export interface NearestShortStreetItem {
  osmId: string;
  name: string;
  lengthMeters: number;
  distanceFromUser: number;
  geometry: Array<{ lat: number; lng: number }>;
  bbox: [number, number, number, number];
}

export async function getNearestShortStreet(
  userLat: number,
  userLng: number,
  radiusMeters: number = 500
): Promise<NearestShortStreetItem | null> {
  // Get all streets in the area
  const streets = await getGeometriesInArea(userLat, userLng, radiusMeters);
  
  if (streets.length === 0) return null;

  // Filter out unnamed streets and calculate distance from user to each street
  const candidates: Array<{
    street: OsmStreet;
    distanceFromUser: number;
  }> = [];

  for (const street of streets) {
    // Skip unnamed streets
    if (!street.name || street.name.trim() === "") continue;

    if (street.lengthMeters < 50 || street.lengthMeters > 500) continue;

    // Calculate distance from user point to street line
    const coords = street.geometry.coordinates;
    if (coords.length < 2) continue;

    const distanceFromUser = pointToLineDistance(
      { lat: userLat, lng: userLng },
      coords
    );

    if (distanceFromUser <= radiusMeters) {
      candidates.push({ street, distanceFromUser });
    }
  }

  if (candidates.length === 0) return null;

  // Nearest first; tie-break by shorter street length
  candidates.sort((a, b) => {
    if (a.distanceFromUser !== b.distanceFromUser) {
      return a.distanceFromUser - b.distanceFromUser;
    }
    return a.street.lengthMeters - b.street.lengthMeters;
  });

  const shortest = candidates[0].street;
  const distanceFromUser = candidates[0].distanceFromUser;

  // Convert geometry to lat/lng array
  const geometry = shortest.geometry.coordinates.map(([lng, lat]) => ({
    lat,
    lng,
  }));

  // Calculate bbox
  const lats = geometry.map((p) => p.lat);
  const lngs = geometry.map((p) => p.lng);
  const bbox: [number, number, number, number] = [
    Math.min(...lats),
    Math.min(...lngs),
    Math.max(...lats),
    Math.max(...lngs),
  ];

  return {
    osmId: shortest.osmId,
    name: shortest.name,
    lengthMeters: shortest.lengthMeters,
    distanceFromUser: Math.round(distanceFromUser),
    geometry,
    bbox,
  };
}

/**
 * Up to `max` nearest short streets for onboarding / browse list.
 */
export async function getNearestShortStreets(
  userLat: number,
  userLng: number,
  radiusMeters: number = 500,
  max: number = 5,
): Promise<NearestShortStreetItem[]> {
  const streets = await getGeometriesInArea(userLat, userLng, radiusMeters);
  if (streets.length === 0) return [];

  const candidates: Array<{
    street: OsmStreet;
    distanceFromUser: number;
  }> = [];

  for (const street of streets) {
    if (!street.name || street.name.trim() === "") continue;
    if (street.lengthMeters < 50 || street.lengthMeters > 500) continue;
    const coords = street.geometry.coordinates;
    if (coords.length < 2) continue;

    const distanceFromUser = pointToLineDistance(
      { lat: userLat, lng: userLng },
      coords,
    );

    if (distanceFromUser <= radiusMeters) {
      candidates.push({ street, distanceFromUser });
    }
  }

  if (candidates.length === 0) return [];

  candidates.sort((a, b) => {
    if (a.distanceFromUser !== b.distanceFromUser) {
      return a.distanceFromUser - b.distanceFromUser;
    }
    return a.street.lengthMeters - b.street.lengthMeters;
  });

  const seen = new Set<string>();
  const out: NearestShortStreetItem[] = [];
  for (const { street, distanceFromUser } of candidates) {
    if (seen.has(street.osmId)) continue;
    seen.add(street.osmId);
    const geometry = street.geometry.coordinates.map(([lng, lat]) => ({
      lat,
      lng,
    }));
    const lats = geometry.map((p) => p.lat);
    const lngs = geometry.map((p) => p.lng);
    const bbox: [number, number, number, number] = [
      Math.min(...lats),
      Math.min(...lngs),
      Math.max(...lats),
      Math.max(...lngs),
    ];
    out.push({
      osmId: street.osmId,
      name: street.name,
      lengthMeters: street.lengthMeters,
      distanceFromUser: Math.round(distanceFromUser),
      geometry,
      bbox,
    });
    if (out.length >= max) break;
  }
  return out;
}
