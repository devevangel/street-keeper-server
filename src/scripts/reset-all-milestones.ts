/**
 * Reset all completed milestones for all users.
 * 
 * This resets milestones so they can be recalculated correctly after fixing
 * the street counting bug. Progress (currentValue) is preserved.
 * 
 * Usage (from backend directory):
 *   npm run reset:all-milestones
 */

import "dotenv/config";

import prisma from "../lib/prisma.js";

async function main(): Promise<void> {
  console.log("[Reset] Finding all completed milestones...");

  const milestones = await prisma.userMilestone.findMany({
    where: {
      completedAt: { not: null },
      projectId: { not: null }, // Only project milestones
    },
    select: {
      id: true,
      name: true,
      userId: true,
      projectId: true,
    },
  });

  console.log(`[Reset] Found ${milestones.length} completed milestone(s) to reset.`);

  if (milestones.length === 0) {
    console.log("[Reset] No milestones to reset.");
    return;
  }

  // Reset all milestones in one batch
  const result = await prisma.userMilestone.updateMany({
    where: {
      completedAt: { not: null },
      projectId: { not: null },
    },
    data: {
      completedAt: null,
      shareMessage: null,
      celebrationShownAt: null,
    },
  });

  console.log(`[Reset] ✓ Reset ${result.count} milestone(s).`);
  console.log(`[Reset] Progress (currentValue) has been preserved.`);
  console.log(`[Reset] Next time you sync activities via Strava, milestones will be recalculated correctly.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
