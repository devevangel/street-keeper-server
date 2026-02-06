/**
 * Module 3: Way Resolver
 * 
 * Maps OSM node pairs to ways (streets) using Overpass API.
 * Uses WayCache to avoid per-run Overpass queries.
 * 
 * Includes retry logic with exponential backoff and multiple Overpass endpoints
 * to handle server overload (504 timeouts).
 */

import axios, { AxiosError } from "axios";
import prisma from "../../../lib/prisma.js";
import type { ResolvedEdge, WayResolverResult } from "../types.js";
import { PARSER_CONFIG } from "../config.js";

// Multiple Overpass endpoints for fallback when primary is overloaded
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// Batch size for Overpass queries (smaller = less likely to timeout)
const OVERPASS_BATCH_SIZE = 50;

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

interface OverpassWayElement {
  type: "way";
  id: number;
  nodes: number[];
  tags: {
    name?: string;
    highway?: string;
    [key: string]: string | undefined;
  };
}

interface OverpassResponse {
  elements: OverpassWayElement[];
}

/**
 * Sleep helper for exponential backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve node pairs to OSM ways
 * 
 * @param nodes - Array of OSM node IDs from OSRM match
 * @returns Resolved edges with way information
 */
export async function resolveWays(
  nodes: bigint[]
): Promise<WayResolverResult> {
  if (nodes.length < 2) {
    return {
      resolvedEdges: [],
      cacheHits: 0,
      cacheMisses: 0,
      warnings: [],
    };
  }

  // Step 1: Check cache for each unique node
  const uniqueNodes = [...new Set(nodes)];
  const cacheResults = await checkCache(uniqueNodes);
  const cacheHits = cacheResults.filter((r) => r.cached).length;
  const cacheMisses = cacheResults.filter((r) => !r.cached).length;

  // Step 2: Query Overpass for uncached nodes (unless using precomputed WayCache only)
  const uncachedNodes = cacheResults
    .filter((r) => !r.cached)
    .map((r) => r.nodeId);

  if (uncachedNodes.length > 0 && !PARSER_CONFIG.overpass.skipOverpass) {
    await queryAndCacheNodes(uncachedNodes);
  } else if (uncachedNodes.length > 0 && PARSER_CONFIG.overpass.skipOverpass) {
    console.log(
      `[WayResolver] SKIP_OVERPASS: ${uncachedNodes.length} uncached nodes (using WayCache only)`
    );
  }

  // Step 3: Build node pairs and resolve to ways
  const resolvedEdges: ResolvedEdge[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < nodes.length - 1; i++) {
    const nodeA = nodes[i];
    const nodeB = nodes[i + 1];

    // Get way information from cache
    const wayInfo = await resolveNodePairToWay(nodeA, nodeB);

    if (wayInfo) {
      resolvedEdges.push({
        nodeA,
        nodeB,
        wayId: BigInt(wayInfo.wayId),
        wayName: wayInfo.name || null,
        highwayType: wayInfo.highwayType || "unknown",
        lengthMeters: wayInfo.lengthMeters,
      });
    } else {
      warnings.push(
        `Could not resolve way for edge (${nodeA}, ${nodeB})`
      );
    }
  }

  return {
    resolvedEdges,
    cacheHits,
    cacheMisses,
    warnings,
  };
}

/**
 * Check cache for nodes
 */
async function checkCache(
  nodeIds: bigint[]
): Promise<Array<{ nodeId: bigint; cached: boolean }>> {
  const results = await Promise.all(
    nodeIds.map(async (nodeId) => {
      const cached = await prisma.wayCache.findUnique({
        where: { nodeId },
      });

      return {
        nodeId,
        cached: cached !== null && new Date(cached.expiresAt) > new Date(),
      };
    })
  );

  return results;
}

/**
 * Query Overpass for nodes and cache results.
 * Batches requests and uses retry logic with fallback endpoints.
 */
async function queryAndCacheNodes(nodeIds: bigint[]): Promise<void> {
  if (nodeIds.length === 0) return;

  // Split into batches to avoid timeouts on large queries
  const batches: bigint[][] = [];
  for (let i = 0; i < nodeIds.length; i += OVERPASS_BATCH_SIZE) {
    batches.push(nodeIds.slice(i, i + OVERPASS_BATCH_SIZE));
  }

  console.log(
    `[WayResolver] Processing ${nodeIds.length} nodes in ${batches.length} batch(es)`
  );

  // Process batches sequentially to avoid overwhelming Overpass
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    console.log(
      `[WayResolver] Batch ${batchIndex + 1}/${batches.length}: ${batch.length} nodes`
    );

    const waysByNode = await queryOverpassWithRetry(batch);
    await cacheWayResults(waysByNode);

    // Small delay between batches to be nice to Overpass
    if (batchIndex < batches.length - 1) {
      await sleep(500);
    }
  }
}

/**
 * Query Overpass with retry logic and fallback endpoints
 */
async function queryOverpassWithRetry(
  nodeIds: bigint[]
): Promise<Map<bigint, OverpassWayElement[]>> {
  const nodeIdList = nodeIds.map((id) => id.toString()).join(",");
  const query = `
    [out:json][timeout:${PARSER_CONFIG.overpass.timeout / 1000}];
    node(id:${nodeIdList});
    way(bn);
    out body;
  `;

  let lastError: Error | null = null;

  // Try each endpoint with retries
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(
          `[WayResolver] Trying ${endpoint} (attempt ${attempt}/${MAX_RETRIES})`
        );

        const response = await axios.post<OverpassResponse>(endpoint, query, {
          headers: { "Content-Type": "text/plain" },
          timeout: PARSER_CONFIG.overpass.timeout,
        });

        // Success - process response
        const waysByNode = new Map<bigint, OverpassWayElement[]>();

        for (const element of response.data.elements) {
          if (element.type === "way" && element.nodes) {
            for (const nodeId of element.nodes) {
              const nodeIdBigInt = BigInt(nodeId);
              if (!waysByNode.has(nodeIdBigInt)) {
                waysByNode.set(nodeIdBigInt, []);
              }
              waysByNode.get(nodeIdBigInt)!.push(element);
            }
          }
        }

        console.log(
          `[WayResolver] Success: found ${response.data.elements.length} ways`
        );
        return waysByNode;
      } catch (error) {
        lastError = error as Error;
        const axiosError = error as AxiosError;

        // Log the specific error
        const status = axiosError.response?.status;
        const isRetryable =
          status === 429 || status === 503 || status === 504 || !status;

        console.warn(
          `[WayResolver] ${endpoint} failed (${status || "network error"}): ${axiosError.message}`
        );

        if (isRetryable && attempt < MAX_RETRIES) {
          // Exponential backoff
          const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
          console.log(`[WayResolver] Retrying in ${backoffMs}ms...`);
          await sleep(backoffMs);
        }
      }
    }

    // Move to next endpoint
    console.log(`[WayResolver] Endpoint ${endpoint} exhausted, trying next...`);
  }

  // All endpoints failed
  console.error("[WayResolver] All Overpass endpoints failed");
  throw new Error(
    `Failed to query Overpass API after trying all endpoints. Last error: ${lastError?.message}`
  );
}

/**
 * Cache way results in database
 */
async function cacheWayResults(
  waysByNode: Map<bigint, OverpassWayElement[]>
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + PARSER_CONFIG.cache.wayExpiryDays);

  await Promise.all(
    Array.from(waysByNode.entries()).map(async ([nodeId, ways]) => {
      const wayIds = ways.map((w) => w.id);
      const wayMetadata: Record<string, any> = {};

      for (const way of ways) {
        // Calculate approximate length (using node count as proxy)
        const lengthMeters = (way.nodes.length - 1) * 10;

        wayMetadata[way.id.toString()] = {
          name: way.tags.name || null,
          highwayType: way.tags.highway || "unknown",
          nodeSequence: way.nodes.map((n) => BigInt(n)),
          lengthMeters,
        };
      }

      await prisma.wayCache.upsert({
        where: { nodeId },
        create: {
          nodeId,
          wayIds: wayIds.map((id) => id.toString()),
          wayMetadata,
          expiresAt,
        },
        update: {
          wayIds: wayIds.map((id) => id.toString()),
          wayMetadata,
          expiresAt,
        },
      });
    })
  );
}

/**
 * Resolve a node pair to a way
 * 
 * Validates that nodeA and nodeB are consecutive in the way's node sequence
 * (nodeIndex diff === 1) to prevent misattribution of edges.
 */
async function resolveNodePairToWay(
  nodeA: bigint,
  nodeB: bigint
): Promise<{
  wayId: number;
  name: string | null;
  highwayType: string;
  lengthMeters: number;
} | null> {
  // Get cached ways for both nodes
  const cacheA = await prisma.wayCache.findUnique({
    where: { nodeId: nodeA },
  });
  const cacheB = await prisma.wayCache.findUnique({
    where: { nodeId: nodeB },
  });

  if (!cacheA || !cacheB) {
    return null;
  }

  const wayIdsA = (cacheA.wayIds as string[]).map((id) => parseInt(id));
  const wayIdsB = (cacheB.wayIds as string[]).map((id) => parseInt(id));

  // Find ways that contain both nodes
  const commonWayIds = wayIdsA.filter((id) => wayIdsB.includes(id));

  if (commonWayIds.length === 0) {
    return null;
  }

  // Check each common way to find one where nodes are consecutive
  for (const wayId of commonWayIds) {
    const metadataA = (cacheA.wayMetadata as Record<string, any>)[
      wayId.toString()
    ];
    const metadataB = (cacheB.wayMetadata as Record<string, any>)[
      wayId.toString()
    ];

    if (!metadataA || !metadataB) {
      continue;
    }

    // Get nodeIndex for both nodes in this way
    const nodeIndexA = metadataA.nodeIndex as number | undefined;
    const nodeIndexB = metadataB.nodeIndex as number | undefined;

    // Primary check: verify nodes are consecutive using nodeIndex (most accurate)
    if (
      nodeIndexA !== undefined &&
      nodeIndexB !== undefined &&
      Math.abs(nodeIndexB - nodeIndexA) === 1
    ) {
      // Nodes are consecutive in this way - return it
      return {
        wayId,
        name: metadataA.name || null,
        highwayType: metadataA.highwayType || "unknown",
        lengthMeters: metadataA.lengthMeters || 10,
      };
    }

    // Fallback: if nodeIndex not available (e.g., Overpass-cached entries),
    // check nodeSequence to verify consecutive pairs
    const nodeSequence = metadataA.nodeSequence as string[] | bigint[] | undefined;
    if (nodeSequence) {
      const nodeAStr = nodeA.toString();
      const nodeBStr = nodeB.toString();
      // Handle both string[] (from PBF seed) and bigint[] (from Overpass)
      const seqAsStrings = nodeSequence.map((n) =>
        typeof n === "bigint" ? n.toString() : String(n)
      );
      const indexAInSeq = seqAsStrings.indexOf(nodeAStr);
      const indexBInSeq = seqAsStrings.indexOf(nodeBStr);

      if (
        indexAInSeq !== -1 &&
        indexBInSeq !== -1 &&
        Math.abs(indexBInSeq - indexAInSeq) === 1
      ) {
        // Nodes are consecutive in sequence - return it
        return {
          wayId,
          name: metadataA.name || null,
          highwayType: metadataA.highwayType || "unknown",
          lengthMeters: metadataA.lengthMeters || 10,
        };
      }
    }
    // If neither nodeIndex nor nodeSequence check passes, try next common way
  }

  // No way found where nodes are consecutive
  return null;
}
