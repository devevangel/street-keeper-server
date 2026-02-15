/**
 * Suggestion Service
 * Next-run suggestions: almost complete, nearest gaps, milestone, clusters.
 * Homepage: one primary + alternates with cooldownKey, reason, focus (bbox, streetIds, startPoint).
 */

import prisma from "../lib/prisma.js";
import { getProjectById, getProjectMapData } from "./project.service.js";
import type { ProjectMapStreet } from "../types/project.types.js";
import type { StreakData } from "./streak.service.js";
import type { MilestoneWithProgress } from "../types/milestone.types.js";

/** Homepage suggestion shape (one primary action + alternates) */
export interface HomepageSuggestion {
  type:
    | "quick_win"
    | "nearby_cluster"
    | "explore"
    | "milestone_push"
    | "streak_saver"
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

  return {
    almostComplete,
    nearest,
    milestone,
    clusters: clusters.slice(0, 3),
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

/**
 * Get homepage suggestions: one primary + up to 2 alternates.
 * Fallback ladder: streak_saver > quick_win > milestone_push > explore > null.
 * Respects cooldown; when no project context returns null (search-first).
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
  if (!context.projectId) {
    return { primary: null, alternates: [] };
  }

  const response = await getSuggestions(context.projectId, userId, {
    lat: context.lat,
    lng: context.lng,
    maxResults: 5,
  });

  const candidates: HomepageSuggestion[] = [];

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
