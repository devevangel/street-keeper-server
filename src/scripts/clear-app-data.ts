/**
 * Clear all app-created data so you can re-sync and test from a clean slate.
 *
 * Deletes in order (respecting FKs):
 *   1. SuggestionCooldown
 *   2. AnalyticsEvent
 *   3. UserMilestone
 *   4. UserPreferences
 *   5. ProjectActivity
 *   6. Project (permanently)
 *   7. UserStreetProgress
 *   8. UserEdge
 *   9. UserNodeHit
 *  10. Activity
 *  11. GeometryCache
 *
 * Keeps: User (so you stay logged in), MilestoneType (seed), WayCache, WayTotalEdges,
 * WayNode, NodeCache (PBF/seed data - no re-seed needed).
 *
 * Usage (from backend directory):
 *   npx tsx src/scripts/clear-app-data.ts
 *   npm run clear:app-data
 *
 * Requires: DATABASE_URL in .env
 */

import "dotenv/config";

import prisma from "../lib/prisma.js";

async function main(): Promise<void> {
  const sc = await prisma.suggestionCooldown.deleteMany({});
  console.log(`[Clear] Deleted ${sc.count} SuggestionCooldown rows.`);

  const ae = await prisma.analyticsEvent.deleteMany({});
  console.log(`[Clear] Deleted ${ae.count} AnalyticsEvent rows.`);

  const um = await prisma.userMilestone.deleteMany({});
  console.log(`[Clear] Deleted ${um.count} UserMilestone rows.`);

  const up = await prisma.userPreferences.deleteMany({});
  console.log(`[Clear] Deleted ${up.count} UserPreferences rows.`);

  const pa = await prisma.projectActivity.deleteMany({});
  console.log(`[Clear] Deleted ${pa.count} ProjectActivity rows.`);

  const proj = await prisma.project.deleteMany({});
  console.log(`[Clear] Deleted ${proj.count} Project rows.`);

  const usp = await prisma.userStreetProgress.deleteMany({});
  console.log(`[Clear] Deleted ${usp.count} UserStreetProgress rows.`);

  const ue = await prisma.userEdge.deleteMany({});
  console.log(`[Clear] Deleted ${ue.count} UserEdge rows.`);

  const unh = await prisma.userNodeHit.deleteMany({});
  console.log(`[Clear] Deleted ${unh.count} UserNodeHit rows.`);

  const act = await prisma.activity.deleteMany({});
  console.log(`[Clear] Deleted ${act.count} Activity rows.`);

  const gc = await prisma.geometryCache.deleteMany({});
  console.log(`[Clear] Deleted ${gc.count} GeometryCache rows.`);

  console.log("[Clear] Done. Users and PBF/seed data kept. You can re-sync and test again.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
