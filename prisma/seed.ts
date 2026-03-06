/**
 * Prisma seed entry point. Run with: npx prisma db seed
 * Uses the app's Prisma client (with pg adapter) so DATABASE_URL and SSL work.
 */
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { seedMilestoneTypes } from "./seed-milestone-types.js";

async function main() {
  await seedMilestoneTypes(prisma);
  await prisma.$disconnect();
  console.log("Seed completed: MilestoneType rows upserted.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {});
