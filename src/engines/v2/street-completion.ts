/**
 * V2 street completion from UserNodeHit + WayNode (CityStrides-style).
 * Exported for use by handlers and map.service (v2 map endpoint).
 */

import prisma from "../../lib/prisma.js";
import { normalizeStreetName } from "../../utils/normalize-street-name.js";
import type { StreetCompletion, GroupedStreet } from "./types.js";
import { NODE_PROXIMITY_CONFIG } from "./config.js";

const SHORT_THRESHOLD = NODE_PROXIMITY_CONFIG.shortStreetNodeThreshold;
const STANDARD_THRESHOLD = NODE_PROXIMITY_CONFIG.standardCompletionThreshold;

/** Min completion % to show a street in run results (filters intersection/overlap touches) */
const MIN_RUN_COMPLETION_PERCENT = 25;

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
  projectStreets: Array<{ osmId: string; lengthMeters: number }>,
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
    wayTotals.map((row) => [row.wayId, row.totalNodes]),
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
 * Derive project progress from UserNodeHit + WayNode, scoped to node hits
 * after project creation. Use this when updating project progress so only
 * runs after the project was created count.
 */
export async function deriveProjectProgressV2Scoped(
  userId: string,
  projectStreets: Array<{ osmId: string; lengthMeters: number }>,
  projectCreatedAt: Date,
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
      where: {
        userId,
        hitAt: { gte: projectCreatedAt },
      },
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
    wayTotals.map((row) => [row.wayId, row.totalNodes]),
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
 * Derive street completion for a specific run (node IDs from this GPX upload).
 * Only includes ways that were actually touched by this run, filtering out
 * intersection touches (streets with only 1-2 nodes hit).
 *
 * @param nodeIds - Set of node IDs hit in this run
 * @returns Street completion for streets touched in this run only
 */
export async function deriveStreetCompletionForRun(
  nodeIds: bigint[],
): Promise<StreetCompletion[]> {
  if (nodeIds.length === 0) return [];

  const hitNodeIds = new Set(nodeIds);

  // Find all ways that have at least one node in this run
  const wayNodes = await prisma.wayNode.findMany({
    where: { nodeId: { in: [...hitNodeIds] } },
    select: { wayId: true, nodeId: true },
  });

  // Count nodes hit per way (only counting nodes from this run)
  const hitCountByWay = new Map<bigint, number>();
  for (const row of wayNodes) {
    if (hitNodeIds.has(row.nodeId)) {
      hitCountByWay.set(row.wayId, (hitCountByWay.get(row.wayId) ?? 0) + 1);
    }
  }

  const wayIds = [...hitCountByWay.keys()];
  if (wayIds.length === 0) return [];

  // Get total nodes per way
  const wayTotals = await prisma.wayTotalEdges.findMany({
    where: { wayId: { in: wayIds } },
  });
  const totalByWay = new Map(
    wayTotals.map((row) => [row.wayId, row.totalNodes]),
  );

  const streets: StreetCompletion[] = [];

  for (const [wayId, nodesHit] of hitCountByWay.entries()) {
    const totalNodes = totalByWay.get(wayId) ?? 0;
    if (totalNodes === 0) continue;

    // Filter out intersection/overlap touches: only show streets where the user
    // ran a meaningful segment. Include if:
    // - Completion >= 25% (meaningful segment), OR
    // - Short street (≤5 nodes) AND at least 50% completion
    const isShortStreet = totalNodes <= 5;
    const completionPercent = (nodesHit / totalNodes) * 100;
    const meetsMinCompletion = completionPercent >= MIN_RUN_COMPLETION_PERCENT;
    const meetsShortStreetThreshold = isShortStreet && completionPercent >= 50;

    if (!meetsMinCompletion && !meetsShortStreetThreshold) {
      continue;
    }

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
 * Derive street completion for a given set of ways (e.g. map area).
 * Only queries UserNodeHit for nodes that belong to those ways - efficient for map view.
 */
export async function deriveStreetCompletionForArea(
  userId: string,
  wayIds: bigint[],
): Promise<StreetCompletion[]> {
  if (wayIds.length === 0) return [];

  const [wayNodes, wayTotals] = await Promise.all([
    prisma.wayNode.findMany({
      where: { wayId: { in: wayIds } },
      select: { wayId: true, nodeId: true },
    }),
    prisma.wayTotalEdges.findMany({
      where: { wayId: { in: wayIds } },
    }),
  ]);

  const nodeIdsInArea = [...new Set(wayNodes.map((r) => r.nodeId))];
  if (nodeIdsInArea.length === 0) {
    return wayTotals.map((row) => ({
      wayId: row.wayId,
      name: row.name,
      edgesTotal: row.totalNodes,
      edgesCompleted: 0,
      isComplete: false,
    }));
  }

  const userHits = await prisma.userNodeHit.findMany({
    where: {
      userId,
      nodeId: { in: nodeIdsInArea },
    },
    select: { nodeId: true },
  });

  const hitNodeIds = new Set(userHits.map((r) => r.nodeId));
  const hitCountByWay = new Map<bigint, number>();
  for (const row of wayNodes) {
    if (hitNodeIds.has(row.nodeId)) {
      hitCountByWay.set(row.wayId, (hitCountByWay.get(row.wayId) ?? 0) + 1);
    }
  }

  const totalByWay = new Map(
    wayTotals.map((row) => [row.wayId, row.totalNodes]),
  );

  const streets: StreetCompletion[] = wayTotals.map((row) => {
    const nodesHit = hitCountByWay.get(row.wayId) ?? 0;
    const totalNodes = row.totalNodes;
    const isComplete = isWayComplete(nodesHit, totalNodes);
    return {
      wayId: row.wayId,
      name: row.name,
      edgesTotal: totalNodes,
      edgesCompleted: nodesHit,
      isComplete,
    };
  });

  streets.sort((a, b) => {
    const nameA = a.name || "Unnamed";
    const nameB = b.name || "Unnamed";
    return nameA.localeCompare(nameB);
  });

  return streets;
}

/**
 * Derive street completion from UserNodeHit + WayNode + WayTotalEdges (cumulative progress).
 * Only includes ways where the user has at least one node hit.
 */
export async function deriveStreetCompletion(
  userId: string,
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
    wayTotals.map((row) => [row.wayId, row.totalNodes]),
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
 * Uses normalized key so "Park Road" and "Park Road (A3066)" group together.
 */
export function groupStreetsByName(
  streets: StreetCompletion[],
): GroupedStreet[] {
  const byName = new Map<string, StreetCompletion[]>();

  for (const street of streets) {
    const key = normalizeStreetName(street.name || "Unnamed") || "unnamed";
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(street);
  }

  return Array.from(byName.entries())
    .map(([, ways]) => {
      const displayName = ways[0]?.name || "Unnamed";
      const edgesTotal = ways.reduce((sum, w) => sum + w.edgesTotal, 0);
      const edgesCompleted = ways.reduce((sum, w) => sum + w.edgesCompleted, 0);
      const isComplete = ways.every((w) => w.isComplete);
      const completionPercent =
        edgesTotal > 0 ? Math.round((edgesCompleted / edgesTotal) * 100) : 0;
      return {
        name: displayName,
        wayIds: ways.map((w) => String(w.wayId)),
        edgesTotal,
        edgesCompleted,
        isComplete,
        completionPercent,
      };
    })
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
