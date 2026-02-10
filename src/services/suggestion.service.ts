/**
 * Suggestion Service
 * Next-run suggestions: almost complete, nearest gaps, milestone, clusters.
 * Reads project snapshot and map data to suggest streets for the user to run.
 */

import { getProjectById, getProjectMapData } from "./project.service.js";
import type { ProjectMapStreet } from "../types/project.types.js";

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
