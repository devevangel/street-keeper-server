/**
 * Backfill UserStreetProgress from existing route snapshots
 *
 * One-time script: populates UserStreetProgress from Route.streetsSnapshot
 * for all users and routes. Uses MAX rule for percentage per user+osmId.
 * Run counts and completion counts are left at 0 (they accumulate on
 * future activity processing).
 *
 * Usage (from backend directory):
 *   npx tsx src/scripts/backfill-user-street-progress.ts
 *
 * Requires: DATABASE_URL in .env
 */

import "dotenv/config";

import prisma from "../lib/prisma.js";
import type { StreetSnapshot, SnapshotStreet } from "../types/route.types.js";

// ============================================
// Types
// ============================================

interface AggregatedStreet {
  osmId: string;
  name: string;
  highwayType: string;
  lengthMeters: number;
  percentage: number;
  everCompleted: boolean;
  lastRunDate: string | null;
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  console.log(
    "[Backfill] Starting UserStreetProgress backfill from route snapshots..."
  );

  const users = await prisma.user.findMany({
    select: { id: true, name: true },
  });

  console.log(`[Backfill] Found ${users.length} user(s).`);

  let totalUpserted = 0;

  for (const user of users) {
    const routes = await prisma.route.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, streetsSnapshot: true },
    });

    const byOsmId = new Map<string, AggregatedStreet>();

    for (const route of routes) {
      const snapshot = route.streetsSnapshot as StreetSnapshot | null;
      if (!snapshot?.streets?.length) continue;

      for (const street of snapshot.streets as SnapshotStreet[]) {
        if (street.percentage <= 0) continue;

        const existing = byOsmId.get(street.osmId);
        const percentage = Math.min(street.percentage, 100);
        const everCompleted = street.completed ?? percentage >= 90;

        if (!existing) {
          byOsmId.set(street.osmId, {
            osmId: street.osmId,
            name: street.name,
            highwayType: street.highwayType,
            lengthMeters: street.lengthMeters,
            percentage,
            everCompleted,
            lastRunDate: street.lastRunDate ?? null,
          });
        } else {
          byOsmId.set(street.osmId, {
            ...existing,
            percentage: Math.max(existing.percentage, percentage),
            everCompleted: existing.everCompleted || everCompleted,
            lastRunDate: street.lastRunDate ?? existing.lastRunDate,
          });
        }
      }
    }

    for (const agg of byOsmId.values()) {
      const lastRunDate = agg.lastRunDate ? new Date(agg.lastRunDate) : null;

      const existing = await prisma.userStreetProgress.findUnique({
        where: { userId_osmId: { userId: user.id, osmId: agg.osmId } },
      });

      if (existing) {
        await prisma.userStreetProgress.update({
          where: { id: existing.id },
          data: {
            percentage: Math.max(existing.percentage, agg.percentage),
            everCompleted: existing.everCompleted || agg.everCompleted,
            name: agg.name,
            highwayType: agg.highwayType,
            lengthMeters: agg.lengthMeters,
            lastRunDate: lastRunDate ?? existing.lastRunDate,
          },
        });
      } else {
        await prisma.userStreetProgress.create({
          data: {
            userId: user.id,
            osmId: agg.osmId,
            name: agg.name,
            highwayType: agg.highwayType,
            lengthMeters: agg.lengthMeters,
            percentage: agg.percentage,
            everCompleted: agg.everCompleted,
            runCount: 0,
            completionCount: 0,
            firstRunDate: lastRunDate,
            lastRunDate,
          },
        });
      }
      totalUpserted++;
    }

    if (byOsmId.size > 0) {
      console.log(
        `[Backfill] User "${user.name}" (${user.id}): ${byOsmId.size} street(s).`
      );
    }
  }

  console.log(`[Backfill] Done. Total records upserted: ${totalUpserted}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[Backfill] Error:", err);
    process.exit(1);
  });
