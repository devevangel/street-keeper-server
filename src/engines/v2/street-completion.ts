/**
 * V2 street completion from UserNodeHit + WayNode (CityStrides-style).
 * Exported for use by handlers and map.service (v2 map endpoint).
 */

import prisma from "../../lib/prisma.js";
import type { StreetCompletion, GroupedStreet } from "./types.js";
import { NODE_PROXIMITY_CONFIG } from "./config.js";

const SHORT_THRESHOLD = NODE_PROXIMITY_CONFIG.shortStreetNodeThreshold;
const STANDARD_THRESHOLD = NODE_PROXIMITY_CONFIG.standardCompletionThreshold;

/**
 * Convert project snapshot osmId (e.g. "way/12345") to wayId (BigInt).
 */
export function osmIdToWayId(osmId: string): bigint {
  return BigInt(osmId.replace("way/", ""));
}

/**
 * Whether a way is complete given hit nodes and total nodes (90% rule).
 * Short streets (<=10 nodes): 100% required. Longer: 90% required.
 */
function isWayComplete(hitNodes: number, totalNodes: number): boolean {
  if (totalNodes <= 0) return false;
  if (totalNodes <= SHORT_THRESHOLD) return hitNodes === totalNodes;
  return hitNodes / totalNodes >= STANDARD_THRESHOLD;
}

/**
 * Derive project progress from UserNodeHit + WayNode + WayTotalEdges for a given set of project streets.
 * Used when ENGINE.VERSION=v2 to compute percentages for updateProjectProgress.
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

  const [userHits, wayTotals] = await Promise.all([
    prisma.userNodeHit.findMany({
      where: { userId },
      select: { nodeId: true },
    }),
    prisma.wayTotalEdges.findMany({
      where: { wayId: { in: wayIds } },
    }),
  ]);

  const hitNodeIds = new Set(userHits.map((r) => r.nodeId));
  if (hitNodeIds.size === 0) {
    return projectStreets.map((street) => ({
      osmId: street.osmId,
      percentage: 0,
      isComplete: false,
    }));
  }

  const wayNodes = await prisma.wayNode.findMany({
    where: {
      wayId: { in: wayIds },
      nodeId: { in: [...hitNodeIds] },
    },
    select: { wayId: true, nodeId: true },
  });

  const hitCountByWay = new Map<bigint, number>();
  for (const row of wayNodes) {
    if (hitNodeIds.has(row.nodeId)) {
      hitCountByWay.set(row.wayId, (hitCountByWay.get(row.wayId) ?? 0) + 1);
    }
  }

  const totalByWay = new Map(
    wayTotals.map((row) => [row.wayId, row.totalNodes])
  );

  return projectStreets.map((street) => {
    const wayId = osmIdToWayId(street.osmId);
    const nodesHit = hitCountByWay.get(wayId) ?? 0;
    const totalNodes = totalByWay.get(wayId) ?? 0;
    const percentage =
      totalNodes > 0
        ? Math.min(100, Math.round((nodesHit / totalNodes) * 100))
        : 0;
    const isComplete = isWayComplete(nodesHit, totalNodes);
    return {
      osmId: street.osmId,
      percentage,
      isComplete,
    };
  });
}

/**
 * Derive street completion from UserNodeHit + WayNode + WayTotalEdges (cumulative progress).
 * Only includes ways where the user has at least one node hit.
 */
export async function deriveStreetCompletion(
  userId: string
): Promise<StreetCompletion[]> {
  const userHits = await prisma.userNodeHit.findMany({
    where: { userId },
    select: { nodeId: true },
  });

  if (userHits.length === 0) return [];

  const hitNodeIds = new Set(userHits.map((r) => r.nodeId));
  const wayNodes = await prisma.wayNode.findMany({
    where: { nodeId: { in: [...hitNodeIds] } },
    select: { wayId: true, nodeId: true },
  });

  const hitCountByWay = new Map<bigint, number>();
  for (const row of wayNodes) {
    if (hitNodeIds.has(row.nodeId)) {
      hitCountByWay.set(row.wayId, (hitCountByWay.get(row.wayId) ?? 0) + 1);
    }
  }

  const wayIds = [...hitCountByWay.keys()];
  if (wayIds.length === 0) return [];

  const wayTotals = await prisma.wayTotalEdges.findMany({
    where: { wayId: { in: wayIds } },
  });
  const totalByWay = new Map(
    wayTotals.map((row) => [row.wayId, row.totalNodes])
  );

  const streets: StreetCompletion[] = [];

  for (const [wayId, nodesHit] of hitCountByWay.entries()) {
    const totalNodes = totalByWay.get(wayId) ?? 0;
    const row = wayTotals.find((r) => r.wayId === wayId);
    const name = row?.name ?? null;
    const isComplete = isWayComplete(nodesHit, totalNodes);
    streets.push({
      wayId,
      name,
      edgesTotal: totalNodes,
      edgesCompleted: nodesHit,
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
