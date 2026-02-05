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
import { projectPointOntoStreet } from "./geo.service.js";
import type { GpxPoint, GeoJsonLineString } from "../types/run.types.js";

// ============================================
// Types
// ============================================

/**
 * Merge a new coverage interval with existing intervals.
 *
 * Handles overlapping and adjacent intervals by merging them into continuous ranges.
 * Example:
 * - Existing: [[0, 50]]
 * - New: [40, 90]
 * - Result: [[0, 90]] (merged overlapping)
 *
 * @param existing - Existing coverage intervals
 * @param newInterval - New interval to add
 * @returns Merged intervals array
 */
export function mergeIntervals(
  existing: CoverageInterval[],
  newInterval: CoverageInterval
): CoverageInterval[] {
  // Combine and sort by start position
  const all = [...existing, newInterval].sort((a, b) => a[0] - b[0]);
  const merged: CoverageInterval[] = [];

  for (const interval of all) {
    if (merged.length === 0) {
      merged.push([...interval]);
      continue;
    }

    const last = merged[merged.length - 1];

    // If intervals overlap or are adjacent (within 1%), merge them
    if (interval[0] <= last[1] + 1) {
      // Extend the last interval to cover both
      last[1] = Math.max(last[1], interval[1]);
    } else {
      // Gap between intervals - add as new interval
      merged.push([...interval]);
    }
  }

  return merged;
}

/**
 * Calculate total coverage percentage from intervals.
 *
 * Sums the length of all intervals, accounting for overlaps.
 *
 * @param intervals - Array of coverage intervals
 * @returns Total coverage percentage (0-100)
 */
export function calculateTotalCoverage(intervals: CoverageInterval[]): number {
  if (intervals.length === 0) return 0;

  // Clamp to 0-100 range
  return Math.min(
    100,
    intervals.reduce((sum, [start, end]) => sum + (end - start), 0)
  );
}

/**
 * Maximum allowed gap percentage before a street is considered incomplete.
 * A gap of 5% or more in the coverage means the street is NOT complete.
 */
const MAX_ALLOWED_GAP_PERCENT = 5;

/**
 * Minimum span required for a single interval to be considered "complete".
 * If coverage is a single interval, it must span at least this percentage.
 */
const MIN_COMPLETE_SPAN_PERCENT = 95;

/**
 * Check if coverage intervals have significant gaps that prevent completion.
 *
 * A street should NOT be marked complete if:
 * 1. Coverage has multiple intervals with gaps >= MAX_ALLOWED_GAP_PERCENT between them
 * 2. Coverage is a single interval that doesn't span MIN_COMPLETE_SPAN_PERCENT
 *
 * @param intervals - Merged coverage intervals (should already be merged)
 * @returns true if there are significant gaps (NOT complete), false if coverage is continuous
 *
 * @example
 * hasSignificantGap([[0, 50], [70, 100]]) // true - 20% gap
 * hasSignificantGap([[0, 96]]) // false - single interval spanning 96%
 * hasSignificantGap([[0, 40], [42, 100]]) // false - only 2% gap
 * hasSignificantGap([[5, 50]]) // true - single interval only spans 45%
 */
export function hasSignificantGap(intervals: CoverageInterval[]): boolean {
  if (intervals.length === 0) return true; // No coverage = not complete

  // Sort intervals by start position
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);

  // Check for gaps at the start (if first interval doesn't start near 0)
  if (sorted[0][0] > MAX_ALLOWED_GAP_PERCENT) {
    return true; // Gap at the beginning
  }

  // Check for gaps between intervals
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i][0] - sorted[i - 1][1];
    if (gap > MAX_ALLOWED_GAP_PERCENT) {
      return true; // Significant gap between intervals
    }
  }

  // Check for gap at the end (if last interval doesn't end near 100)
  const lastEnd = sorted[sorted.length - 1][1];
  if (100 - lastEnd > MAX_ALLOWED_GAP_PERCENT) {
    return true; // Gap at the end
  }

  // Also check total span - must cover enough of the street
  const totalCoverage = calculateTotalCoverage(intervals);
  if (totalCoverage < MIN_COMPLETE_SPAN_PERCENT) {
    return true; // Total coverage too low
  }

  return false; // No significant gaps
}

/**
 * Determine if a street should be marked as complete using gap-aware logic.
 *
 * Combines:
 * 1. Total coverage percentage vs threshold
 * 2. Gap detection (no significant uncovered sections)
 *
 * @param intervals - Coverage intervals (will be merged internally)
 * @param completionThreshold - Required coverage threshold (0-1, e.g. 0.95 = 95%)
 * @returns true if street meets completion requirements AND has no significant gaps
 */
export function isStreetCompletedWithGapCheck(
  intervals: CoverageInterval[],
  completionThreshold: number
): boolean {
  if (intervals.length === 0) return false;

  // Merge intervals first
  let merged = intervals;
  if (intervals.length > 1) {
    // Re-merge by adding intervals one by one
    merged = [];
    for (const interval of intervals) {
      merged = mergeIntervals(merged, interval);
    }
  }

  // Check total coverage meets threshold
  const totalCoverage = calculateTotalCoverage(merged);
  if (totalCoverage < completionThreshold * 100) {
    return false;
  }

  // Check for gaps
  if (hasSignificantGap(merged)) {
    return false;
  }

  return true;
}

/**
 * Calculate coverage interval from GPS points matched to a street.
 *
 * Phase 3 Enhancement: GPS-to-Interval Conversion
 *
 * Projects GPS points onto street geometry and calculates which portions
 * of the street were covered, returning an interval [start%, end%].
 *
 * For consecutive segments, merges them into a single interval.
 * For non-consecutive segments, creates separate intervals.
 *
 * @param points - GPS points matched to the street
 * @param streetGeometry - GeoJSON LineString representing the street
 * @param streetLengthMeters - Total length of the street in meters
 * @returns Coverage interval [start%, end%], or null if no valid coverage
 *
 * @example
 * // Runner covered first 50% of street, then 80-90%
 * // Returns: [[0, 50], [80, 90]]
 */
export function calculateCoverageInterval(
  points: GpxPoint[],
  streetGeometry: GeoJsonLineString,
  streetLengthMeters: number
): CoverageInterval | null {
  if (points.length === 0 || streetLengthMeters === 0) return null;

  // Project all points onto street geometry
  const projected = points.map((p) => projectPointOntoStreet(p, streetGeometry));

  // Calculate position ratios (0-1) along the street
  const positions = projected.map(
    (p) => p.distanceAlongStreet / streetLengthMeters
  );

  // Find min and max positions (covers the range)
  const minPos = Math.min(...positions);
  const maxPos = Math.max(...positions);

  // Clamp to 0-1 range
  const startRatio = Math.max(0, Math.min(1, minPos));
  const endRatio = Math.max(0, Math.min(1, maxPos));

  // Convert to percentage (0-100) and round
  const startPercent = Math.round(startRatio * 100);
  const endPercent = Math.round(endRatio * 100);

  // Ensure start <= end
  if (startPercent >= endPercent) return null;

  return [startPercent, endPercent];
}

/**
 * Spatial coverage interval: [start%, end%]
 * Represents a portion of a street that has been covered.
 * Example: [0, 50] means the first 50% of the street was covered.
 */
export type CoverageInterval = [number, number];

/**
 * Spatial coverage data structure
 */
export interface SpatialCoverage {
  intervals: CoverageInterval[];
}

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
  /** True if this run achieved completion threshold */
  isComplete: boolean;
  /** Optional: Spatial coverage intervals [start%, end%] for cumulative tracking */
  coverageInterval?: CoverageInterval;
}

// ============================================
// Upsert (Called from Activity Processor)
// ============================================

/**
 * Upsert user street progress for streets covered in an activity
 *
 * Called after route progress is updated. For each street:
 * - Creates record if not exists
 * - Updates percentage using cumulative spatial coverage (intervals) when available
 * - Falls back to MAX rule if intervals not provided
 * - Updates everCompleted, runCount, completionCount
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

    // Handle spatial coverage if provided
    let newPercentage: number;
    let spatialCoverage: SpatialCoverage | null = null;

    if (input.coverageInterval) {
      // Use interval-based cumulative coverage
      const existingIntervals: CoverageInterval[] =
        (existing?.spatialCoverage as SpatialCoverage | null)?.intervals || [];
      const mergedIntervals = mergeIntervals(
        existingIntervals,
        input.coverageInterval
      );
      newPercentage = calculateTotalCoverage(mergedIntervals);
      spatialCoverage = { intervals: mergedIntervals };
    } else {
      // Fallback to MAX rule (backwards compatibility)
      newPercentage = existing
        ? Math.max(existing.percentage, input.percentage)
        : input.percentage;
      // Preserve existing spatial coverage if it exists
      if (existing?.spatialCoverage) {
        spatialCoverage = existing.spatialCoverage as unknown as SpatialCoverage;
      }
    }

    if (existing) {
      await prisma.userStreetProgress.update({
        where: { id: existing.id },
        data: {
          percentage: newPercentage,
          spatialCoverage: spatialCoverage
            ? (spatialCoverage as unknown as object)
            : undefined,
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
          percentage: newPercentage,
          spatialCoverage: spatialCoverage
            ? (spatialCoverage as unknown as object)
            : undefined,
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
/**
 * Spatial coverage as stored in DB: intervals are [start%, end%] (0-100).
 */
export type SpatialCoverageJson = { intervals: CoverageInterval[] };

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
    /** Coverage intervals [start%, end%] for map covered/uncovered geometry */
    spatialCoverage: SpatialCoverageJson | null;
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
      spatialCoverage: true,
    },
  });

  return rows.map((r) => ({
    osmId: r.osmId,
    name: r.name,
    highwayType: r.highwayType,
    lengthMeters: r.lengthMeters,
    percentage: r.percentage,
    everCompleted: r.everCompleted,
    runCount: r.runCount,
    completionCount: r.completionCount,
    firstRunDate: r.firstRunDate,
    lastRunDate: r.lastRunDate,
    spatialCoverage: r.spatialCoverage as SpatialCoverageJson | null,
  }));
}
