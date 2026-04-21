/**
 * Reset all activities to unprocessed so background workers re-process them.
 * Useful after a city sync or bug fix.
 *
 * Usage: npx tsx src/scripts/reset-activities.ts
 */
import "dotenv/config";
import prisma from "../lib/prisma.js";

async function main() {
  const result = await prisma.activity.updateMany({
    where: { isProcessed: true },
    data: { isProcessed: false },
  });
  console.log(`[Reset] Marked ${result.count} activities as unprocessed`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
