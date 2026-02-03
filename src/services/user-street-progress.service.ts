/**
 * User Street Progress Service
 * Manages user-level street progress for the map feature
 *
 * OVERVIEW:
 * ---------
 * UserStreetProgress stores one row per user per street (osmId). It is updated
 * whenever an activity is processed. The map endpoint reads from this table
 * for efficient "all streets I've run" queries without aggregating routes.
 *
 * RULES:
 * ------
 * - MAX percentage: progress never decreases
 * - everCompleted: once true (>= 90%), always true
 * - runCount: incremented each time the user runs on this street
 * - completionCount: incremented each time the user achieves >= 90% on a run
 */

import prisma from "../lib/prisma.js";

// ============================================
// Types
// ============================================

/**
 * Input for upserting street progress after activity processing
 */
export interface UpsertStreetProgressInput {
  osmId: string;
  name: string;
  highwayType: string;
  lengthMeters: number;
  /** Coverage percentage (0-100) from this run */
  percentage: number;
  /** True if this run achieved >= 90% coverage */
  isComplete: boolean;
}

// ============================================
// Upsert (Called from Activity Processor)
// ============================================

/**
 * Upsert user street progress for streets covered in an activity
 *
 * Called after route progress is updated. For each street:
 * - Creates record if not exists
 * - Updates percentage (MAX rule), everCompleted, runCount, completionCount
 * - Sets firstRunDate on first occurrence, lastRunDate every time
 *
 * @param userId - User ID
 * @param streets - Array of street progress data from activity processing
 */
export async function upsertStreetProgress(
  userId: string,
  streets: UpsertStreetProgressInput[]
): Promise<void> {
  if (streets.length === 0) return;

  for (const input of streets) {
    const existing = await prisma.userStreetProgress.findUnique({
      where: {
        userId_osmId: { userId, osmId: input.osmId },
      },
    });

    const now = new Date();

    if (existing) {
      await prisma.userStreetProgress.update({
        where: { id: existing.id },
        data: {
          percentage: Math.max(existing.percentage, input.percentage),
          everCompleted: existing.everCompleted || input.isComplete,
          runCount: existing.runCount + 1,
          completionCount:
            existing.completionCount + (input.isComplete ? 1 : 0),
          lastRunDate: now,
          name: input.name,
          highwayType: input.highwayType,
          lengthMeters: input.lengthMeters,
        },
      });
    } else {
      await prisma.userStreetProgress.create({
        data: {
          userId,
          osmId: input.osmId,
          name: input.name,
          highwayType: input.highwayType,
          lengthMeters: input.lengthMeters,
          percentage: input.percentage,
          everCompleted: input.isComplete,
          runCount: 1,
          completionCount: input.isComplete ? 1 : 0,
          firstRunDate: now,
          lastRunDate: now,
        },
      });
    }
  }
}

// ============================================
// Query (Used by Map Service)
// ============================================

/**
 * Get user street progress records by userId and optional osmId filter
 *
 * @param userId - User ID
 * @param osmIds - Optional set of osmIds to filter (e.g. from geometry query)
 * @param minPercentage - Only return streets with percentage >= this (default 0)
 * @returns Array of UserStreetProgress records
 */
export async function getUserStreetProgress(
  userId: string,
  options?: {
    osmIds?: string[];
    minPercentage?: number;
  }
): Promise<
  Array<{
    osmId: string;
    name: string;
    highwayType: string;
    lengthMeters: number;
    percentage: number;
    everCompleted: boolean;
    runCount: number;
    completionCount: number;
    firstRunDate: Date | null;
    lastRunDate: Date | null;
  }>
> {
  const minPercentage = options?.minPercentage ?? 0;

  const where: {
    userId: string;
    percentage?: { gte: number };
    osmId?: { in: string[] };
  } = {
    userId,
    percentage: { gte: minPercentage },
  };

  if (options?.osmIds && options.osmIds.length > 0) {
    where.osmId = { in: options.osmIds };
  }

  const rows = await prisma.userStreetProgress.findMany({
    where,
    select: {
      osmId: true,
      name: true,
      highwayType: true,
      lengthMeters: true,
      percentage: true,
      everCompleted: true,
      runCount: true,
      completionCount: true,
      firstRunDate: true,
      lastRunDate: true,
    },
  });

  return rows;
}
