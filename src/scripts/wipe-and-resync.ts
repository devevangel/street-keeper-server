/**
 * Wipe activity-related data so you can Sync with Strava and re-process from scratch.
 *
 * Deletes in order (respecting FKs):
 *   1. ProjectActivity
 *   2. UserStreetProgress
 *   3. UserEdge (when GPX_ENGINE_VERSION is v2 or both)
 *   4. Activity
 *
 * Then resets project street progress: for every Project, zeros completed/percentage/lastRunDate
 * in streetsSnapshot and sets completedStreets=0, progress=0. So project completion is cleared
 * and will be recalculated when activities are re-synced and processed (V1 pipeline updates projects).
 *
 * Note: Project progress is still calculated by the V1 engine (Overpass + Mapbox matching), not V2.
 * V2 only populates UserEdge for the global map.
 *
 * Keeps: User, Project (definitions and street lists; only progress is zeroed), GeometryCache, WayCache, WayTotalEdges.
 * After running, click Sync with Strava to re-fetch and fully re-process.
 *
 * Usage (from backend directory):
 *   npm run wipe:and-resync
 *
 * Requires: DATABASE_URL in .env
 */

import "dotenv/config";

import prisma from "../lib/prisma.js";
import { ENGINE } from "../config/constants.js";
import type { StreetSnapshot } from "../types/project.types.js";

async function main(): Promise<void> {
  const pa = await prisma.projectActivity.deleteMany({});
  console.log(`[Wipe] Deleted ${pa.count} ProjectActivity rows.`);

  const usp = await prisma.userStreetProgress.deleteMany({});
  console.log(`[Wipe] Deleted ${usp.count} UserStreetProgress rows.`);

  if (ENGINE.VERSION === "v2" || ENGINE.VERSION === "both") {
    const ue = await prisma.userEdge.deleteMany({});
    console.log(`[Wipe] Deleted ${ue.count} UserEdge rows.`);
  }

  const act = await prisma.activity.deleteMany({});
  console.log(`[Wipe] Deleted ${act.count} Activity rows.`);

  // Reset project street progress so completion is recalculated on next sync
  const projects = await prisma.project.findMany({
    select: { id: true, streetsSnapshot: true },
  });
  for (const project of projects) {
    const snapshot = project.streetsSnapshot as StreetSnapshot | null;
    if (!snapshot?.streets?.length) continue;
    for (const street of snapshot.streets) {
      street.completed = false;
      street.percentage = 0;
      street.lastRunDate = null;
    }
    await prisma.project.update({
      where: { id: project.id },
      data: {
        streetsSnapshot: snapshot as object,
        completedStreets: 0,
        progress: 0,
      },
    });
  }
  if (projects.length > 0) {
    console.log(`[Wipe] Reset street progress for ${projects.length} project(s).`);
  }

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
