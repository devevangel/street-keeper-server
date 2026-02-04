/**
 * One-time cleanup: remove UserStreetProgress rows for unnamed roads.
 *
 * Unnamed roads are no longer shown on the map or list. This script removes
 * existing unnamed rows so the DB stays consistent.
 *
 * Usage (from backend directory):
 *   npm run cleanup:unnamed
 * or:
 *   npx tsx src/scripts/cleanup-unnamed-street-progress.ts
 *
 * Requires: DATABASE_URL in .env
 */

import "dotenv/config";

import prisma from "../lib/prisma.js";

async function main(): Promise<void> {
  console.log("[Cleanup] Deleting UserStreetProgress where name is unnamed...");

  const result = await prisma.userStreetProgress.deleteMany({
    where: {
      OR: [
        { name: "" },
        { name: "Unnamed Road" },
        { name: { startsWith: "Unnamed", mode: "insensitive" } },
        { name: { equals: "unnamed", mode: "insensitive" } },
      ],
    },
  });

  console.log(`[Cleanup] Deleted ${result.count} row(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[Cleanup] Error:", err);
    process.exit(1);
  });
