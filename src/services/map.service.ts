/**
 * Map Service
 * Serves street progress with geometry for the home page map view
 *
 * Flow:
 * 1. Get street geometries in the requested area (cache or Overpass)
 * 2. Get user's street progress for those osmIds (percentage > 0)
 * 3. Merge: attach geometry + build MapStreet with status (completed / partial)
 * 4. Return MapStreetsResponse
 */

import { queryAllStreetsInRadius } from "./overpass.service.js";
import {
  getCachedGeometries,
  setCachedGeometries,
  generateRadiusCacheKey,
  findLargerCachedRadius,
  filterStreetsToRadius,
} from "./geometry-cache.service.js";
import { getUserStreetProgress } from "./user-street-progress.service.js";
import {
  isUnnamedStreet,
  normalizeStreetName,
} from "./street-aggregation.service.js";
import type { OsmStreet } from "../types/run.types.js";
import type {
  MapStreet,
  MapStreetStats,
  MapStreetsResponse,
} from "../types/map.types.js";
import {
  MAP,
  STREET_AGGREGATION,
  STREET_MATCHING,
} from "../config/constants.js";

// ============================================
// Aggregation Helper
// ============================================

/**
 * Aggregate segment-level streets into logical streets by normalized name.
 * Used so the list shows one row per street (e.g. "Elm Grove") instead of
 * multiple rows for the same street (different OSM segments).
 *
 * Completion: length-weighted ratio with connector segments weighted at CONNECTOR_WEIGHT.
 * Street status (completed/partial) is derived from weightedCompletionRatio >= STREET_COMPLETION_THRESHOLD.
 * Uses the segment with highest percentage as the representative (geometry, name, osmId).
 */
function aggregateStreetsByName(streets: MapStreet[]): MapStreet[] {
  if (streets.length === 0) return [];

  const byName = new Map<string, MapStreet[]>();

  for (const street of streets) {
    const key = normalizeStreetName(street.name) || street.osmId;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(street);
  }

  const {
    STREET_COMPLETION_THRESHOLD,
    CONNECTOR_MAX_LENGTH_METERS,
    CONNECTOR_WEIGHT,
  } = STREET_AGGREGATION;

  return Array.from(byName.values()).map((segments) => {
    const byPercentage = [...segments].sort(
      (a, b) => b.percentage - a.percentage
    );
    const base = byPercentage[0];
    const maxPercentage = base.percentage;
    const totalRuns = segments.reduce((sum, s) => sum + s.stats.runCount, 0);
    const totalCompletions = segments.reduce(
      (sum, s) => sum + s.stats.completionCount,
      0
    );
    const everCompleted = segments.some((s) => s.stats.everCompleted);
    const firstRunDate = segments.reduce(
      (earliest, s) =>
        !s.stats.firstRunDate
          ? earliest
          : !earliest || s.stats.firstRunDate < earliest
          ? s.stats.firstRunDate
          : earliest,
      null as string | null
    );
    const lastRunDate = segments.reduce(
      (latest, s) =>
        !s.stats.lastRunDate
          ? latest
          : !latest || s.stats.lastRunDate > latest
          ? s.stats.lastRunDate
          : latest,
      null as string | null
    );
    const totalLengthMeters = segments.reduce(
      (sum, s) => sum + s.lengthMeters,
      0
    );

    // Classify segments: connector = length <= CONNECTOR_MAX_LENGTH_METERS
    const connectorCount = segments.filter(
      (s) => s.lengthMeters <= CONNECTOR_MAX_LENGTH_METERS
    ).length;

    // Length-weighted completion: each segment contributes (percentage/100) * weight,
    // where weight = lengthMeters * (CONNECTOR_WEIGHT for connectors, 1 for primary).
    let weightedSum = 0;
    let totalWeight = 0;
    for (const s of segments) {
      const isConnector = s.lengthMeters <= CONNECTOR_MAX_LENGTH_METERS;
      const weight = s.lengthMeters * (isConnector ? CONNECTOR_WEIGHT : 1);
      weightedSum += (s.percentage / 100) * weight;
      totalWeight += weight;
    }
    const weightedCompletionRatio =
      totalWeight === 0 ? 0 : weightedSum / totalWeight;

    const status =
      weightedCompletionRatio >= STREET_COMPLETION_THRESHOLD
        ? "completed"
        : "partial";

    const stats: MapStreetStats = {
      runCount: totalRuns,
      completionCount: totalCompletions,
      firstRunDate,
      lastRunDate,
      totalLengthMeters,
      currentPercentage: maxPercentage,
      everCompleted,
      weightedCompletionRatio,
      segmentCount: segments.length,
      connectorCount,
    };

    return {
      ...base,
      percentage: maxPercentage,
      lengthMeters: totalLengthMeters,
      status,
      stats,
    };
  });
}

// ============================================
// Main Function
// ============================================

/**
 * Get streets the user has run on in the given area, with geometry and stats.
 * Segment status is propagated from the aggregated street status so all segments
 * of a street share the same visual style on the map (solid green if completed,
 * dotted yellow if partial).
 *
 * @param userId - User ID (from auth)
 * @param lat - Center latitude
 * @param lng - Center longitude
 * @param radiusMeters - Radius in meters (clamped to MAP config)
 * @returns MapStreetsResponse with streets, counts, and center/radius
 */
export async function getMapStreets(
  userId: string,
  lat: number,
  lng: number,
  radiusMeters: number
): Promise<MapStreetsResponse> {
  // Clamp radius to allowed range
  const radius = Math.min(
    Math.max(radiusMeters, MAP.MIN_RADIUS_METERS),
    MAP.MAX_RADIUS_METERS
  );

  // 1. Get street geometries in area (include unnamed for full coverage)
  const geometries = await getGeometriesInArea(lat, lng, radius);
  const osmIdsInArea = geometries.map((g) => g.osmId);

  if (osmIdsInArea.length === 0) {
    return {
      success: true,
      streets: [],
      segments: [],
      center: { lat, lng },
      radiusMeters: radius,
      totalStreets: 0,
      completedCount: 0,
      partialCount: 0,
    };
  }

  // 2. Get user progress for streets in this area (any progress > 0)
  const progressList = await getUserStreetProgress(userId, {
    osmIds: osmIdsInArea,
    minPercentage: 0.01,
  });

  const geometryByOsmId = new Map(geometries.map((g) => [g.osmId, g]));

  // 3. Build segment-level list (for map polylines)
  const segments: MapStreet[] = [];

  for (const progress of progressList) {
    if (isUnnamedStreet(progress.name)) continue;

    const geometry = geometryByOsmId.get(progress.osmId);
    if (!geometry || !geometry.geometry?.coordinates?.length) continue;

    const segmentCompletionThreshold =
      STREET_MATCHING.COMPLETION_THRESHOLD * 100;
    const status =
      progress.percentage >= segmentCompletionThreshold
        ? "completed"
        : "partial";
    const isConnector =
      progress.lengthMeters <= STREET_AGGREGATION.CONNECTOR_MAX_LENGTH_METERS;
    const stats: MapStreetStats = {
      runCount: progress.runCount,
      completionCount: progress.completionCount,
      firstRunDate: progress.firstRunDate?.toISOString() ?? null,
      lastRunDate: progress.lastRunDate?.toISOString() ?? null,
      totalLengthMeters: progress.lengthMeters,
      currentPercentage: progress.percentage,
      everCompleted: progress.everCompleted,
      weightedCompletionRatio: progress.percentage / 100,
      segmentCount: 1,
      connectorCount: isConnector ? 1 : 0,
    };

    segments.push({
      osmId: progress.osmId,
      name: progress.name,
      highwayType: progress.highwayType,
      lengthMeters: progress.lengthMeters,
      percentage: progress.percentage,
      status,
      geometry: geometry.geometry,
      stats,
    });
  }

  // 4. Aggregate by name for list and stats (no duplicates)
  const streets = aggregateStreetsByName(segments);

  // 5. Propagate aggregated street status to segments so all segments of a street
  // share the same visual style on the map (solid green or dotted yellow).
  const streetStatusByName = new Map<string, "completed" | "partial">();
  for (const street of streets) {
    const key = normalizeStreetName(street.name) || street.osmId;
    streetStatusByName.set(key, street.status);
  }
  for (const segment of segments) {
    const key = normalizeStreetName(segment.name) || segment.osmId;
    const aggregatedStatus = streetStatusByName.get(key);
    if (aggregatedStatus) {
      segment.status = aggregatedStatus;
    }
  }

  const completedCount = streets.filter((s) => s.status === "completed").length;
  const partialCount = streets.filter((s) => s.status === "partial").length;

  return {
    success: true,
    streets,
    segments,
    center: { lat, lng },
    radiusMeters: radius,
    totalStreets: streets.length,
    completedCount,
    partialCount,
  };
}

// ============================================
// Geometry Fetching
// ============================================

/**
 * Get street geometries in the given area
 * Uses geometry cache when possible; otherwise Overpass (all streets including unnamed)
 */
async function getGeometriesInArea(
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): Promise<OsmStreet[]> {
  const cacheKey = generateRadiusCacheKey(centerLat, centerLng, radiusMeters);

  // Try exact cache hit
  const cached = await getCachedGeometries(cacheKey);
  if (cached) return cached;

  // Try larger cached radius and filter
  const larger = await findLargerCachedRadius(
    centerLat,
    centerLng,
    radiusMeters
  );
  if (larger) {
    const filtered = filterStreetsToRadius(
      larger.streets,
      centerLat,
      centerLng,
      radiusMeters
    );
    return filtered;
  }

  // Query Overpass (all streets including unnamed for map)
  const streets = await queryAllStreetsInRadius(
    centerLat,
    centerLng,
    radiusMeters
  );
  await setCachedGeometries(cacheKey, streets);
  return streets;
}
