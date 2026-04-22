/**
 * Delete one user's app data (sync jobs, activities, projects, progress) but keep the User row
 * and OAuth tokens so the account can re-sync from Strava.
 *
 * Usage (from backend directory):
 *   npx tsx src/scripts/reset-user-data.ts <userId>
 *   npx tsx src/scripts/reset-user-data.ts --email user@example.com
 *
 * Requires: DATABASE_URL in .env
 */

import "dotenv/config";

import prisma from "../lib/prisma.js";

async function resolveUserId(args: string[]): Promise<string> {
  const emailIdx = args.indexOf("--email");
  if (emailIdx !== -1 && args[emailIdx + 1]) {
    const email = args[emailIdx + 1];
    const user = await prisma.user.findFirst({ where: { email } });
    if (!user) throw new Error(`No user with email: ${email}`);
    return user.id;
  }
  const id = args.find((a) => !a.startsWith("--"));
  if (!id) {
    throw new Error(
      "Usage: tsx src/scripts/reset-user-data.ts <userId> | --email <email>"
    );
  }
  return id;
}

async function main(): Promise<void> {
  const userId = await resolveUserId(process.argv.slice(2));

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error(`User not found: ${userId}`);
  console.log(`[Reset user data] User: ${user.name} (${user.id})`);

  const sc = await prisma.suggestionCooldown.deleteMany({ where: { userId } });
  console.log(`[Reset] SuggestionCooldown: ${sc.count}`);

  const ae = await prisma.analyticsEvent.deleteMany({ where: { userId } });
  console.log(`[Reset] AnalyticsEvent: ${ae.count}`);

  const um = await prisma.userMilestone.deleteMany({ where: { userId } });
  console.log(`[Reset] UserMilestone: ${um.count}`);

  const up = await prisma.userPreferences.deleteMany({ where: { userId } });
  console.log(`[Reset] UserPreferences: ${up.count}`);

  const pa = await prisma.projectActivity.deleteMany({
    where: {
      OR: [{ project: { userId } }, { activity: { userId } }],
    },
  });
  console.log(`[Reset] ProjectActivity: ${pa.count}`);

  const sj = await prisma.syncJob.deleteMany({ where: { userId } });
  console.log(`[Reset] SyncJob: ${sj.count}`);

  const proj = await prisma.project.deleteMany({ where: { userId } });
  console.log(`[Reset] Project: ${proj.count}`);

  const usp = await prisma.userStreetProgress.deleteMany({ where: { userId } });
  console.log(`[Reset] UserStreetProgress: ${usp.count}`);

  const ue = await prisma.userEdge.deleteMany({ where: { userId } });
  console.log(`[Reset] UserEdge: ${ue.count}`);

  const unh = await prisma.userNodeHit.deleteMany({ where: { userId } });
  console.log(`[Reset] UserNodeHit: ${unh.count}`);

  const act = await prisma.activity.deleteMany({ where: { userId } });
  console.log(`[Reset] Activity: ${act.count}`);

  console.log("[Reset] Done. User row and Strava tokens kept.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
