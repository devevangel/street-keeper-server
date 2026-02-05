/**
 * Reset activities to unprocessed so Sync with Strava will re-run full processing.
 *
 * Use this to re-test after street matching improvements (e.g. Phase 1–3).
 * After running, click "Sync with Strava" and those activities will get
 * full processing (overlap detection, street matching, project progress, etc.).
 *
 * Usage (from backend directory):
 *   npx tsx src/scripts/reset-processed-activities.ts
 *   npm run reset:processed-activities
 *
 * Optional: pass a user ID to reset only that user's activities:
 *   npx tsx src/scripts/reset-processed-activities.ts <userId>
 *
 * Requires: DATABASE_URL in .env
 */

import "dotenv/config";

import prisma from "../lib/prisma.js";

async function main(): Promise<void> {
  const userId = process.argv[2]?.trim(); // optional

  const where = userId ? { userId } : {};

  const count = await prisma.activity.updateMany({
    where: { ...where, isProcessed: true },
    data: {
      isProcessed: false,
      processedAt: null,
    },
  });

  console.log(
    `[Reset] Set isProcessed=false for ${count.count} activity/activities.`
  );
  if (userId) {
    console.log(`[Reset] Filtered by userId: ${userId}`);
  } else {
    console.log("[Reset] All users (no userId filter).");
  }
  console.log("[Reset] You can now click Sync with Strava to re-process them.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
