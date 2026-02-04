/**
 * One-time cleanup: remove UserStreetProgress rows with very low coverage.
 *
 * These are noise from before we added MIN_COVERAGE_PERCENTAGE (5%) and
 * MIN_POINTS_PER_STREET (3) filtering in standalone activity processing.
 * Deleting them gives accurate map stats and list (e.g. 11 streets instead of 38).
 *
 * Usage (from backend directory):
 *   npm run cleanup:low-coverage
 * or:
 *   npx tsx src/scripts/cleanup-low-coverage-street-progress.ts
 *
 * Requires: DATABASE_URL in .env
 */

import "dotenv/config";

import prisma from "../lib/prisma.js";
import { STREET_MATCHING } from "../config/constants.js";

async function main(): Promise<void> {
  const threshold = STREET_MATCHING.MIN_COVERAGE_PERCENTAGE;

  console.log(
    `[Cleanup] Deleting UserStreetProgress where percentage < ${threshold}%...`
  );

  const result = await prisma.userStreetProgress.deleteMany({
    where: {
      percentage: { lt: threshold },
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
