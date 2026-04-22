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
import { getLocalStreetsInRadius } from "./local-streets.service.js";
import { ensureCitySyncedAsync } from "./city-sync.service.js";
import { getUserStreetProgress } from "./user-street-progress.service.js";
import { isUnnamedStreet } from "../engines/v1/street-aggregation.js";
import {
  deriveStreetCompletionForArea,
  osmIdToWayId,
} from "../engines/v2/street-completion.js";
import { v2AggregatedStatusFromSegments } from "../engines/v2/named-street-aggregate.js";
import {
  groupByLogicalStreet,
  lineStringCentroid,
  mergeSegmentGeometries,
} from "../engines/v2/street-grouping.js";
import type { OsmStreet, GpxPoint } from "../types/run.types.js";
import type {
  MapStreet,
  MapStreetStats,
  MapStreetsResponse,
  GpsTraceItem,
  GpsTracesResponse,
} from "../types/map.types.js";
import { simplifyCoordinates } from "../utils/geometry.js";
import prisma from "../lib/prisma.js";
import {
  MAP,
  STREET_AGGREGATION,
  STREET_MATCHING,
} from "../config/constants.js";

// ============================================
// Aggregation Helper
// ============================================

/**
 * Aggregate segment-level streets into logical streets.
 *
 * Grouped by (normalized name, spatial cluster) so that two distant streets with
 * the same name (e.g. two "Richmond Place" on opposite sides of town) are reported
 * as separate entries rather than pooling their node hits and rendering as one
 * long zigzag polyline.
 *
 * Completion: length-weighted % with connector segments weighted at CONNECTOR_WEIGHT.
 * Street status "completed" only if every segment is V2-complete (CityStrides node rule per way).
 *
 * Geometry merge: per-cluster, sorted geographically + duplicate endpoints trimmed.
 */
type AggregateResult = {
  streets: MapStreet[];
  /** osmId → aggregated status/percentage for the cluster that osmId belongs to. */
  byOsmId: Map<
    string,
    { status: "completed" | "partial" | "not_started"; percentage: number }
  >;
};

function aggregateStreetsByName(streets: MapStreet[]): AggregateResult {
  if (streets.length === 0) return { streets: [], byOsmId: new Map() };

  const { CONNECTOR_MAX_LENGTH_METERS } = STREET_AGGREGATION;

  const groups = groupByLogicalStreet<MapStreet>(
    streets,
    (s) => s.name,
    (s) => lineStringCentroid(s.geometry?.coordinates),
  );

  const byOsmId = new Map<
    string,
    { status: "completed" | "partial" | "not_started"; percentage: number }
  >();

  const aggregated = groups.map((group) => {
    const segments = group.items;
    const byPercentage = [...segments].sort(
      (a, b) => b.percentage - a.percentage,
    );
    const base = byPercentage[0];
    const totalRuns = segments.reduce((sum, s) => sum + s.stats.runCount, 0);
    const totalCompletions = segments.reduce(
      (sum, s) => sum + s.stats.completionCount,
      0,
    );
    const everCompleted = segments.some((s) => s.stats.everCompleted);
    const firstRunDate = segments.reduce(
      (earliest, s) =>
        !s.stats.firstRunDate
          ? earliest
          : !earliest || s.stats.firstRunDate < earliest
            ? s.stats.firstRunDate
            : earliest,
      null as string | null,
    );
    const lastRunDate = segments.reduce(
      (latest, s) =>
        !s.stats.lastRunDate
          ? latest
          : !latest || s.stats.lastRunDate > latest
            ? s.stats.lastRunDate
            : latest,
      null as string | null,
    );
    const totalLengthMeters = segments.reduce(
      (sum, s) => sum + s.lengthMeters,
      0,
    );

    const connectorCount = segments.filter(
      (s) => s.lengthMeters <= CONNECTOR_MAX_LENGTH_METERS,
    ).length;

    const { percentage: weightedPercentage, status } =
      v2AggregatedStatusFromSegments(
        segments.map((s) => ({
          lengthMeters: s.lengthMeters,
          percentage: s.percentage,
          status: s.status,
        })),
      );
    const weightedCompletionRatio = weightedPercentage / 100;
    const stats: MapStreetStats = {
      runCount: totalRuns,
      completionCount: totalCompletions,
      firstRunDate,
      lastRunDate,
      totalLengthMeters,
      currentPercentage: weightedPercentage,
      everCompleted,
      weightedCompletionRatio,
      segmentCount: segments.length,
      connectorCount,
    };

    const mergedGeometry = mergeSegmentGeometries(segments) ?? {
      type: "LineString" as const,
      coordinates: [],
    };

    for (const s of segments) {
      byOsmId.set(s.osmId, { status, percentage: weightedPercentage });
    }

    return {
      osmId: base.osmId,
      name: base.name,
      highwayType: base.highwayType,
      percentage: weightedPercentage,
      lengthMeters: totalLengthMeters,
      status,
      geometry: mergedGeometry,
      stats,
    };
  });

  return { streets: aggregated, byOsmId };
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
 * @param minPercentage - Only include streets with progress >= this (0-100). Default 0. Use 30 for homepage to reduce payload.
 * @returns MapStreetsResponse with streets, counts, and center/radius
 */
export async function getMapStreets(
  userId: string,
  lat: number,
  lng: number,
  radiusMeters: number,
  minPercentage: number = 0,
): Promise<MapStreetsResponse> {
  // Clamp radius to allowed range
  const radius = Math.min(
    Math.max(radiusMeters, MAP.MIN_RADIUS_METERS),
    MAP.MAX_RADIUS_METERS,
  );

  const { streets: geometries, syncing } = await getGeometriesInArea(
    lat,
    lng,
    radius,
  );
  const osmIdsInArea = geometries.map((g) => g.osmId);

  if (syncing || osmIdsInArea.length === 0) {
    return {
      success: true,
      syncing: syncing || undefined,
      streets: [],
      segments: [],
      center: { lat, lng },
      radiusMeters: radius,
      totalStreets: 0,
      completedCount: 0,
      partialCount: 0,
    };
  }

  // 2. Get user progress for streets in this area (filter by minPercentage)
  const progressList = await getUserStreetProgress(userId, {
    osmIds: osmIdsInArea,
    minPercentage: Math.max(0.01, minPercentage),
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
        progress.lengthMeters,
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

  // 4. Aggregate by (name, location cluster) for list and stats (no duplicates).
  const { streets, byOsmId: aggregatedByOsmId } =
    aggregateStreetsByName(segments);

  // 5. Propagate aggregated street status and percentage to every segment in the
  // same cluster so they share visual style and popup info on the map.
  for (const segment of segments) {
    const aggregated = aggregatedByOsmId.get(segment.osmId);
    if (aggregated) {
      segment.status = aggregated.status;
      segment.percentage = aggregated.percentage;
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
 * Get map streets using V2 (UserNodeHit) progress.
 * Same response shape as getMapStreets; progress comes from engine-v2 node completion.
 *
 * @param minPercentage - Only include streets with progress >= this (0-100). Default 0. Use 30 for homepage.
 */
export async function getMapStreetsV2(
  userId: string,
  lat: number,
  lng: number,
  radiusMeters: number,
  minPercentage: number = 0,
): Promise<MapStreetsResponse> {
  const radius = Math.min(
    Math.max(radiusMeters, MAP.MIN_RADIUS_METERS),
    MAP.MAX_RADIUS_METERS,
  );

  const { streets: geometries, syncing } = await getGeometriesInArea(
    lat,
    lng,
    radius,
  );
  if (syncing || geometries.length === 0) {
    return {
      success: true,
      syncing: syncing || undefined,
      streets: [],
      segments: [],
      center: { lat, lng },
      radiusMeters: radius,
      totalStreets: 0,
      completedCount: 0,
      partialCount: 0,
    };
  }
  const wayIds = geometries.map((g) => osmIdToWayId(g.osmId));
  const completion = await deriveStreetCompletionForArea(userId, wayIds);

  const completionByOsmId = new Map(
    completion.map((s) => [`way/${String(s.wayId)}`, s]),
  );

  const segments: MapStreet[] = [];

  for (const geom of geometries) {
    if (isUnnamedStreet(geom.name)) continue;
    const comp = completionByOsmId.get(geom.osmId);

    const percentage =
      comp && comp.edgesTotal > 0
        ? Math.round((comp.edgesCompleted / comp.edgesTotal) * 100)
        : 0;

    if (percentage < minPercentage) continue;

    const status: "completed" | "partial" | "not_started" =
      comp?.isComplete ? "completed" : percentage > 0 ? "partial" : "not_started";

    const isConnector =
      geom.lengthMeters <= STREET_AGGREGATION.CONNECTOR_MAX_LENGTH_METERS;

    const stats: MapStreetStats = {
      runCount: 0,
      completionCount: 0,
      firstRunDate: null,
      lastRunDate: null,
      totalLengthMeters: geom.lengthMeters,
      currentPercentage: percentage,
      everCompleted: comp?.isComplete ?? false,
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

  const { streets, byOsmId: aggregatedByOsmId } =
    aggregateStreetsByName(segments);

  // Propagate aggregated cluster status/percentage to every segment (cluster-aware).
  for (const segment of segments) {
    const aggregated = aggregatedByOsmId.get(segment.osmId);
    if (aggregated) {
      segment.status = aggregated.status;
      segment.percentage = aggregated.percentage;
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
  lengthMeters: number,
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
 * Street geometries in the area from PostGIS (all named + unnamed).
 * When the city is not synced yet, returns empty streets and syncing: true.
 */
export async function getGeometriesInArea(
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
): Promise<{ streets: OsmStreet[]; syncing: boolean }> {
  let synced = false;
  try {
    const result = await ensureCitySyncedAsync(centerLat, centerLng);
    synced = result.synced;
  } catch (e) {
    // detectCity uses Overpass; if Overpass is down, fall through and
    // return whatever PostGIS already has instead of crashing with 500.
    console.warn(
      "[Map] ensureCitySyncedAsync failed (Overpass may be down), querying PostGIS anyway:",
      e instanceof Error ? e.message : e,
    );
  }

  const streets = await getLocalStreetsInRadius(
    centerLat,
    centerLng,
    radiusMeters,
    { namedOnly: true },
  );

  if (streets.length === 0 && !synced) {
    return { streets: [], syncing: true };
  }
  return { streets, syncing: false };
}

// ============================================
// GPS Traces
// ============================================

const TRACES_DEFAULT_RADIUS_METERS = 5000;
const TRACES_MAX_ACTIVITIES = 200;

/**
 * Check if a bounding box (from activity coordinates) intersects a circle (center + radius).
 * Uses approximate degrees: ~111km per degree at mid-latitudes.
 */
function bboxIntersectsCircle(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
): boolean {
  const radiusDeg = radiusMeters / 111000;
  const expandedMinLat = minLat - radiusDeg;
  const expandedMaxLat = maxLat + radiusDeg;
  const expandedMinLng = minLng - radiusDeg;
  const expandedMaxLng = maxLng + radiusDeg;
  return (
    centerLat >= expandedMinLat &&
    centerLat <= expandedMaxLat &&
    centerLng >= expandedMinLng &&
    centerLng <= expandedMaxLng
  );
}

/**
 * Get simplified GPS traces for the user's processed activities.
 * Optionally filter by area (lat, lng, radius). Limit 200 activities.
 */
export async function getMapTraces(
  userId: string,
  lat?: number,
  lng?: number,
  radiusMeters: number = TRACES_DEFAULT_RADIUS_METERS,
): Promise<GpsTracesResponse> {
  const activities = await prisma.activity.findMany({
    where: { userId, isProcessed: true },
    orderBy: { startDate: "desc" },
    take: TRACES_MAX_ACTIVITIES,
    select: { id: true, name: true, startDate: true, coordinates: true },
  });

  const traces: GpsTraceItem[] = [];
  const hasAreaFilter =
    lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng);

  for (const a of activities) {
    const coords = a.coordinates as GpxPoint[] | null;
    if (!coords || !Array.isArray(coords) || coords.length < 2) continue;

    if (hasAreaFilter) {
      const lats = coords.map((p) => p.lat);
      const lngs = coords.map((p) => p.lng);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      if (
        !bboxIntersectsCircle(
          minLat,
          maxLat,
          minLng,
          maxLng,
          lat,
          lng,
          radiusMeters,
        )
      ) {
        continue;
      }
    }

    const simplified = simplifyCoordinates(coords);
    if (simplified.length < 2) continue;

    traces.push({
      activityId: a.id,
      name: a.name,
      startDate: a.startDate.toISOString(),
      coordinates: simplified,
    });
  }

  return { success: true, traces };
}

/**
 * Get simplified GPS traces for activities linked to a project.
 * @throws ProjectNotFoundError if project does not exist
 * @throws ProjectAccessDeniedError if user does not own the project
 */
export async function getProjectTraces(
  projectId: string,
  userId: string,
): Promise<GpsTracesResponse> {
  const { getProjectById } = await import("./project.service.js");
  await getProjectById(projectId, userId);
  const projectActivities = await prisma.projectActivity.findMany({
    where: {
      projectId,
      project: { userId },
    },
    include: {
      activity: {
        select: {
          id: true,
          name: true,
          startDate: true,
          coordinates: true,
          isProcessed: true,
        },
      },
    },
  });

  const traces: GpsTraceItem[] = [];
  for (const pa of projectActivities) {
    const a = pa.activity;
    if (!a || !a.isProcessed) continue;
    const coords = a.coordinates as GpxPoint[] | null;
    if (!coords || !Array.isArray(coords) || coords.length < 2) continue;

    const simplified = simplifyCoordinates(coords);
    if (simplified.length < 2) continue;

    traces.push({
      activityId: a.id,
      name: a.name,
      startDate: a.startDate.toISOString(),
      coordinates: simplified,
    });
  }

  return { success: true, traces };
}
