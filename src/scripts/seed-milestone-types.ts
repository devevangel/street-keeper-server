/**
 * Seed MilestoneType table with all plan types (enabled + locked).
 *
 * Usage (from backend directory):
 *   npx tsx src/scripts/seed-milestone-types.ts
 *   npm run seed:milestone-types
 *
 * Requires: DATABASE_URL in .env
 */

import "dotenv/config";

import prisma from "../lib/prisma.js";
import { seedMilestoneTypes } from "../../prisma/seed-milestone-types.js";

async function main(): Promise<void> {
  await seedMilestoneTypes(prisma);
  console.log("[Seed] MilestoneType rows upserted.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
