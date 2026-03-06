/**
 * Delete ALL projects and their related data.
 *
 * WARNING: This is a destructive operation that will delete:
 *   - All Project rows
 *   - All ProjectActivity rows (project–activity links)
 *   - All UserMilestone rows that reference projects
 *   - All UserStreetProgress rows (street progress data)
 *   - All Activity rows (can be re-synced from Strava)
 *
 * Note: Activities can be re-synced from Strava after deletion.
 *
 * Usage (from backend directory):
 *   npm run delete:all-projects
 *   npm run delete:all-projects -- --confirm   # requires confirmation flag
 *
 * Requires: DATABASE_URL in .env
 */

import "dotenv/config";

import prisma from "../lib/prisma.js";

async function main(): Promise<void> {
  const confirmed = process.argv.includes("--confirm");

  if (!confirmed) {
    console.error("⚠️  WARNING: This will delete ALL projects and related data!");
    console.error("   Run with --confirm flag to proceed:");
    console.error("   npm run delete:all-projects -- --confirm");
    process.exit(1);
  }

  console.log("[DeleteAllProjects] Starting deletion of all projects...");

  // Get all projects first
  const allProjects = await prisma.project.findMany({
    select: { id: true, name: true, userId: true },
  });

  if (allProjects.length === 0) {
    console.log("[DeleteAllProjects] No projects found.");
    return;
  }

  const projectIds = allProjects.map((p) => p.id);
  console.log(`[DeleteAllProjects] Found ${allProjects.length} project(s).`);

  // Delete related data first (due to foreign key constraints)
  console.log("[DeleteAllProjects] Deleting ProjectActivity rows...");
  const pa = await prisma.projectActivity.deleteMany({
    where: { projectId: { in: projectIds } },
  });
  console.log(`[DeleteAllProjects] Deleted ${pa.count} ProjectActivity row(s).`);

  console.log("[DeleteAllProjects] Deleting UserMilestone rows...");
  const milestones = await prisma.userMilestone.deleteMany({
    where: { projectId: { in: projectIds } },
  });
  console.log(`[DeleteAllProjects] Deleted ${milestones.count} UserMilestone row(s).`);

  // Delete UserStreetProgress (all street progress data)
  console.log("[DeleteAllProjects] Deleting UserStreetProgress rows...");
  const progress = await prisma.userStreetProgress.deleteMany({});
  console.log(`[DeleteAllProjects] Deleted ${progress.count} UserStreetProgress row(s).`);

  // Delete Activities (can be re-synced from Strava)
  console.log("[DeleteAllProjects] Deleting Activity rows...");
  const activities = await prisma.activity.deleteMany({});
  console.log(`[DeleteAllProjects] Deleted ${activities.count} Activity row(s).`);

  // Finally delete the projects themselves
  console.log("[DeleteAllProjects] Deleting Project rows...");
  const projects = await prisma.project.deleteMany({});
  console.log(`[DeleteAllProjects] Deleted ${projects.count} Project row(s).`);

  console.log("[DeleteAllProjects] ✅ Done. All projects, activities, and street progress deleted.");
  console.log("[DeleteAllProjects] 💡 Tip: Run 'Sync from Strava' to re-import your activities.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[DeleteAllProjects] Error:", err);
    process.exit(1);
  });
