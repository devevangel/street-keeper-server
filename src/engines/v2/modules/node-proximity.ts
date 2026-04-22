/**
 * CityStrides-style node proximity.
 *
 * Batch PostGIS: all GPS points in one (or chunked) spatial join, then bulk upsert UserNodeHit.
 */

import prisma from "../../../lib/prisma.js";
import { NODE_PROXIMITY_CONFIG } from "../config.js";

const SNAP_RADIUS_M = NODE_PROXIMITY_CONFIG.snapRadiusM;

/** Max GPS points per spatial query to keep planner/memory reasonable. */
const GPS_CHUNK_SIZE = 3000;
/** Max node IDs per bulk INSERT batch. */
const UPSERT_BATCH_SIZE = 500;

/** Point with lat/lng (compatible with V1 GpxPoint and v2 GpxPoint) */
export interface GpsPoint {
  lat: number;
  lng: number;
}

/**
 * For each GPS point, find NodeCache nodes within SNAP_RADIUS_M (25m), then
 * bulk upsert (userId, nodeId) to UserNodeHit with hitAt = runDate so project
 * progress can be scoped to "runs on or after project creation".
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

  for (let offset = 0; offset < gpsPoints.length; offset += GPS_CHUNK_SIZE) {
    const chunk = gpsPoints.slice(offset, offset + GPS_CHUNK_SIZE);
    const lngs = chunk.map((p) => p.lng);
    const lats = chunk.map((p) => p.lat);

    const rows = await prisma.$queryRaw<Array<{ nodeId: bigint }>>`
      WITH pts AS (
        SELECT * FROM unnest(${lngs}::float8[], ${lats}::float8[]) AS t(lng, lat)
      )
      SELECT DISTINCT nc."nodeId"
      FROM "NodeCache" nc, pts
      WHERE nc."geom" IS NOT NULL
        AND ST_DWithin(
          nc."geom"::geography,
          ST_SetSRID(ST_MakePoint(pts.lng, pts.lat), 4326)::geography,
          ${SNAP_RADIUS_M}
        )
    `;
    for (const r of rows) {
      hitNodeIds.add(r.nodeId);
    }
  }

  if (hitNodeIds.size === 0) {
    return { nodesHit: 0, nodeIds: [] };
  }

  const nodeIds = [...hitNodeIds];
  const hitAtParam = runDate;

  for (let i = 0; i < nodeIds.length; i += UPSERT_BATCH_SIZE) {
    const batch = nodeIds.slice(i, i + UPSERT_BATCH_SIZE);
    await prisma.$executeRaw`
      INSERT INTO "UserNodeHit" ("id", "userId", "nodeId", "hitAt")
      SELECT gen_random_uuid(), ${userId}::uuid, x, ${hitAtParam}::timestamptz
      FROM unnest(${batch}::bigint[]) AS x
      ON CONFLICT ("userId", "nodeId") DO UPDATE SET "hitAt" = EXCLUDED."hitAt"
    `;
  }

  console.log(
    `[markHitNodes] ${hitNodeIds.size} unique nodes hit for user ${userId}`,
  );
  return { nodesHit: hitNodeIds.size, nodeIds };
}
