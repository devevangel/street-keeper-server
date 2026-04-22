/**
 * Reset the entire database: truncate all tables so you can test from a clean slate.
 *
 * Use this to verify on-demand city sync: after running, log in again and create a
 * project in a new area — the backend will pull city data from Overpass when needed
 * (CitySync, WayTotalEdges, etc.) and background Strava sync runs as implemented.
 *
 * Truncates (in FK-safe order, with CASCADE):
 *   App data: SuggestionCooldown, AnalyticsEvent, UserMilestone, UserPreferences,
 *     ProjectActivity, Project, UserStreetProgress, UserEdge, UserNodeHit, Activity,
 *     User
 *   Map/seed data: WayCache, CitySync, WayTotalEdges, WayNode, NodeCache
 *   Seed config: MilestoneType
 *
 * Usage (from backend directory — loads backend/.env via package.json):
 *   npm run db:reset
 *
 * Requires: DATABASE_URL in backend/.env (e.g. Supabase).
 *
 * Full replay of migrations instead of truncate: npm run db:migrate:reset
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
