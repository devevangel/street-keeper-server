/**
 * Recompute project progress from V2 engine scoped to runs on or after project creation.
 * Fixes false completions (streets that were run before the project existed).
 *
 * Usage (from backend directory):
 *   npm run recompute:project-progress              # all projects, all users
 *   npm run recompute:project-progress -- --userId=USER_UUID  # one user's projects
 *
 * Requires: DATABASE_URL, ENGINE.VERSION=v2 (or both)
 */

import "dotenv/config";

import prisma from "../lib/prisma.js";
import { recomputeProjectProgressFromV2 } from "../services/project.service.js";

async function main(): Promise<void> {
  const userIdArg = process.argv.find((a) => a.startsWith("--userId="));
  const userId = userIdArg?.slice("--userId=".length);

  const projects = await prisma.project.findMany({
    where: userId ? { userId } : undefined,
    select: { id: true, name: true, userId: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(
    `[Recompute] Found ${projects.length} project(s)${userId ? ` for user ${userId}` : ""}.`
  );

  for (const project of projects) {
    try {
      await recomputeProjectProgressFromV2(project.id, project.userId);
      console.log(`[Recompute] OK: ${project.name} (${project.id})`);
    } catch (err) {
      console.error(
        `[Recompute] Failed: ${project.name} (${project.id}):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log("[Recompute] Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
