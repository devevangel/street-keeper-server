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
import type { OsmStreet } from "../types/run.types.js";
import type {
  MapStreet,
  MapStreetStats,
  MapStreetsResponse,
} from "../types/map.types.js";
import { MAP } from "../config/constants.js";

// ============================================
// Main Function
// ============================================

/**
 * Get streets the user has run on in the given area, with geometry and stats
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

  const progressByOsmId = new Map(progressList.map((p) => [p.osmId, p]));
  const geometryByOsmId = new Map(geometries.map((g) => [g.osmId, g]));

  // 3. Merge: only include streets we have geometry for
  const streets: MapStreet[] = [];
  let completedCount = 0;
  let partialCount = 0;

  for (const progress of progressList) {
    const geometry = geometryByOsmId.get(progress.osmId);
    if (!geometry || !geometry.geometry?.coordinates?.length) continue;

    const status = progress.everCompleted ? "completed" : "partial";
    if (status === "completed") completedCount++;
    else partialCount++;

    const stats: MapStreetStats = {
      runCount: progress.runCount,
      completionCount: progress.completionCount,
      firstRunDate: progress.firstRunDate?.toISOString() ?? null,
      lastRunDate: progress.lastRunDate?.toISOString() ?? null,
      totalLengthMeters: progress.lengthMeters,
      currentPercentage: progress.percentage,
      everCompleted: progress.everCompleted,
    };

    streets.push({
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

  return {
    success: true,
    streets,
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
