/**
 * Reset the entire database: truncate all tables so you can test from a clean slate.
 *
 * Use this to verify on-demand city sync: after running, create a project and the
 * backend will sync that city from Overpass and repopulate NodeCache, WayNode,
 * WayTotalEdges, and CitySync.
 *
 * Truncates (in FK-safe order, with CASCADE):
 *   App data: SuggestionCooldown, AnalyticsEvent, UserMilestone, UserPreferences,
 *     ProjectActivity, Project, UserStreetProgress, UserEdge, UserNodeHit, Activity,
 *     User
 *   Map/seed data: WayCache, CitySync, WayTotalEdges, WayNode, NodeCache
 *   Seed config: MilestoneType
 *
 * Usage (from backend directory):
 *   npx tsx src/scripts/reset-database.ts
 *   npm run db:reset
 *
 * Requires: DATABASE_URL in .env
 *
 * Alternative (drops DB and re-runs all migrations): npx prisma migrate reset --force
 */

import "dotenv/config";

import prisma from "../lib/prisma.js";

const TABLES_IN_ORDER = [
  "SuggestionCooldown",
  "AnalyticsEvent",
  "UserMilestone",
  "UserPreferences",
  "ProjectActivity",
  "Project",
  "UserStreetProgress",
  "UserEdge",
  "UserNodeHit",
  "Activity",
  "User",
  "WayCache",
  "CitySync",
  "WayTotalEdges",
  "WayNode",
  "NodeCache",
  "MilestoneType",
];

async function main(): Promise<void> {
  const quoted = TABLES_IN_ORDER.map((t) => `"${t}"`).join(", ");
  const sql = `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`;
  console.log("[Reset] Truncating all tables...");
  await prisma.$executeRawUnsafe(sql);
  console.log("[Reset] Done. Database is empty.");
console.log("[Reset] Optional: npm run seed:milestone-types — then create a project to test on-demand city sync.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("[Reset] Error:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
