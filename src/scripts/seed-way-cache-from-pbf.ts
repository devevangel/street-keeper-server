/**
 * Seed WayCache from a local OSM PBF file (e.g. Hampshire).
 *
 * Reads the PBF with tiny-osmpbf (supports current Geofabrik PBFs), builds
 * node→way mappings (WayCache) and way→totalEdges (WayTotalEdges). After
 * running this, the v2 engine (engine-v2) can resolve ways and street completion without Overpass.
 *
 * Usage (from backend directory):
 *   npx tsx src/scripts/seed-way-cache-from-pbf.ts [path-to.osm.pbf]
 *   npx tsx src/scripts/seed-way-cache-from-pbf.ts --node-cache-only [path-to.osm.pbf]
 *   npx tsx src/scripts/seed-way-cache-from-pbf.ts --way-nodes-only [path-to.osm.pbf]
 *
 * --node-cache-only  Skip Pass 1; load node IDs from existing WayCache and run only Pass 2 (NodeCache).
 * --way-nodes-only  Skip Pass 1 and 2; load WayCache and populate WayNode + WayTotalEdges.totalNodes only.
 *
 * Default PBF path: src/hampshire-260206.osm.pbf (place your PBF there or pass path as argument)
 *
 * Requires: DATABASE_URL in .env
 *
 * Pass 2 streams node coords to a temp file then upserts in batches to avoid OOM
 * on large regions (~7M nodes). If you still hit heap limit, increase heap:
 *   NODE_OPTIONS=--max-old-space-size=8192 npm run seed:way-cache
 * (Windows PowerShell: $env:NODE_OPTIONS="--max-old-space-size=8192"; npm run seed:way-cache)
 */

import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

// tiny-osmpbf: use handler callback to avoid holding full result.elements in memory.
// With handler, elements are not accumulated; we only build nodeToWays (ways only).
// @ts-expect-error - no types for tiny-osmpbf
import tinyosmpbf from "tiny-osmpbf";

import type { Prisma } from "../generated/prisma/client.js";
import prisma from "../lib/prisma.js";

// Default: src (place PBF there or pass path as argument)
const DEFAULT_PBF = path.join(process.cwd(), "src", "hampshire-260206.osm.pbf");

const BATCH_SIZE = 2000;
const EXPIRES_DAYS = 365; // 1 year for precomputed data

/** Minimal way metadata for WayCache (way-resolver uses name, highwayType, lengthMeters, nodeIndex, nodeSequence). */
interface WayEntry {
  wayId: number;
  name: string | null;
  highwayType: string;
  lengthMeters: number;
  nodeIndex: number; // Position of this node in the way's node sequence (0-based)
  nodeSequence: bigint[]; // Full node sequence for this way (for consecutive pair validation)
}

/** Per-way totals for WayTotalEdges table */
interface WayTotal {
  wayId: number;
  name: string | null;
  highwayType: string;
  totalEdges: number;
  totalNodes: number;
}

/** Result of PBF parse: node→ways map, way→total map, way→nodes for WayNode, and referenced node IDs */
interface PbfResult {
  nodeToWays: Map<bigint, WayEntry[]>;
  wayTotals: Map<number, WayTotal>;
  wayToNodeIds: Map<number, bigint[]>;
  referencedNodeIds: Set<bigint>;
}

/** Node coordinate for NodeCache */
interface NodeCoord {
  nodeId: bigint;
  lat: number;
  lon: number;
}

/**
 * Build nodeId → list of way entries and wayId → totalEdges from PBF using handler callback.
 * Avoids loading full result.elements into memory; only nodeToWays and wayTotals are kept.
 */
function pbfToNodeWays(pbfPath: string): PbfResult {
  const nodeToWays = new Map<bigint, WayEntry[]>();
  const wayTotals = new Map<number, WayTotal>();
  const wayToNodeIds = new Map<number, bigint[]>();
  const referencedNodeIds = new Set<bigint>();

  const buf = fs.readFileSync(pbfPath);
  tinyosmpbf(buf, (el: { type?: string; id?: number; nodes?: number[]; tags?: Record<string, string> }) => {
    if (!el || el.type !== "way") return;
    const nodes = el.nodes;
    if (!nodes || nodes.length < 2) return;

    const wayId = Number(el.id);
    const tags = el.tags ?? {};
    const name = tags.name ?? null;
    const highwayType = tags.highway ?? "unknown";
    const totalEdges = nodes.length - 1;
    const totalNodes = nodes.length;
    const lengthMeters = totalEdges * 10;

    wayTotals.set(wayId, { wayId, name, highwayType, totalEdges, totalNodes });

    // Convert node IDs to BigInt for nodeSequence and collect for NodeCache (pass 2)
    const nodeSequence = nodes.map((n) => BigInt(n));
    wayToNodeIds.set(wayId, nodeSequence);
    for (const n of nodeSequence) referencedNodeIds.add(n);

    // Create entries for each node with its index position
    for (let i = 0; i < nodes.length; i++) {
      const nodeId = BigInt(nodes[i]);
      const entry: WayEntry = {
        wayId,
        name,
        highwayType,
        lengthMeters,
        nodeIndex: i, // Position in the way's sequence (0-based)
        nodeSequence, // Full sequence for consecutive pair validation
      };

      if (!nodeToWays.has(nodeId)) nodeToWays.set(nodeId, []);
      nodeToWays.get(nodeId)!.push(entry);
    }
  });

  return { nodeToWays, wayTotals, wayToNodeIds, referencedNodeIds };
}

const NODE_CACHE_BATCH = 2000;
const WAY_CACHE_QUERY_BATCH = 100_000;

/**
 * Load the set of node IDs that are in WayCache (for --node-cache-only).
 * Reads in batches to avoid loading all rows into memory at once.
 */
async function loadReferencedNodeIdsFromWayCache(): Promise<Set<bigint>> {
  const referencedNodeIds = new Set<bigint>();
  let cursor: { nodeId: bigint } | undefined;
  let total = 0;
  console.log("  Loading node IDs from WayCache (batches of", WAY_CACHE_QUERY_BATCH, ")...");
  while (true) {
    const batch = await prisma.wayCache.findMany({
      select: { nodeId: true },
      take: WAY_CACHE_QUERY_BATCH,
      orderBy: { nodeId: "asc" },
      ...(cursor ? { skip: 1, cursor } : {}),
    });
    if (batch.length === 0) break;
    for (const row of batch) referencedNodeIds.add(row.nodeId);
    total += batch.length;
    console.log(`  Loaded ${total} node IDs...`);
    if (batch.length < WAY_CACHE_QUERY_BATCH) break;
    cursor = { nodeId: batch[batch.length - 1].nodeId };
  }
  console.log(`  Total referenced node IDs: ${referencedNodeIds.size}`);
  return referencedNodeIds;
}

/**
 * Pass 2: Stream node coordinates to a temp file (never hold all in memory), then
 * read back in batches and upsert into NodeCache. Avoids OOM on large PBFs (~7M nodes).
 */
async function streamNodesToNodeCache(
  pbfPath: string,
  referencedNodeIds: Set<bigint>,
): Promise<number> {
  const tmpDir = path.join(process.cwd(), "node_modules", ".cache");
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `nodecache-${Date.now()}.ndjson`);

  console.log("  Streaming matching nodes to temp file...");
  const buf = fs.readFileSync(pbfPath);
  const out = fs.createWriteStream(tmpFile, { encoding: "utf8" });
  let written = 0;
  tinyosmpbf(buf, (el: { type?: string; id?: number; lat?: number; lon?: number }) => {
    if (!el || el.type !== "node") return;
    const nodeId = BigInt(el.id!);
    if (!referencedNodeIds.has(nodeId)) return;
    const lat = el.lat;
    const lon = el.lon;
    if (lat == null || lon == null) return;
    out.write(JSON.stringify({ nodeId: nodeId.toString(), lat, lon }) + "\n");
    written++;
  });
  out.end();
  await new Promise<void>((resolve, reject) => {
    out.on("finish", resolve);
    out.on("error", reject);
  });
  console.log(`  Wrote ${written} node coordinates to temp file.`);

  // Read temp file line-by-line and upsert in batches (never load all lines into memory)
  const rl = readline.createInterface({
    input: fs.createReadStream(tmpFile, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let batch: NodeCoord[] = [];
  let inserted = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const o = JSON.parse(line) as { nodeId: string; lat: number; lon: number };
    batch.push({ nodeId: BigInt(o.nodeId), lat: o.lat, lon: o.lon });
    if (batch.length >= NODE_CACHE_BATCH) {
      await Promise.all(
        batch.map((n) =>
          prisma.nodeCache.upsert({
            where: { nodeId: n.nodeId },
            create: { nodeId: n.nodeId, lat: n.lat, lon: n.lon },
            update: { lat: n.lat, lon: n.lon },
          }),
        ),
      );
      inserted += batch.length;
      console.log(`  NodeCache: ${inserted} nodes...`);
      batch = [];
    }
  }
  if (batch.length > 0) {
    await Promise.all(
      batch.map((n) =>
        prisma.nodeCache.upsert({
          where: { nodeId: n.nodeId },
          create: { nodeId: n.nodeId, lat: n.lat, lon: n.lon },
          update: { lat: n.lat, lon: n.lon },
        }),
      ),
    );
    inserted += batch.length;
  }
  fs.unlinkSync(tmpFile);
  return inserted;
}

/** Upsert WayCache in batches */
async function upsertWayCacheBatches(
  nodeToWays: Map<bigint, WayEntry[]>,
  expiresAt: Date,
): Promise<{ inserted: number }> {
  const entries = Array.from(nodeToWays.entries());
  let inserted = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(([nodeId, ways]) => {
        const wayIds = ways.map((w) => String(w.wayId));
        const wayMetadata: Record<string, unknown> = {};
        for (const w of ways) {
          // Store metadata per way, including nodeIndex and nodeSequence for consecutive pair validation
          wayMetadata[String(w.wayId)] = {
            name: w.name,
            highwayType: w.highwayType,
            lengthMeters: w.lengthMeters,
            nodeIndex: w.nodeIndex,
            nodeSequence: w.nodeSequence.map((n) => n.toString()), // Store as string array for JSON
          };
        }
        return prisma.wayCache.upsert({
          where: { nodeId },
          create: {
            nodeId,
            wayIds,
            wayMetadata: wayMetadata as Prisma.InputJsonValue,
            expiresAt,
          },
          update: {
            wayIds,
            wayMetadata: wayMetadata as Prisma.InputJsonValue,
            expiresAt,
          },
        });
      }),
    );
    inserted += batch.length;
    console.log(`  Upserted ${inserted}/${entries.length} nodes...`);
  }

  return { inserted };
}

/** Upsert WayNode rows and set totalNodes on WayTotalEdges (CityStrides-style completion). */
async function upsertWayNodesAndTotalNodes(
  wayToNodeIds: Map<number, bigint[]>,
): Promise<{ wayNodesInserted: number; waysUpdated: number }> {
  const WAY_NODE_BATCH = 5000;
  const entries = Array.from(wayToNodeIds.entries());
  let wayNodesInserted = 0;

  // Update totalNodes on WayTotalEdges
  for (const [wayId, nodeIds] of entries) {
    await prisma.wayTotalEdges.updateMany({
      where: { wayId: BigInt(wayId) },
      data: { totalNodes: nodeIds.length },
    });
  }
  console.log(`  WayTotalEdges.totalNodes updated for ${entries.length} ways.`);

  // Build all (wayId, nodeId) pairs
  const pairs: { wayId: bigint; nodeId: bigint }[] = [];
  for (const [wayId, nodeIds] of entries) {
    const w = BigInt(wayId);
    for (const nodeId of nodeIds) {
      pairs.push({ wayId: w, nodeId });
    }
  }

  for (let i = 0; i < pairs.length; i += WAY_NODE_BATCH) {
    const batch = pairs.slice(i, i + WAY_NODE_BATCH);
    await prisma.wayNode.createMany({
      data: batch,
      skipDuplicates: true,
    });
    wayNodesInserted += batch.length;
    console.log(`  WayNode: ${wayNodesInserted}/${pairs.length} rows...`);
  }

  return { wayNodesInserted: pairs.length, waysUpdated: entries.length };
}

const WAY_CACHE_CURSOR_BATCH = 2000;
const WAY_NODE_INSERT_BATCH = 5000;

/**
 * Stream WayCache with cursor and populate WayNode + WayTotalEdges.totalNodes
 * without loading all rows into memory (avoids OOM on large regions).
 */
async function streamWayCacheAndPopulateWayNodes(): Promise<{
  waysUpdated: number;
  wayNodesInserted: number;
}> {
  let waysUpdated = 0;
  let wayNodesInserted = 0;
  const processedWayIds = new Set<number>();
  let cursor: { nodeId: bigint } | undefined;
  let batchCount = 0;

  console.log("  Streaming WayCache (cursor batch:", WAY_CACHE_CURSOR_BATCH, ")...");

  while (true) {
    batchCount += 1;
    const batch = await prisma.wayCache.findMany({
      select: { nodeId: true, wayIds: true, wayMetadata: true },
      take: WAY_CACHE_CURSOR_BATCH,
      orderBy: { nodeId: "asc" },
      ...(cursor ? { skip: 1, cursor } : {}),
    });

    if (batch.length === 0) break;
    console.log(`  WayCache batch ${batchCount}: fetched ${batch.length} rows, processing...`);

    for (const row of batch) {
      const wayIds = row.wayIds as string[];
      const meta = (row.wayMetadata as Record<string, { nodeSequence?: string[] | bigint[] }>) ?? {};
      for (const wid of wayIds) {
        const wayId = Number(wid);
        if (processedWayIds.has(wayId)) continue;
        const seq = meta[wid]?.nodeSequence;
        if (!Array.isArray(seq) || seq.length === 0) continue;

        processedWayIds.add(wayId);
        const nodeIds = seq.map((n) => (typeof n === "bigint" ? n : BigInt(n)));

        await prisma.wayTotalEdges.updateMany({
          where: { wayId: BigInt(wayId) },
          data: { totalNodes: nodeIds.length },
        });
        waysUpdated += 1;

        if (waysUpdated % 500 === 0) {
          console.log(`  Progress: ${waysUpdated} ways, ${wayNodesInserted} WayNode rows...`);
        }

        const wayIdBig = BigInt(wayId);
        for (let i = 0; i < nodeIds.length; i += WAY_NODE_INSERT_BATCH) {
          const chunk = nodeIds.slice(i, i + WAY_NODE_INSERT_BATCH);
          await prisma.wayNode.createMany({
            data: chunk.map((nodeId) => ({ wayId: wayIdBig, nodeId })),
            skipDuplicates: true,
          });
          wayNodesInserted += chunk.length;
        }
      }
    }

    console.log(`  Batch ${batchCount} done: ${waysUpdated} ways total, ${wayNodesInserted} WayNode rows so far.`);

    if (batch.length < WAY_CACHE_CURSOR_BATCH) break;
    cursor = { nodeId: batch[batch.length - 1]!.nodeId };
  }

  return { waysUpdated, wayNodesInserted };
}

const WAY_TOTAL_BATCH = 1000;

/** Upsert WayTotalEdges in batches (one row per way). */
async function upsertWayTotalEdgesBatches(
  wayTotals: Map<number, WayTotal>,
): Promise<{ inserted: number }> {
  const entries = Array.from(wayTotals.values());
  let inserted = 0;

  for (let i = 0; i < entries.length; i += WAY_TOTAL_BATCH) {
    const batch = entries.slice(i, i + WAY_TOTAL_BATCH);
    await Promise.all(
      batch.map((w) =>
        prisma.wayTotalEdges.upsert({
          where: { wayId: BigInt(w.wayId) },
          create: {
            wayId: BigInt(w.wayId),
            totalEdges: w.totalEdges,
            totalNodes: w.totalNodes,
            name: w.name,
            highwayType: w.highwayType,
          },
          update: {
            totalEdges: w.totalEdges,
            totalNodes: w.totalNodes,
            name: w.name,
            highwayType: w.highwayType,
          },
        }),
      ),
    );
    inserted += batch.length;
    console.log(`  WayTotalEdges: ${inserted}/${entries.length} ways...`);
  }

  return { inserted };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const nodeCacheOnly = argv.includes("--node-cache-only");
  const wayNodesOnly = argv.includes("--way-nodes-only");
  const pbfPathArg = argv.filter(
    (a) => a !== "--node-cache-only" && a !== "--way-nodes-only",
  )[0];
  const pbfPath = pbfPathArg ?? DEFAULT_PBF;
  const resolved = path.isAbsolute(pbfPath)
    ? pbfPath
    : path.join(process.cwd(), pbfPath);

  console.log("Seed WayCache from PBF");
  if (nodeCacheOnly) console.log("Mode: --node-cache-only (Pass 2: NodeCache only)");
  if (wayNodesOnly) console.log("Mode: --way-nodes-only (WayNode + totalNodes only)");
  if (!wayNodesOnly) console.log("PBF path:", resolved);
  if (!wayNodesOnly && !fs.existsSync(resolved)) {
    console.error(
      "File not found. Usage: npx tsx src/scripts/seed-way-cache-from-pbf.ts [path-to.osm.pbf]",
    );
    process.exit(1);
  }

  if (wayNodesOnly) {
    console.log("Streaming WayCache and populating WayNode + WayTotalEdges.totalNodes...");
    const { waysUpdated, wayNodesInserted } = await streamWayCacheAndPopulateWayNodes();
    if (waysUpdated === 0) {
      console.error("No ways updated. Is WayCache empty or missing wayMetadata.nodeSequence? Run full seed first.");
      process.exit(1);
    }
    console.log("Ways updated:", waysUpdated, "| WayNode rows:", wayNodesInserted);
    console.log("Done.");
    return;
  }

  let referencedNodeIds: Set<bigint>;

  if (nodeCacheOnly) {
    console.log("Pass 2 only: Loading referenced node IDs from existing WayCache...");
    referencedNodeIds = await loadReferencedNodeIdsFromWayCache();
    if (referencedNodeIds.size === 0) {
      console.error("WayCache is empty. Run the full seed first (without --node-cache-only).");
      process.exit(1);
    }
  } else {
    console.log("Pass 1: Reading PBF and building node→way and way→totalEdges index...");
    const result = pbfToNodeWays(resolved);
    referencedNodeIds = result.referencedNodeIds;

    // Extract what we need, then free the PbfResult wrapper
    let nodeToWays: Map<bigint, WayEntry[]> | null = result.nodeToWays;
    let wayTotals: Map<number, WayTotal> | null = result.wayTotals;
    let wayToNodeIds: Map<number, bigint[]> | null = result.wayToNodeIds;

    console.log(
      `  Found ${nodeToWays.size} nodes, ${wayTotals.size} ways, ${referencedNodeIds.size} referenced node IDs.`,
    );

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + EXPIRES_DAYS);

    console.log("Upserting into WayCache (batches of", BATCH_SIZE, ")...");
    const { inserted } = await upsertWayCacheBatches(nodeToWays, expiresAt);
    console.log("WayCache rows:", inserted);

    // Free nodeToWays — no longer needed (largest structure: ~7M entries with nested arrays)
    nodeToWays.clear();
    nodeToWays = null;
    console.log("  [Memory] Freed nodeToWays map.");

    console.log("Upserting into WayTotalEdges (batches of", WAY_TOTAL_BATCH, ")...");
    const { inserted: wayTotalRows } = await upsertWayTotalEdgesBatches(wayTotals);
    console.log("WayTotalEdges rows:", wayTotalRows);

    // Free wayTotals — no longer needed
    wayTotals.clear();
    wayTotals = null;
    console.log("  [Memory] Freed wayTotals map.");

    console.log("Pass 3: Upserting WayNode and totalNodes...");
    const { wayNodesInserted, waysUpdated } = await upsertWayNodesAndTotalNodes(wayToNodeIds);
    console.log("WayNode rows:", wayNodesInserted, "| Ways updated:", waysUpdated);

    // Free wayToNodeIds — no longer needed
    wayToNodeIds.clear();
    wayToNodeIds = null;
    console.log("  [Memory] Freed wayToNodeIds map.");

    // Hint GC to reclaim freed memory before Pass 2 reads the PBF buffer again
    if (global.gc) {
      console.log("  [Memory] Running manual GC...");
      global.gc();
    }
  }

  console.log("Pass 2: Streaming node coordinates to NodeCache (temp file + batched upsert)...");
  const nodeCacheRows = await streamNodesToNodeCache(resolved, referencedNodeIds);
  console.log("NodeCache rows:", nodeCacheRows);

  console.log("Done.");
  console.log(
    "You can set SKIP_OVERPASS=true and run engine-v2 without Overpass.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
