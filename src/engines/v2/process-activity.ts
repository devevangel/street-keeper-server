/**
 * Run the v2 pipeline (CityStrides-style node proximity) for activity coordinates.
 * Used by the activity processor when GPX_ENGINE_VERSION is v2 or both.
 */

import type { GpxPoint as V1GpxPoint } from "../../types/run.types.js";
import { markHitNodes } from "./modules/node-proximity.js";

/**
 * Process activity GPS coordinates through the node-proximity pipeline and persist to UserNodeHit.
 * For each point, nodes within 25m are marked as hit. No map-matching; street completion
 * is derived later from hit nodes vs total nodes per way (90% rule).
 *
 * @param userId - User ID
 * @param coordinates - Activity GPS points (v1 format: lat, lng, timestamp?)
 * @param _runDate - Unused (kept for API compatibility)
 * @returns Number of unique nodes hit this run
 */
export async function processActivityV2(
  userId: string,
  coordinates: V1GpxPoint[],
  _runDate: Date
): Promise<{ nodesHit: number }> {
  if (coordinates.length === 0) {
    return { nodesHit: 0 };
  }

  const points = coordinates.map((p) => ({ lat: p.lat, lng: p.lng }));
  const result = await markHitNodes(userId, points);
  return result;
}
