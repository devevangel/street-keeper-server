/**
 * Module 4: Edge Builder
 *
 * Builds and validates edges from resolved node pairs.
 * Applies binary validation gates: pass = accept, fail = reject.
 */

import type { ResolvedEdge } from "../types.js";
import type { ValidatedEdge, EdgeBuilderResult } from "../types.js";
import { PARSER_CONFIG } from "../config.js";

/**
 * Build and validate edges from resolved node pairs
 *
 * @param resolvedEdges - Edges with way information from way resolver
 * @param nodes - Original OSM node sequence from OSRM
 * @param timestamps - Optional timestamps for speed validation
 * @returns Validated edges (valid and rejected)
 */
export function buildAndValidateEdges(
  resolvedEdges: ResolvedEdge[],
  nodes: bigint[],
  timestamps?: (string | null)[]
): EdgeBuilderResult {
  const validEdges: ValidatedEdge[] = [];
  const rejectedEdges: ValidatedEdge[] = [];
  const rejectionReasons: Record<string, number> = {};

  // Step 1: Count edges per way (for anti-crossing filter)
  const edgesByWay = new Map<bigint, number>();
  for (const resolved of resolvedEdges) {
    const count = edgesByWay.get(resolved.wayId) || 0;
    edgesByWay.set(resolved.wayId, count + 1);
  }

  // Step 2: Validate each edge
  for (const resolved of resolvedEdges) {
    // Normalize edge (nodeA < nodeB always)
    const nodeA =
      resolved.nodeA < resolved.nodeB ? resolved.nodeA : resolved.nodeB;
    const nodeB =
      resolved.nodeA < resolved.nodeB ? resolved.nodeB : resolved.nodeA;
    const edgeId = `${nodeA}-${nodeB}`;

    const edge: ValidatedEdge = {
      edgeId,
      nodeA,
      nodeB,
      wayId: resolved.wayId,
      wayName: resolved.wayName,
      highwayType: resolved.highwayType,
      lengthMeters: resolved.lengthMeters,
      isValid: false,
    };

    // Rule 1: Consecutive nodes check
    if (!isConsecutiveInPath(nodeA, nodeB, nodes)) {
      edge.isValid = false;
      edge.rejectionReason = "not_consecutive";
      rejectedEdges.push(edge);
      rejectionReasons["not_consecutive"] =
        (rejectionReasons["not_consecutive"] || 0) + 1;
      continue;
    }

    // Rule 2: Minimum length
    if (resolved.lengthMeters < PARSER_CONFIG.validation.minEdgeLengthMeters) {
      edge.isValid = false;
      edge.rejectionReason = "too_short";
      rejectedEdges.push(edge);
      rejectionReasons["too_short"] =
        (rejectionReasons["too_short"] || 0) + 1;
      continue;
    }

    // Rule 3: Valid way (highway type check)
    if (
      PARSER_CONFIG.validation.excludedHighwayTypes.includes(
        resolved.highwayType
      )
    ) {
      edge.isValid = false;
      edge.rejectionReason = "excluded_highway_type";
      rejectedEdges.push(edge);
      rejectionReasons["excluded_highway_type"] =
        (rejectionReasons["excluded_highway_type"] || 0) + 1;
      continue;
    }

    // Rule 4: Anti-crossing filter
    const edgesOnWay = edgesByWay.get(resolved.wayId) || 0;
    if (edgesOnWay < 2 && resolved.lengthMeters < 20) {
      edge.isValid = false;
      edge.rejectionReason = "anti_crossing";
      rejectedEdges.push(edge);
      rejectionReasons["anti_crossing"] =
        (rejectionReasons["anti_crossing"] || 0) + 1;
      continue;
    }

    // Rule 5: Speed sanity check (optional)
    if (timestamps && timestamps.length > 0) {
      const nodeAIndex = nodes.indexOf(nodeA);
      const nodeBIndex = nodes.indexOf(nodeB);

      if (
        nodeAIndex >= 0 &&
        nodeBIndex >= 0 &&
        nodeAIndex < timestamps.length &&
        nodeBIndex < timestamps.length &&
        timestamps[nodeAIndex] &&
        timestamps[nodeBIndex]
      ) {
        const timeA = new Date(timestamps[nodeAIndex]!).getTime();
        const timeB = new Date(timestamps[nodeBIndex]!).getTime();
        const timeDeltaSeconds = Math.abs(timeB - timeA) / 1000;

        if (timeDeltaSeconds > 0) {
          const speedMps = resolved.lengthMeters / timeDeltaSeconds;
          if (speedMps > PARSER_CONFIG.validation.maxSpeedMps) {
            edge.isValid = false;
            edge.rejectionReason = "speed_too_high";
            rejectedEdges.push(edge);
            rejectionReasons["speed_too_high"] =
              (rejectionReasons["speed_too_high"] || 0) + 1;
            continue;
          }
        }
      }
    }

    edge.isValid = true;
    validEdges.push(edge);
  }

  return {
    validEdges,
    rejectedEdges,
    statistics: {
      totalEdges: resolvedEdges.length,
      validCount: validEdges.length,
      rejectedCount: rejectedEdges.length,
      rejectionReasons,
    },
  };
}

/**
 * Check if edge appears as consecutive nodes in path
 */
function isConsecutiveInPath(
  nodeA: bigint,
  nodeB: bigint,
  path: bigint[]
): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    const curr = path[i];
    const next = path[i + 1];
    if (
      (curr === nodeA && next === nodeB) ||
      (curr === nodeB && next === nodeA)
    ) {
      return true;
    }
  }
  return false;
}
