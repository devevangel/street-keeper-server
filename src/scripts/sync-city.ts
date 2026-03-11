/**
 * Manually sync a city from Overpass into NodeCache, WayNode, WayTotalEdges.
 *
 * Usage (from backend directory):
 *   npx tsx src/scripts/sync-city.ts --lat 50.7889 --lng -1.0743
 *   npx tsx src/scripts/sync-city.ts --relation 55130
 *   npm run sync:city -- --lat 50.7889 --lng -1.0743
 *
 * --lat, --lng   Center point; city is detected via Overpass is_in, then synced.
 * --relation     OSM relation ID of the city; sync that city directly.
 *
 * Requires: DATABASE_URL in .env
 */

import "dotenv/config";

import { detectCity, syncCity } from "../services/city-sync.service.js";

function parseArgs(): { lat?: number; lng?: number; relation?: bigint } {
  const args = process.argv.slice(2);
  let lat: number | undefined;
  let lng: number | undefined;
  let relation: bigint | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--lat" && args[i + 1] != null) {
      lat = parseFloat(args[i + 1]);
      i++;
    } else if (args[i] === "--lng" && args[i + 1] != null) {
      lng = parseFloat(args[i + 1]);
      i++;
    } else if (args[i] === "--relation" && args[i + 1] != null) {
      relation = BigInt(args[i + 1]);
      i++;
    }
  }

  return { lat, lng, relation };
}

async function main(): Promise<void> {
  const { lat, lng, relation } = parseArgs();

  if (relation != null) {
    console.log(`[SyncCity] Syncing city by relation ID: ${relation}`);
    const record = await syncCity(relation);
    console.log(
      `[SyncCity] Done. ${record.name} — nodes: ${record.nodeCount}, ways: ${record.wayCount}`,
    );
    return;
  }

  if (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)) {
    const city = await detectCity(lat, lng);
    if (!city) {
      console.error("[SyncCity] No city found for this point.");
      process.exit(1);
    }
    console.log(
      `[SyncCity] Detected: ${city.name} (relation ${city.relationId}, admin_level ${city.adminLevel})`,
    );
    const record = await syncCity(city.relationId, {
      name: city.name,
      adminLevel: city.adminLevel,
    });
    console.log(
      `[SyncCity] Done. nodes: ${record.nodeCount}, ways: ${record.wayCount}`,
    );
    return;
  }

  console.error(
    "[SyncCity] Use --lat and --lng or --relation. Example: --lat 50.7889 --lng -1.0743",
  );
  process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
