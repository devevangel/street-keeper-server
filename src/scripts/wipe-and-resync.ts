/**
 * Wipe activity-related data so you can Sync with Strava and re-process from scratch.
 *
 * Deletes in order (respecting FKs):
 *   1. ProjectActivity
 *   2. UserStreetProgress
 *   3. Activity
 *
 * Keeps: User, Project, GeometryCache.
 * After running, click Sync with Strava to re-fetch and fully re-process.
 *
 * Usage (from backend directory):
 *   npm run wipe:and-resync
 *
 * Requires: DATABASE_URL in .env
 */

import "dotenv/config";

import prisma from "../lib/prisma.js";

async function main(): Promise<void> {
  const pa = await prisma.projectActivity.deleteMany({});
  console.log(`[Wipe] Deleted ${pa.count} ProjectActivity rows.`);

  const usp = await prisma.userStreetProgress.deleteMany({});
  console.log(`[Wipe] Deleted ${usp.count} UserStreetProgress rows.`);

  const act = await prisma.activity.deleteMany({});
  console.log(`[Wipe] Deleted ${act.count} Activity rows.`);

  console.log(
    "[Wipe] Done. Click Sync with Strava to re-fetch and re-process."
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
