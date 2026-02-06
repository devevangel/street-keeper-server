/**
 * Persist validated edges to UserEdge table.
 * Used by both the analyze handler and the activity processor (processActivityV2).
 */

import prisma from "../../lib/prisma.js";

export interface EdgeToPersist {
  edgeId: string;
  nodeA: bigint;
  nodeB: bigint;
  wayId: bigint;
  wayName: string | null;
  highwayType: string;
  lengthMeters: number;
}

/**
 * Persist valid edges to UserEdge table.
 * Uses upsert to handle idempotency: if edge already exists for user,
 * increments runCount instead of creating duplicate.
 *
 * @param userId - User ID
 * @param validEdges - Validated edges from edge builder
 * @param runDate - Date/time of this run (for firstRunAt)
 */
export async function persistUserEdges(
  userId: string,
  validEdges: EdgeToPersist[],
  runDate: Date
): Promise<void> {
  if (validEdges.length === 0) {
    return; // Nothing to persist
  }

  // Batch upsert edges (idempotent: increments runCount if edge already exists)
  await Promise.all(
    validEdges.map((edge) =>
      prisma.userEdge.upsert({
        where: {
          userId_edgeId: {
            userId,
            edgeId: edge.edgeId,
          },
        },
        create: {
          userId,
          edgeId: edge.edgeId,
          nodeA: edge.nodeA,
          nodeB: edge.nodeB,
          wayId: edge.wayId,
          wayName: edge.wayName,
          highwayType: edge.highwayType,
          lengthMeters: edge.lengthMeters,
          firstRunAt: runDate,
          runCount: 1,
        },
        update: {
          // Increment runCount if edge already exists
          runCount: {
            increment: 1,
          },
        },
      })
    )
  );

  console.log(
    `[persistUserEdges] Persisted ${validEdges.length} edges for user ${userId}`
  );
}
