import "dotenv/config";
import prisma from "../lib/prisma.js";
import { ACTIVITIES } from "../config/constants.js";

async function main() {
  // Clear stale sync jobs so next Sync button press uses the new MAX_AGE_DAYS
  const deleted = await prisma.syncJob.deleteMany({});
  console.log(`Deleted ${deleted.count} old sync jobs`);

  console.log("MAX_AGE_DAYS:", ACTIVITIES.MAX_AGE_DAYS);
  const defaultAfter = Math.floor(Date.now() / 1000) - ACTIVITIES.MAX_AGE_DAYS * 86400;
  console.log("defaultAfter:", new Date(defaultAfter * 1000).toISOString());

  const totalActivities = await prisma.activity.count();
  const processed = await prisma.activity.count({ where: { isProcessed: true } });
  const unprocessed = await prisma.activity.count({ where: { isProcessed: false } });

  const [nh] = await prisma.$queryRawUnsafe<[{ count: number }]>(
    'SELECT COUNT(*)::int AS count FROM "UserNodeHit"',
  );
  const [sp] = await prisma.$queryRawUnsafe<[{ count: number }]>(
    'SELECT COUNT(*)::int AS count FROM "UserStreetProgress"',
  );

  const syncs = await prisma.syncJob.findMany({
    orderBy: { updatedAt: "desc" },
    take: 3,
    select: { status: true, total: true, processed: true, errors: true, after: true, updatedAt: true },
  });

  console.log("=== DB State ===");
  console.log(`Activities: ${totalActivities} total, ${processed} processed, ${unprocessed} unprocessed`);
  console.log(`UserNodeHit: ${nh.count}`);
  console.log(`UserStreetProgress: ${sp.count}`);
  console.log("Recent syncs:");
  for (const s of syncs) {
    const afterDate = s.after ? new Date(s.after * 1000).toISOString() : "null";
    console.log(`  ${s.status} total=${s.total} processed=${s.processed} errors=${s.errors} after=${afterDate} updated=${s.updatedAt.toISOString()}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => process.exit(0));
