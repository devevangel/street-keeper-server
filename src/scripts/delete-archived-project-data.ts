/**
 * Delete all related data for archived projects.
 *
 * What gets deleted (for every project where isArchived === true):
 *   1. ProjectActivity rows (project–activity links)
 *   2. UserMilestone rows that reference the project
 *   Optionally (--delete-projects): the Project rows themselves (hard delete)
 *
 * Why this is safe:
 *   - Activities are user-level; many projects can link to the same activity.
 *   - We only delete the links (ProjectActivity) for archived projects, not
 *     the Activity rows, so other (non-archived) projects are unaffected.
 *   - Overlap detection uses includeArchived: false, so new runs never attach
 *     to archived projects. Archiving only sets isArchived = true and does
 *     not touch any other table.
 *
 * Usage (from backend directory):
 *   npm run delete:archived-project-data
 *   npm run delete:archived-project-data -- --delete-projects   # also remove project rows
 *
 * Requires: DATABASE_URL in .env
 */

import "dotenv/config";

import prisma from "../lib/prisma.js";

async function main(): Promise<void> {
  const deleteProjects = process.argv.includes("--delete-projects");

  const archived = await prisma.project.findMany({
    where: { isArchived: true },
    select: { id: true, name: true, userId: true },
  });

  if (archived.length === 0) {
    console.log("[DeleteArchived] No archived projects found.");
    return;
  }

  const archivedIds = archived.map((p) => p.id);
  console.log(`[DeleteArchived] Found ${archived.length} archived project(s).`);

  const pa = await prisma.projectActivity.deleteMany({
    where: { projectId: { in: archivedIds } },
  });
  console.log(`[DeleteArchived] Deleted ${pa.count} ProjectActivity row(s).`);

  const milestones = await prisma.userMilestone.deleteMany({
    where: { projectId: { in: archivedIds } },
  });
  console.log(`[DeleteArchived] Deleted ${milestones.count} UserMilestone row(s).`);

  if (deleteProjects) {
    const projects = await prisma.project.deleteMany({
      where: { id: { in: archivedIds } },
    });
    console.log(`[DeleteArchived] Deleted ${projects.count} archived Project row(s).`);
  } else {
    console.log(
      "[DeleteArchived] Left archived project rows in place (soft delete). Use --delete-projects to remove them."
    );
  }

  console.log("[DeleteArchived] Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
