/**
 * Run the v2 pipeline (CityStrides-style node proximity) for activity coordinates.
 * Used by the activity processor when GPX_ENGINE_VERSION is v2 or both.
 */

import type { GpxPoint as V1GpxPoint } from "../../types/run.types.js";
import { markHitNodes } from "./modules/node-proximity.js";
import { ensureCitySynced } from "../../services/city-sync.service.js";

/**
 * Process activity GPS coordinates through the node-proximity pipeline and persist to UserNodeHit.
 * For each point, nodes within 25m are marked as hit with hitAt = runDate so project progress
 * can be scoped to runs on or after project creation.
 *
 * Before marking hits, we ensure the city containing this activity is synced (NodeCache, WayNode,
 * WayTotalEdges populated). This uses the center of the activity's bounding box to detect the city.
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

  // Compute bounding box center to detect and sync the city before marking node hits.
  const lats = coordinates.map((p) => p.lat);
  const lngs = coordinates.map((p) => p.lng);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

  // Ensure the city is synced (NodeCache, WayNode, WayTotalEdges populated).
  // This is a no-op if the city was already synced and not expired.
  await ensureCitySynced(centerLat, centerLng);

  const points = coordinates.map((p) => ({ lat: p.lat, lng: p.lng }));
  const { nodesHit } = await markHitNodes(userId, points, runDate);
  return { nodesHit };
}
