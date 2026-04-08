/**
 * Re-sync all cities in CitySync so WayTotalEdges.geometry and WayNode.sequence
 * are populated (after PostGIS migration). Run from backend:
 *   npx tsx src/scripts/backfill-geometry.ts
 */
import "dotenv/config";
import prisma from "../lib/prisma.js";
import { syncCity } from "../services/city-sync.service.js";

async function main(): Promise<void> {
  const cities = await prisma.citySync.findMany();
  console.log(`[Backfill] Re-syncing ${cities.length} cities...`);
  for (const city of cities) {
    console.log(
      `[Backfill] ${city.name} (relation ${city.relationId.toString()})...`,
    );
    await syncCity(city.relationId, {
      name: city.name,
      adminLevel: city.adminLevel,
    });
  }
  console.log("[Backfill] Done.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
