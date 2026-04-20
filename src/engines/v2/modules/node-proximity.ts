/**
 * CityStrides-style node proximity.
 *
 * For each GPS point, finds all NodeCache nodes within SNAP_RADIUS_M (25m),
 * then bulk upserts to UserNodeHit. No map-matching; multiple nodes/ways can
 * be credited per point.
 */

import prisma from "../../../lib/prisma.js";
import { NODE_PROXIMITY_CONFIG } from "../config.js";

const SNAP_RADIUS_M = NODE_PROXIMITY_CONFIG.snapRadiusM;

/** Point with lat/lng (compatible with V1 GpxPoint and v2 GpxPoint) */
export interface GpsPoint {
  lat: number;
  lng: number;
}

const BATCH_SIZE = 500;

/**
 * For each GPS point, find NodeCache nodes within SNAP_RADIUS_M (25m), then
 * bulk upsert (userId, nodeId) to UserNodeHit with hitAt = runDate so project
 * progress can be scoped to "runs on or after project creation".
 * Returns the number of unique nodes hit this run and the array of node IDs.
 *
 * @param runDate - Activity/run start time; stored as hitAt so deriveProjectProgressV2Scoped
 *                  can filter to only count hits from runs on or after project.createdAt.
 */
export async function markHitNodes(
  userId: string,
  gpsPoints: GpsPoint[],
  runDate: Date,
): Promise<{ nodesHit: number; nodeIds: bigint[] }> {
  if (gpsPoints.length === 0) {
    return { nodesHit: 0, nodeIds: [] };
  }

  const hitNodeIds = new Set<bigint>();

  for (const point of gpsPoints) {
    const nearbyNodes = await prisma.$queryRaw<
      Array<{ nodeId: bigint; lat: number; lon: number }>
    >`
      SELECT "nodeId", "lat", "lon" FROM "NodeCache"
      WHERE "geom" IS NOT NULL
        AND ST_DWithin(
          "geom"::geography,
          ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography,
          ${SNAP_RADIUS_M}
        )
    `;
    for (const node of nearbyNodes) {
      hitNodeIds.add(node.nodeId);
    }
  }

  if (hitNodeIds.size === 0) {
    return { nodesHit: 0, nodeIds: [] };
  }

  const nodeIds = [...hitNodeIds];
  for (let i = 0; i < nodeIds.length; i += BATCH_SIZE) {
    const batch = nodeIds.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map((nodeId) =>
        prisma.userNodeHit.upsert({
          where: {
            userId_nodeId: { userId, nodeId },
          },
          create: {
            userId,
            nodeId,
            hitAt: runDate,
          },
          update: { hitAt: runDate },
        }),
      ),
    );
  }

  console.log(
    `[markHitNodes] ${hitNodeIds.size} unique nodes hit for user ${userId}`,
  );
  return { nodesHit: hitNodeIds.size, nodeIds };
}
