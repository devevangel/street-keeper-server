/**
 * Run the v2 pipeline (CityStrides-style node proximity) for activity coordinates.
 * Used by the activity processor when GPX_ENGINE_VERSION is v2 or both.
 */

import type { GpxPoint as V1GpxPoint } from "../../types/run.types.js";
import { markHitNodes } from "./modules/node-proximity.js";

/**
 * Process activity GPS coordinates through the node-proximity pipeline and persist to UserNodeHit.
 * For each point, nodes within 25m are marked as hit with hitAt = runDate so project progress
 * can be scoped to runs on or after project creation.
 *
 * @param userId - User ID
 * @param coordinates - Activity GPS points (v1 format: lat, lng, timestamp?)
 * @param runDate - Activity/run start time; stored as hitAt for scoped project progress
 * @returns Number of unique nodes hit this run
 */
export async function processActivityV2(
  userId: string,
  coordinates: V1GpxPoint[],
  runDate: Date,
): Promise<{ nodesHit: number }> {
  if (coordinates.length === 0) {
    return { nodesHit: 0 };
  }

  const points = coordinates.map((p) => ({ lat: p.lat, lng: p.lng }));
  const { nodesHit } = await markHitNodes(userId, points, runDate);
  return { nodesHit };
}
