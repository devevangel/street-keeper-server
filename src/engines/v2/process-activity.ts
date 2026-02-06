/**
 * Run the v2 pipeline (OSRM -> way resolve -> edge build -> persist) for activity coordinates.
 * Used by the activity processor when GPX_ENGINE_VERSION is v2 or both.
 */

import type { GpxPoint as V1GpxPoint } from "../../types/run.types.js";
import { matchWithOSRM } from "./modules/osrm-matcher.js";
import { resolveWays } from "./modules/way-resolver.js";
import { buildAndValidateEdges } from "./modules/edge-builder.js";
import { persistUserEdges } from "./edge-persistence.js";

/**
 * Process activity GPS coordinates through the v2 pipeline and persist to UserEdge.
 * Skips GPX parsing since we already have coordinates.
 *
 * @param userId - User ID
 * @param coordinates - Activity GPS points (v1 format: lat, lng, timestamp?)
 * @param runDate - Date of the run (e.g. activity start date)
 * @returns Counts of valid and rejected edges
 */
export async function processActivityV2(
  userId: string,
  coordinates: V1GpxPoint[],
  runDate: Date
): Promise<{ edgesValid: number; edgesRejected: number }> {
  if (coordinates.length === 0) {
    return { edgesValid: 0, edgesRejected: 0 };
  }

  // Convert v1 GpxPoint[] to v2 format (lat, lng, time: string | null)
  const points = coordinates.map((p) => ({
    lat: p.lat,
    lng: p.lng,
    time: p.timestamp?.toISOString() ?? null,
  }));

  const matchResult = await matchWithOSRM(points);
  const wayResult = await resolveWays(matchResult.nodes);
  const timestamps = points.map((p) => p.time);
  const edgeResult = buildAndValidateEdges(
    wayResult.resolvedEdges,
    matchResult.nodes,
    timestamps
  );

  await persistUserEdges(userId, edgeResult.validEdges, runDate);

  return {
    edgesValid: edgeResult.statistics.validCount,
    edgesRejected: edgeResult.statistics.rejectedCount,
  };
}
