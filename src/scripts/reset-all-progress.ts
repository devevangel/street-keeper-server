/**
 * Reset all project progress and milestones so resyncing from Strava
 * will recalculate everything correctly using the fixed street name counting logic.
 * 
 * This resets:
 * - Project progress (completedStreets, completedStreetNames, progress)
 * - Street completion flags in snapshots
 * - Milestone completion status
 * 
 * After running this, click "Resync" from Strava and everything will be
 * recalculated correctly.
 * 
 * Usage (from backend directory):
 *   npm run reset:all-progress
 */

import "dotenv/config";

import prisma from "../lib/prisma.js";
import type { StreetSnapshot, SnapshotStreet } from "../types/project.types.js";

async function main(): Promise<void> {
  console.log("[Reset] Finding all projects...");

  const projects = await prisma.project.findMany({
    select: {
      id: true,
      name: true,
      userId: true,
      streetsSnapshot: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`[Reset] Found ${projects.length} project(s).`);

  if (projects.length === 0) {
    console.log("[Reset] No projects to reset.");
    return;
  }

  let projectCount = 0;
  let errorCount = 0;

  // Reset all project progress
  for (const project of projects) {
    try {
      const snapshot = project.streetsSnapshot as StreetSnapshot;
      
      if (!snapshot || !snapshot.streets || snapshot.streets.length === 0) {
        console.log(`[Reset] ⚠ Skipping project "${project.name}" - no streets in snapshot`);
        continue;
      }

      // Reset all street completion flags in snapshot
      const resetStreets: SnapshotStreet[] = snapshot.streets.map((street) => ({
        ...street,
        completed: false,
        percentage: 0,
        lastRunDate: null,
      }));

      const resetSnapshot: StreetSnapshot = {
        ...snapshot,
        streets: resetStreets,
      };

      // Reset project progress to zero
      await prisma.project.update({
        where: { id: project.id },
        data: {
          streetsSnapshot: resetSnapshot as object,
          completedStreets: 0,
          progress: 0,
          // Note: completedStreetNames will be available after migration
        },
      });

      projectCount++;
      console.log(`[Reset] ✓ "${project.name}" - reset progress to 0%`);
    } catch (err) {
      errorCount++;
      console.error(
        `[Reset] ✗ Failed to reset project "${project.name}" (${project.id}):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(`\n[Reset] Reset ${projectCount} project(s)${errorCount > 0 ? `, ${errorCount} error(s)` : ""}.`);

  // Reset all milestones (keep currentValue - it will be recalculated when activities are processed)
  console.log("\n[Reset] Resetting all milestones...");
  
  const milestoneResult = await prisma.userMilestone.updateMany({
    where: {
      completedAt: { not: null },
      projectId: { not: null }, // Only project milestones
    },
    data: {
      completedAt: null,
      shareMessage: null,
      celebrationShownAt: null,
      // Keep currentValue - it will be recalculated correctly when activities are processed
    },
  });

  console.log(`[Reset] ✓ Reset ${milestoneResult.count} milestone(s) (completion status cleared, progress will be recalculated).`);

  console.log(
    `\n[Reset] Done! Now click "Resync" from Strava and everything will be recalculated correctly.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
