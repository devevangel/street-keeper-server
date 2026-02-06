/**
 * V2 street completion from UserEdge
 * Exported for use by handlers and map.service (v2 map endpoint).
 */

import prisma from "../../lib/prisma.js";
import type { StreetCompletion, GroupedStreet } from "./types.js";

/**
 * Derive street completion from ALL stored UserEdge rows (cumulative progress).
 * Groups by wayId, counts unique edgeIds, looks up totalEdges from WayTotalEdges.
 */
export async function deriveStreetCompletion(
  userId: string
): Promise<StreetCompletion[]> {
  const userEdges = await prisma.userEdge.findMany({
    where: { userId },
    select: { edgeId: true, wayId: true, wayName: true },
  });

  if (userEdges.length === 0) return [];

  const edgesByWay = new Map<
    bigint,
    { name: string | null; uniqueEdges: Set<string> }
  >();

  for (const edge of userEdges) {
    const existing = edgesByWay.get(edge.wayId);
    if (existing) {
      existing.uniqueEdges.add(edge.edgeId);
    } else {
      edgesByWay.set(edge.wayId, {
        name: edge.wayName,
        uniqueEdges: new Set([edge.edgeId]),
      });
    }
  }

  const wayIds = [...edgesByWay.keys()];
  const wayTotals =
    wayIds.length > 0
      ? await prisma.wayTotalEdges.findMany({
          where: { wayId: { in: wayIds } },
        })
      : [];
  const totalByWay = new Map(
    wayTotals.map((row) => [row.wayId, row.totalEdges])
  );

  const streets: StreetCompletion[] = [];

  for (const [wayId, data] of edgesByWay.entries()) {
    const edgesCompleted = data.uniqueEdges.size;
    const edgesTotal = totalByWay.get(wayId) ?? edgesCompleted;
    const isComplete = edgesTotal > 0 && edgesCompleted >= edgesTotal;

    if (edgesCompleted > edgesTotal) {
      console.warn(
        `[deriveStreetCompletion] Data drift: wayId ${wayId} has edgesCompleted=${edgesCompleted} > edgesTotal=${edgesTotal}`
      );
    }

    streets.push({
      wayId,
      name: data.name,
      edgesTotal,
      edgesCompleted,
      isComplete,
    });
  }

  streets.sort((a, b) => {
    const nameA = a.name || "Unnamed";
    const nameB = b.name || "Unnamed";
    return nameA.localeCompare(nameB);
  });

  return streets;
}

/**
 * Group street completion by name for client-friendly list.
 */
export function groupStreetsByName(
  streets: StreetCompletion[]
): GroupedStreet[] {
  const byName = new Map<string, StreetCompletion[]>();

  for (const street of streets) {
    const name = street.name || "Unnamed";
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(street);
  }

  return Array.from(byName.entries())
    .map(([name, ways]) => {
      const edgesTotal = ways.reduce((sum, w) => sum + w.edgesTotal, 0);
      const edgesCompleted = ways.reduce((sum, w) => sum + w.edgesCompleted, 0);
      const isComplete = ways.every((w) => w.isComplete);
      const completionPercent =
        edgesTotal > 0 ? Math.round((edgesCompleted / edgesTotal) * 100) : 0;
      return {
        name,
        wayIds: ways.map((w) => String(w.wayId)),
        edgesTotal,
        edgesCompleted,
        isComplete,
        completionPercent,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
