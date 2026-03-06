/**
 * Reset ALL progress-related data to default/zero state.
 * 
 * This resets everything so it's like starting fresh - no progress shown,
 * no maps drawn, no milestones completed. When you resync from Strava,
 * everything will be recalculated from scratch using the fixed logic.
 * 
 * What gets reset:
 * - Project progress (completedStreets, completedStreetNames, progress, snapshot completion flags)
 * - UserMilestone (completion status, progress)
 * - UserStreetProgress (all progress data)
 * - UserEdge (V2 engine - deleted)
 * - UserNodeHit (V2 engine - deleted)
 * - ProjectActivity (impact relationships - deleted)
 * - Activity processing status (marked as unprocessed)
 * 
 * What is kept:
 * - Users (all user accounts)
 * - Projects (structure, location, name - just progress reset)
 * - Activities (actual activity data from Strava)
 * - Reference data (WayCache, WayTotalEdges, WayNode, NodeCache, MilestoneType)
 * 
 * Usage (from backend directory):
 *   npm run reset:everything
 */

import "dotenv/config";

import prisma from "../lib/prisma.js";
import type { StreetSnapshot, SnapshotStreet } from "../types/project.types.js";


async function main(): Promise<void> {
  console.log("[Reset] Starting complete progress reset...\n");

  // 1. Reset Project progress and snapshot completion flags
  console.log("[Reset] 1. Resetting project progress...");
  const projects = await prisma.project.findMany({
    select: {
      id: true,
      name: true,
      streetsSnapshot: true,
    },
  });

  let projectCount = 0;
  for (const project of projects) {
    try {
      const snapshot = project.streetsSnapshot as StreetSnapshot;
      
      if (snapshot && snapshot.streets && snapshot.streets.length > 0) {
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

        await prisma.project.update({
          where: { id: project.id },
          data: {
            streetsSnapshot: resetSnapshot as object,
            completedStreets: 0,
            progress: 0,
            // Note: completedStreetNames and totalStreetNames will be available after migration
            // For now, just reset the fields that exist
          },
        });

        projectCount++;
      }
    } catch (err) {
      console.error(`[Reset] ✗ Failed to reset project "${project.name}":`, err);
    }
  }
  console.log(`[Reset] ✓ Reset ${projectCount} project(s)\n`);

  // 2. Reset ALL UserMilestone completion and progress (both project and global)
  console.log("[Reset] 2. Resetting milestones...");
  const milestoneResult = await prisma.userMilestone.updateMany({
    data: {
      completedAt: null,
      shareMessage: null,
      celebrationShownAt: null,
      currentValue: 0,
    },
  });
  console.log(`[Reset] ✓ Reset ${milestoneResult.count} milestone(s)\n`);

  // 3. Delete all UserStreetProgress
  console.log("[Reset] 3. Deleting user street progress...");
  const streetProgressResult = await prisma.userStreetProgress.deleteMany({});
  console.log(`[Reset] ✓ Deleted ${streetProgressResult.count} street progress record(s)\n`);

  // 4. Delete all UserEdge (V2 engine)
  console.log("[Reset] 4. Deleting user edges (V2 engine)...");
  const edgeResult = await prisma.userEdge.deleteMany({});
  console.log(`[Reset] ✓ Deleted ${edgeResult.count} edge(s)\n`);

  // 5. Delete all UserNodeHit (V2 engine)
  console.log("[Reset] 5. Deleting user node hits (V2 engine)...");
  const nodeHitResult = await prisma.userNodeHit.deleteMany({});
  console.log(`[Reset] ✓ Deleted ${nodeHitResult.count} node hit(s)\n`);

  // 6. Delete all ProjectActivity (impact relationships)
  console.log("[Reset] 6. Deleting project activity relationships...");
  const projectActivityResult = await prisma.projectActivity.deleteMany({});
  console.log(`[Reset] ✓ Deleted ${projectActivityResult.count} project activity relationship(s)\n`);

  // 7. Mark all activities as unprocessed
  console.log("[Reset] 7. Marking all activities as unprocessed...");
  const activityResult = await prisma.activity.updateMany({
    data: {
      isProcessed: false,
      processedAt: null,
    },
  });
  console.log(`[Reset] ✓ Marked ${activityResult.count} activity/activities as unprocessed\n`);

  // 8. Verify reset - check a sample project
  console.log("[Reset] 8. Verifying reset...");
  const sampleProject = await prisma.project.findFirst({
    select: {
      name: true,
      completedStreets: true,
      progress: true,
    },
  });
  
  if (sampleProject) {
    console.log(`[Reset] Sample project "${sampleProject.name}":`);
    console.log(`[Reset]   - completedStreets: ${sampleProject.completedStreets}`);
    console.log(`[Reset]   - progress: ${sampleProject.progress}%`);
  }
  
  const remainingProgress = await prisma.userStreetProgress.count();
  const remainingEdges = await prisma.userEdge.count();
  const remainingNodeHits = await prisma.userNodeHit.count();
  const remainingProjectActivities = await prisma.projectActivity.count();
  const processedActivities = await prisma.activity.count({
    where: { isProcessed: true },
  });
  
  console.log(`[Reset] Verification:`);
  console.log(`[Reset]   - UserStreetProgress records: ${remainingProgress} (should be 0)`);
  console.log(`[Reset]   - UserEdge records: ${remainingEdges} (should be 0)`);
  console.log(`[Reset]   - UserNodeHit records: ${remainingNodeHits} (should be 0)`);
  console.log(`[Reset]   - ProjectActivity records: ${remainingProjectActivities} (should be 0)`);
  console.log(`[Reset]   - Processed activities: ${processedActivities} (should be 0)\n`);

  console.log("=".repeat(60));
  console.log("[Reset] ✓ COMPLETE! All progress has been reset to default.");
  console.log("[Reset] Projects, users, and activities are preserved.");
  console.log("");
  console.log("[Reset] IMPORTANT: Clear your browser cache or hard refresh (Ctrl+Shift+R)");
  console.log("[Reset] to see the reset state. The frontend may be caching old data.");
  console.log("");
  console.log("[Reset] Then click 'Resync' from Strava to recalculate everything.");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[Reset] ✗ Error:", err);
    process.exit(1);
  });
