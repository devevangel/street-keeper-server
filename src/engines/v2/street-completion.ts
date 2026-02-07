/**
 * V2 street completion from UserEdge
 * Exported for use by handlers and map.service (v2 map endpoint).
 */

import prisma from "../../lib/prisma.js";
import type { StreetCompletion, GroupedStreet } from "./types.js";

/**
 * Convert project snapshot osmId (e.g. "way/12345") to WayTotalEdges/UserEdge wayId (BigInt).
 */
export function osmIdToWayId(osmId: string): bigint {
  return BigInt(osmId.replace("way/", ""));
}

/**
 * Derive project progress from UserEdge + WayTotalEdges for a given set of project streets.
 * Used when ENGINE.VERSION=v2 to compute percentages for updateProjectProgress (no V1 matching).
 * Streets with no WayTotalEdges entry get percentage 0.
 */
export async function deriveProjectProgressV2(
  userId: string,
  projectStreets: Array<{ osmId: string; lengthMeters: number }>
): Promise<
  Array<{
    osmId: string;
    percentage: number;
    isComplete: boolean;
  }>
> {
  if (projectStreets.length === 0) return [];

  const wayIds = projectStreets.map((s) => osmIdToWayId(s.osmId));

  const [userEdges, wayTotals] = await Promise.all([
    prisma.userEdge.findMany({
      where: { userId, wayId: { in: wayIds } },
      select: { edgeId: true, wayId: true },
    }),
    prisma.wayTotalEdges.findMany({
      where: { wayId: { in: wayIds } },
    }),
  ]);

  const edgesByWay = new Map<bigint, Set<string>>();
  for (const edge of userEdges) {
    const set = edgesByWay.get(edge.wayId) ?? new Set();
    set.add(edge.edgeId);
    edgesByWay.set(edge.wayId, set);
  }
  const totalByWay = new Map(
    wayTotals.map((row) => [row.wayId, row.totalEdges])
  );

  return projectStreets.map((street) => {
    const wayId = osmIdToWayId(street.osmId);
    const edgesCompleted = edgesByWay.get(wayId)?.size ?? 0;
    const edgesTotal = totalByWay.get(wayId) ?? 0;
    const percentage =
      edgesTotal > 0
        ? Math.min(100, Math.round((edgesCompleted / edgesTotal) * 100))
        : 0;
    const isComplete = edgesTotal > 0 && edgesCompleted >= edgesTotal;
    return {
      osmId: street.osmId,
      percentage,
      isComplete,
    };
  });
}

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
