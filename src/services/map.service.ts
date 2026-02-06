/**
 * Map Service
 * Serves street progress with geometry for the home page map view
 *
 * Flow:
 * 1. Get street geometries in the requested area (cache or Overpass)
 * 2. Get user's street progress for those osmIds (percentage > 0, including spatialCoverage)
 * 3. Merge: attach geometry + build MapStreet with status and optional coveredGeometry
 * 4. Return MapStreetsResponse (segments include full + covered geometry for partial streets)
 */

import * as turf from "@turf/turf";
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
import { deriveStreetCompletion } from "../engines/v2/street-completion.js";
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
 *
 * IMPORTANT: Concatenates ALL segment geometries into a single polyline for accurate map rendering.
 * Segments are sorted geographically before concatenation to form a continuous line.
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

    // Concatenate ALL segment geometries into a single polyline
    // Sort segments geographically by their first coordinate (latitude) for continuity
    const sortedSegments = [...segments].sort((a, b) => {
      const aFirst = a.geometry.coordinates[0];
      const bFirst = b.geometry.coordinates[0];
      // Sort by latitude (index 1 in GeoJSON [lng, lat])
      // If latitudes are similar, sort by longitude
      const latDiff = aFirst[1] - bFirst[1];
      if (Math.abs(latDiff) > 0.0001) return latDiff;
      return aFirst[0] - bFirst[0];
    });

    // Concatenate all coordinates, removing duplicates at segment boundaries
    const allCoordinates: [number, number][] = [];
    for (const segment of sortedSegments) {
      for (const coord of segment.geometry.coordinates) {
        // Skip duplicate points at segment boundaries
        const lastCoord = allCoordinates[allCoordinates.length - 1];
        if (
          lastCoord &&
          Math.abs(lastCoord[0] - coord[0]) < 0.000001 &&
          Math.abs(lastCoord[1] - coord[1]) < 0.000001
        ) {
          continue;
        }
        allCoordinates.push(coord);
      }
    }

    // Build merged geometry
    const mergedGeometry = {
      type: "LineString" as const,
      coordinates: allCoordinates,
    };

    return {
      osmId: base.osmId,
      name: base.name,
      highwayType: base.highwayType,
      percentage: maxPercentage,
      lengthMeters: totalLengthMeters,
      status,
      geometry: mergedGeometry,
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

    // For partial streets: slice covered portion so map can draw full (grey) + covered (yellow)
    let coveredGeometry: MapStreet["coveredGeometry"];
    let coverageInterval: [number, number] | undefined;
    const intervals = progress.spatialCoverage?.intervals;
    if (
      status === "partial" &&
      intervals?.length &&
      progress.lengthMeters > 0
    ) {
      const startPercent = Math.min(...intervals.map((i) => i[0]));
      const endPercent = Math.max(...intervals.map((i) => i[1]));
      coveredGeometry = sliceGeometryByInterval(
        geometry.geometry,
        startPercent,
        endPercent,
        progress.lengthMeters
      );
      coverageInterval = [startPercent, endPercent];
    }

    segments.push({
      osmId: progress.osmId,
      name: progress.name,
      highwayType: progress.highwayType,
      lengthMeters: progress.lengthMeters,
      percentage: progress.percentage,
      status,
      geometry: geometry.geometry,
      ...(coveredGeometry && { coveredGeometry }),
      ...(coverageInterval && { coverageInterval }),
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

/**
 * Get map streets using V2 (UserEdge) progress.
 * Same response shape as getMapStreets; progress comes from engine-v2 UserEdge data.
 */
export async function getMapStreetsV2(
  userId: string,
  lat: number,
  lng: number,
  radiusMeters: number
): Promise<MapStreetsResponse> {
  const radius = Math.min(
    Math.max(radiusMeters, MAP.MIN_RADIUS_METERS),
    MAP.MAX_RADIUS_METERS
  );

  const [geometries, completion] = await Promise.all([
    getGeometriesInArea(lat, lng, radius),
    deriveStreetCompletion(userId),
  ]);

  const completionByOsmId = new Map(
    completion.map((s) => [`way/${String(s.wayId)}`, s])
  );

  const segments: MapStreet[] = [];

  for (const geom of geometries) {
    if (isUnnamedStreet(geom.name)) continue;
    const comp = completionByOsmId.get(geom.osmId);
    if (!comp || comp.edgesTotal === 0) continue;

    const percentage = Math.round(
      (comp.edgesCompleted / comp.edgesTotal) * 100
    );
    const status = comp.isComplete ? "completed" : "partial";
    const isConnector =
      geom.lengthMeters <= STREET_AGGREGATION.CONNECTOR_MAX_LENGTH_METERS;

    const stats: MapStreetStats = {
      runCount: comp.edgesCompleted > 0 ? 1 : 0,
      completionCount: comp.isComplete ? 1 : 0,
      firstRunDate: null,
      lastRunDate: null,
      totalLengthMeters: geom.lengthMeters,
      currentPercentage: percentage,
      everCompleted: comp.isComplete,
      weightedCompletionRatio: percentage / 100,
      segmentCount: 1,
      connectorCount: isConnector ? 1 : 0,
    };

    segments.push({
      osmId: geom.osmId,
      name: geom.name,
      highwayType: geom.highwayType,
      lengthMeters: geom.lengthMeters,
      percentage,
      status,
      geometry: geom.geometry,
      stats,
    });
  }

  const streets = aggregateStreetsByName(segments);

  const streetStatusByName = new Map<string, "completed" | "partial">();
  for (const street of streets) {
    const key = normalizeStreetName(street.name) || street.osmId;
    streetStatusByName.set(key, street.status);
  }
  for (const segment of segments) {
    const key = normalizeStreetName(segment.name) || segment.osmId;
    const aggregatedStatus = streetStatusByName.get(key);
    if (aggregatedStatus) segment.status = aggregatedStatus;
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
// Geometry Helpers
// ============================================

/**
 * Slice a LineString by start/end percentage along the line.
 * Used to produce coveredGeometry for partial streets so the map can draw
 * the full street (grey) and the covered portion (yellow) separately.
 *
 * @param geometry - GeoJSON LineString (full street)
 * @param startPercent - Start position 0-100
 * @param endPercent - End position 0-100
 * @param lengthMeters - Total length in meters (for turf.lineSliceAlong)
 * @returns Sliced LineString or undefined if slice is invalid
 */
function sliceGeometryByInterval(
  geometry: { type: "LineString"; coordinates: [number, number][] },
  startPercent: number,
  endPercent: number,
  lengthMeters: number
): MapStreet["coveredGeometry"] | undefined {
  if (
    lengthMeters <= 0 ||
    startPercent >= endPercent ||
    geometry.coordinates.length < 2
  ) {
    return undefined;
  }
  const startDist = (lengthMeters * Math.max(0, startPercent)) / 100;
  const endDist = (lengthMeters * Math.min(100, endPercent)) / 100;
  if (startDist >= endDist) return undefined;

  const line = turf.lineString(geometry.coordinates);
  const sliced = turf.lineSliceAlong(line, startDist, endDist, {
    units: "meters",
  });
  return {
    type: "LineString",
    coordinates: sliced.geometry.coordinates as [number, number][],
  };
}

// ============================================
// Geometry Fetching
// ============================================

/**
 * Get street geometries in the given area
 * Uses geometry cache when possible; otherwise Overpass (all streets including unnamed)
 * Exported for use by getMapStreetsV2 (engine-v2 map endpoint).
 */
export async function getGeometriesInArea(
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
