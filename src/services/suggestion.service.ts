/**
 * Suggestion Service
 * Next-run suggestions: almost complete, nearest gaps, milestone, clusters.
 * Homepage: one primary + alternates with cooldownKey, reason, focus (bbox, streetIds, startPoint).
 */

import prisma from "../lib/prisma.js";
import { getProjectById, getProjectMapData } from "./project.service.js";
import { getMapStreets, getGeometriesInArea } from "./map.service.js";
import { pointToLineDistance } from "./geo.service.js";
import type { ProjectMapStreet } from "../types/project.types.js";
import type { MapStreet } from "../types/map.types.js";
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
  const refPointLat = useRef ? refLat : centerLat;
  const refPointLng = useRef ? refLng : centerLng;

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

/**
 * Get homepage suggestions: one primary + up to 2 alternates.
 * Fallback ladder: streak_saver > quick_win > milestone_push > repeat_street > explore > null.
 * With projectId: project-scoped suggestions; with lat/lng/radius only: area-only suggestions.
 */
export async function getHomepageSuggestions(
  userId: string,
  context: {
    projectId?: string;
    lat?: number;
    lng?: number;
    radius?: number;
  },
  streakData: StreakData,
  nextMilestone: MilestoneWithProgress | null
): Promise<HomepageSuggestionsResult> {
  const candidates: HomepageSuggestion[] = [];

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
    context.radius != null
  ) {
    const mapResult = await getMapStreets(
      userId,
      context.lat,
      context.lng,
      context.radius,
    );
    buildCandidatesFromMapStreets(
      context.lat,
      context.lng,
      streakData,
      mapResult.streets,
      candidates,
    );
  }

  if (candidates.length === 0) {
    return { primary: null, alternates: [] };
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
    .slice(0, 2);

  return { primary, alternates };
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
        title: "One short run keeps your streak",
        shortCopy: `~${(nearest.lengthMeters / 1000).toFixed(1)} km — ${nearest.name}`,
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
      title: `Finish ${almostOne.name}`,
      shortCopy: `~5 min to complete it — you're at ${Math.round(almostOne.currentProgress)}%`,
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
      reason: `${response.milestone.streetsNeeded} streets to your ${response.milestone.name} milestone`,
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
      title: `Run ${r.name} again`,
      shortCopy: `${r.reason}`,
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
      title: `Run ${n.name}`,
      shortCopy: `New street — ${(n.lengthMeters / 1000).toFixed(1)} km`,
      cooldownKey: `explore:street:${n.osmId}`,
      reason: `Discover ${n.name}`,
      focus: {
        bbox,
        streetIds: [osmIdToNum(n.osmId)],
        startPoint: geom?.[0] ? { lat: geom[0].lat, lng: geom[0].lng } : undefined,
      },
    });
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

  const byPercentage = [...streets].sort((a, b) => b.percentage - a.percentage);
  const quickWin = byPercentage.find((s) => s.percentage >= 85 && s.percentage < 100);
  if (quickWin) {
    const bbox = mapStreetToBbox(quickWin);
    const coords = quickWin.geometry?.coordinates ?? [];
    candidates.push({
      type: "quick_win",
      title: `Finish ${quickWin.name}`,
      shortCopy: `~5 min to complete it — you're at ${Math.round(quickWin.percentage)}%`,
      cooldownKey: `quick_win:street:${quickWin.osmId}`,
      reason: `You're at ${Math.round(quickWin.percentage)}% on ${quickWin.name}`,
      focus: {
        bbox,
        streetIds: [osmIdToNum(quickWin.osmId)],
        startPoint:
          coords[0] != null
            ? { lat: coords[0][1], lng: coords[0][0] }
            : undefined,
      },
    });
  }

  const repeatStreet = streets.find(
    (s) => s.stats.runCount >= 3 && s.stats.runCount <= 4,
  );
  if (repeatStreet) {
    const bbox = mapStreetToBbox(repeatStreet);
    const coords = repeatStreet.geometry?.coordinates ?? [];
    candidates.push({
      type: "repeat_street",
      title: `Run ${repeatStreet.name} again`,
      shortCopy: `${repeatStreet.stats.runCount}/5 runs — one more gets you closer`,
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

  const unrun = streets.filter((s) => s.percentage === 0);
  if (unrun.length > 0) {
    const byDist = unrun
      .map((s) => {
        const coords = s.geometry?.coordinates ?? [];
        const mid =
          coords.length > 0
            ? Math.floor(coords.length / 2)
            : 0;
        const [lng, lat] = coords[mid] ?? [0, 0];
        const dist = haversineMeters(centerLat, centerLng, lat, lng);
        return { street: s, dist };
      })
      .sort((a, b) => a.dist - b.dist);
    const explore = byDist[0].street;
    const bbox = mapStreetToBbox(explore);
    const coords = explore.geometry?.coordinates ?? [];
    if (streakData.isAtRisk && streakData.currentWeeks > 0) {
      candidates.push({
        type: "streak_saver",
        title: "One short run keeps your streak",
        shortCopy: `~${(explore.lengthMeters / 1000).toFixed(1)} km — ${explore.name}`,
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
    if (!candidates.some((c) => c.type === "streak_saver")) {
      candidates.push({
        type: "explore",
        title: `Run ${explore.name}`,
        shortCopy: `New street — ${(explore.lengthMeters / 1000).toFixed(1)} km`,
        cooldownKey: `explore:street:${explore.osmId}`,
        reason: `Discover ${explore.name}`,
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
export async function getNearestShortStreet(
  userLat: number,
  userLng: number,
  radiusMeters: number = 500
): Promise<{
  osmId: string;
  name: string;
  lengthMeters: number;
  distanceFromUser: number;
  geometry: Array<{ lat: number; lng: number }>;
  bbox: [number, number, number, number];
} | null> {
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
    
    // Calculate distance from user point to street line
    const coords = street.geometry.coordinates;
    if (coords.length < 2) continue;
    
    const distanceFromUser = pointToLineDistance(
      { lat: userLat, lng: userLng },
      coords
    );
    
    // Only consider streets within 300m of user
    if (distanceFromUser <= 300) {
      candidates.push({ street, distanceFromUser });
    }
  }

  if (candidates.length === 0) return null;

  // Sort by length (shortest first), then by distance (closest first)
  candidates.sort((a, b) => {
    if (a.street.lengthMeters !== b.street.lengthMeters) {
      return a.street.lengthMeters - b.street.lengthMeters;
    }
    return a.distanceFromUser - b.distanceFromUser;
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
