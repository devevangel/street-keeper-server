/**
 * Reset incorrectly completed milestones without losing progress.
 * 
 * This script fixes milestones that were incorrectly marked as complete due to
 * the bug where completedStreets counted segments instead of street names.
 * 
 * It resets completedAt and shareMessage, but preserves currentValue so progress
 * is maintained. When activities are processed again, milestones will be recalculated
 * correctly using the fixed street name counting logic.
 * 
 * Usage (from backend directory):
 *   npm run reset:milestones                    # Reset all completed project milestones
 *   npm run reset:milestones -- --type=street_count  # Only street_count milestones
 *   npm run reset:milestones -- --target=10     # Only milestones with targetValue >= 10
 *   npm run reset:milestones -- --userId=USER_UUID  # Only for specific user
 *   npm run reset:milestones -- --dry-run       # Preview without making changes
 */

import "dotenv/config";

import prisma from "../lib/prisma.js";
import { updateMilestoneProgress } from "../services/milestone.service.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  const typeArg = args.find((a) => a.startsWith("--type="));
  const targetArg = args.find((a) => a.startsWith("--target="));
  const userIdArg = args.find((a) => a.startsWith("--userId="));
  const dryRun = args.includes("--dry-run");

  const milestoneType = typeArg?.slice("--type=".length);
  const minTarget = targetArg ? parseFloat(targetArg.slice("--target=".length)) : undefined;
  const userId = userIdArg?.slice("--userId=".length);

  // Build query to find completed milestones
  const where: any = {
    completedAt: { not: null },
    projectId: { not: null }, // Only project milestones (not global)
  };

  if (userId) {
    where.userId = userId;
  }

  if (milestoneType) {
    where.type = { slug: milestoneType };
  }

  if (minTarget !== undefined) {
    where.targetValue = { gte: minTarget };
  }

  // Select only fields that exist in current schema (works before/after migration)
  const milestones = await prisma.userMilestone.findMany({
    where,
    include: {
      type: true,
      project: {
        select: {
          id: true,
          name: true,
          totalStreets: true,
          completedStreets: true,
          // Note: totalStreetNames/completedStreetNames will be available after migration
          // Script works with either - uses completedStreets/totalStreets as fallback
        },
      },
    },
    orderBy: [
      { userId: "asc" },
      { projectId: "asc" },
      { completedAt: "desc" },
    ],
  });

  console.log(
    `[Reset] Found ${milestones.length} completed milestone(s)${userId ? ` for user ${userId}` : ""}${milestoneType ? ` of type ${milestoneType}` : ""}${minTarget !== undefined ? ` with target >= ${minTarget}` : ""}.`
  );

  if (milestones.length === 0) {
    console.log("[Reset] No milestones to reset.");
    return;
  }

  if (dryRun) {
    console.log("\n[DRY RUN] Would reset the following milestones:\n");
    for (const m of milestones) {
      const project = m.project as any; // Use any to access potentially missing fields
      console.log(
        `  - ${m.name} (${m.type?.slug || "unknown"}) | Target: ${m.targetValue} | Current: ${m.currentValue} | Project: ${project?.name || "N/A"} | Completed: ${m.completedAt?.toISOString()}`
      );
      if (project) {
        // Use segment counts (available before migration)
        // After migration, these will be recalculated with street name counts
        console.log(
          `    Project stats: ${project.completedStreets} segments completed / ${project.totalStreets} total segments`
        );
      }
    }
    console.log(`\n[DRY RUN] Run without --dry-run to actually reset these milestones.`);
    return;
  }

  let resetCount = 0;
  let errorCount = 0;

  for (const milestone of milestones) {
    try {
      // Reset completedAt and shareMessage, but keep currentValue
      await prisma.userMilestone.update({
        where: { id: milestone.id },
        data: {
          completedAt: null,
          shareMessage: null,
          celebrationShownAt: null, // Also reset celebration flag
        },
      });

      resetCount++;

      // Recalculate milestone progress using current project counts
      // After migration, this will use street name counts; before migration, uses segment counts
      if (milestone.project && milestone.projectId) {
        const project = milestone.project;
        // Use segment counts for now - after migration, updateMilestoneProgress will use street names
        // We'll recalculate properly after migration is run
        await updateMilestoneProgress(
          milestone.userId,
          milestone.projectId,
          project.completedStreets ?? 0,
          project.totalStreets ?? 1,
        );
      }

      console.log(
        `[Reset] ✓ ${milestone.name} (${milestone.type?.slug || "unknown"}) in project "${milestone.project?.name || "N/A"}"`
      );
    } catch (err) {
      errorCount++;
      console.error(
        `[Reset] ✗ Failed to reset milestone ${milestone.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    `\n[Reset] Done. Reset ${resetCount} milestone(s)${errorCount > 0 ? `, ${errorCount} error(s)` : ""}.`
  );
  console.log(
    `[Reset] Next time activities are processed, milestones will be recalculated correctly.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
