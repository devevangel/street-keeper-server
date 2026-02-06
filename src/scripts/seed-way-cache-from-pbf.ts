/**
 * Seed WayCache from a local OSM PBF file (e.g. Hampshire).
 *
 * Reads the PBF with tiny-osmpbf (supports current Geofabrik PBFs), builds
 * node→way mappings (WayCache) and way→totalEdges (WayTotalEdges). After
 * running this, the v2 engine (engine-v2) can resolve ways and street completion without Overpass.
 *
 * Usage (from backend directory):
 *   npx tsx src/scripts/seed-way-cache-from-pbf.ts [path-to.osm.pbf]
 *
 * Default PBF path: src/engines/v2/hampshire-260204.osm.pbf (place your PBF there or pass path as argument)
 *
 * Requires: DATABASE_URL in .env
 *
 * If you hit "JavaScript heap out of memory", run with a larger heap:
 *   NODE_OPTIONS=--max-old-space-size=8192 npm run seed:way-cache
 * (Windows PowerShell: $env:NODE_OPTIONS="--max-old-space-size=8192"; npm run seed:way-cache)
 */

import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

// tiny-osmpbf: use handler callback to avoid holding full result.elements in memory.
// With handler, elements are not accumulated; we only build nodeToWays (ways only).
// @ts-expect-error - no types for tiny-osmpbf
import tinyosmpbf from "tiny-osmpbf";

import type { Prisma } from "../generated/prisma/client.js";
import prisma from "../lib/prisma.js";

// Default: engines/v2 (place PBF there or pass path as argument)
const DEFAULT_PBF = path.join(
  process.cwd(),
  "src",
  "engines",
  "v2",
  "hampshire-260204.osm.pbf",
);

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
}

/** Result of PBF parse: node→ways map and way→total map */
interface PbfResult {
  nodeToWays: Map<bigint, WayEntry[]>;
  wayTotals: Map<number, WayTotal>;
}

/**
 * Build nodeId → list of way entries and wayId → totalEdges from PBF using handler callback.
 * Avoids loading full result.elements into memory; only nodeToWays and wayTotals are kept.
 */
function pbfToNodeWays(pbfPath: string): PbfResult {
  const nodeToWays = new Map<bigint, WayEntry[]>();
  const wayTotals = new Map<number, WayTotal>();

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
    const lengthMeters = totalEdges * 10;

    wayTotals.set(wayId, { wayId, name, highwayType, totalEdges });

    // Convert node IDs to BigInt for nodeSequence
    const nodeSequence = nodes.map((n) => BigInt(n));

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

  return { nodeToWays, wayTotals };
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
            name: w.name,
            highwayType: w.highwayType,
          },
          update: {
            totalEdges: w.totalEdges,
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
  const pbfPath = process.argv[2] ?? DEFAULT_PBF;
  const resolved = path.isAbsolute(pbfPath)
    ? pbfPath
    : path.join(process.cwd(), pbfPath);

  console.log("Seed WayCache from PBF");
  console.log("PBF path:", resolved);
  if (!fs.existsSync(resolved)) {
    console.error(
      "File not found. Usage: npx tsx src/scripts/seed-way-cache-from-pbf.ts [path-to.osm.pbf]",
    );
    process.exit(1);
  }

  console.log("Reading PBF and building node→way and way→totalEdges index...");
  const { nodeToWays, wayTotals } = pbfToNodeWays(resolved);
  console.log(
    `  Found ${nodeToWays.size} nodes, ${wayTotals.size} ways.`,
  );

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + EXPIRES_DAYS);

  console.log("Upserting into WayCache (batches of", BATCH_SIZE, ")...");
  const { inserted } = await upsertWayCacheBatches(nodeToWays, expiresAt);
  console.log("WayCache rows:", inserted);

  console.log("Upserting into WayTotalEdges (batches of", WAY_TOTAL_BATCH, ")...");
  const { inserted: wayTotalRows } = await upsertWayTotalEdgesBatches(wayTotals);
  console.log("Done. WayTotalEdges rows:", wayTotalRows);
  console.log(
    "You can set SKIP_OVERPASS=true and run engine-v2 without Overpass.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
