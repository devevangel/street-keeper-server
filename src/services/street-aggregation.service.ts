/**
 * Street Aggregation Service
 * Groups OSM way segments into logical streets and buckets unnamed roads
 *
 * Phase 4 Implementation: Street Aggregation
 *
 * Problem Solved:
 * OpenStreetMap often splits a single logical street into multiple "ways"
 * (segments). For example, "Peascod Street" might appear as:
 * - way/223199277: "Peascod Street" (pedestrian, 150m)
 * - way/5069588: "Peascod Street" (pedestrian, 120m)
 * - way/223202902: "Peascod Street" (pedestrian, 180m)
 *
 * This creates duplicate entries in the results, making it hard to see
 * which streets were actually covered. This service aggregates these
 * segments into single logical street entries.
 *
 * Features:
 * 1. Street Name Normalization
 *    - Normalizes street names for grouping (case-insensitive, trimmed)
 *    - Handles variations like "Main St" vs "Main Street"
 *
 * 2. Logical Street Grouping
 *    - Groups segments by (normalizedName + highwayType)
 *    - Sums lengths and distances across segments
 *    - Calculates aggregated coverage ratios
 *    - Clamps coverage ratios to 1.0 for UX (keeps raw for debugging)
 *
 * 3. Unnamed Road Bucketing
 *    - Groups unnamed roads by highway type
 *    - Filters out tiny segments (< 30m length AND < 20m covered)
 *    - Provides meaningful summaries (e.g., "Footpath (Unnamed)")
 *
 * 4. Completion Status
 *    - Determines FULL vs PARTIAL based on aggregated coverage
 *    - Uses geometry-based coverage ratio if available (Phase 2)
 *
 * Use Cases:
 * - Reduce duplicate street entries in API responses
 * - Improve UX by showing logical streets instead of OSM segments
 * - Better handle unnamed roads (footways, paths, etc.)
 * - Provide cleaner, more meaningful results
 *
 * Dependencies:
 * - run.types.ts: AggregatedStreet, UnnamedRoadBucket, AggregationResult types
 * - constants.ts: STREET_AGGREGATION thresholds
 */

import type {
  MatchedStreet,
  AggregatedStreet,
  UnnamedRoadBucket,
  AggregationResult,
  CompletionStatus,
} from "../types/run.types.js";
import { STREET_AGGREGATION, STREET_MATCHING } from "../config/constants.js";

// ============================================
// Street Name Normalization
// ============================================

/**
 * Normalize street name for grouping
 *
 * Normalizes street names to enable consistent grouping of segments
 * that represent the same logical street. Handles:
 * - Case differences: "Main Street" vs "main street"
 * - Whitespace: "Main  Street" vs "Main Street"
 * - Leading/trailing spaces
 *
 * @param name - Original street name
 * @returns Normalized name (lowercase, trimmed, single spaces)
 *
 * @example
 * normalizeStreetName("Main Street")  // "main street"
 * normalizeStreetName("MAIN STREET")  // "main street"
 * normalizeStreetName("  Main  Street  ")  // "main street"
 */
export function normalizeStreetName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Check if a street is unnamed
 *
 * Determines if a street should be treated as "unnamed" for bucketing.
 * Unnamed streets are grouped by highway type rather than listed individually.
 *
 * @param name - Street name to check
 * @returns true if street is unnamed, false otherwise
 *
 * @example
 * isUnnamedStreet("Unnamed Road")  // true
 * isUnnamedStreet("unnamed")       // true
 * isUnnamedStreet("")              // true
 * isUnnamedStreet("Main Street")   // false
 */
export function isUnnamedStreet(name: string): boolean {
  const normalized = name.toLowerCase().trim();
  const unnamedPatterns = ["unnamed road", "unnamed", ""];
  return unnamedPatterns.includes(normalized);
}

// ============================================
// Main Aggregation Function
// ============================================

/**
 * Aggregate street segments into logical streets
 *
 * Phase 4 Implementation: Main Aggregation Logic
 *
 * Takes raw segment-level matched streets and aggregates them into
 * logical streets. This solves the problem of duplicate street entries
 * caused by OSM way fragmentation.
 *
 * Algorithm:
 * 1. Separate named vs unnamed segments
 * 2. For named segments:
 *    a. Group by (normalizedName + highwayType)
 *    b. Sum lengths and distances per group
 *    c. Calculate aggregated coverage ratios
 *    d. Clamp coverage ratios to 1.0 for UX
 *    e. Determine completion status
 * 3. For unnamed segments:
 *    a. Filter out tiny segments (< 30m length AND < 20m covered)
 *    b. Group by highwayType
 *    c. Sum lengths and distances per group
 *    d. Calculate coverage ratios
 *    e. Count full vs partial completions
 *
 * @param segments - Array of matched street segments from street-matching.service.ts
 * @returns AggregationResult with aggregated streets and unnamed road buckets
 *
 * @example
 * const segments = [
 *   { name: "Peascod Street", highwayType: "pedestrian", osmId: "way/123", ... },
 *   { name: "Peascod Street", highwayType: "pedestrian", osmId: "way/456", ... },
 *   { name: "Unnamed Road", highwayType: "footway", osmId: "way/789", ... },
 * ];
 * const result = aggregateSegmentsIntoLogicalStreets(segments);
 * // Returns: {
 * //   streets: [
 * //     { name: "Peascod Street", segmentCount: 2, segmentOsmIds: ["way/123", "way/456"], ... }
 * //   ],
 * //   unnamedBuckets: [
 * //     { highwayType: "footway", displayName: "Footpath (Unnamed)", segmentCount: 1, ... }
 * //   ]
 * // }
 */
export function aggregateSegmentsIntoLogicalStreets(
  segments: MatchedStreet[]
): AggregationResult {
  // Separate named vs unnamed segments
  const namedSegments: MatchedStreet[] = [];
  const unnamedSegments: MatchedStreet[] = [];

  for (const segment of segments) {
    if (isUnnamedStreet(segment.name)) {
      unnamedSegments.push(segment);
    } else {
      namedSegments.push(segment);
    }
  }

  // Aggregate named segments into logical streets
  const aggregatedStreets = aggregateNamedStreets(namedSegments);

  // Bucket unnamed segments by highway type
  const unnamedBuckets = bucketUnnamedRoads(unnamedSegments);

  return {
    streets: aggregatedStreets,
    unnamedBuckets,
  };
}

// ============================================
// Named Street Aggregation
// ============================================

/**
 * Aggregate named street segments into logical streets
 *
 * Groups segments by normalized name + highway type, then aggregates
 * their metrics (length, distance covered, coverage ratios).
 *
 * @param segments - Named street segments
 * @returns Array of aggregated logical streets
 */
function aggregateNamedStreets(
  segments: MatchedStreet[]
): AggregatedStreet[] {
  // Group segments by (normalizedName + highwayType)
  const groups = new Map<string, MatchedStreet[]>();

  for (const segment of segments) {
    const normalizedName = normalizeStreetName(segment.name);
    const groupKey = `${normalizedName}|${segment.highwayType}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(segment);
  }

  // Aggregate each group into a logical street
  const aggregatedStreets: AggregatedStreet[] = [];

  for (const [groupKey, groupSegments] of groups) {
    const [normalizedName, highwayType] = groupKey.split("|");
    const firstSegment = groupSegments[0];

    // Use geometry-based distance if available (Phase 2), otherwise use regular distance
    const totalDistanceCovered = groupSegments.reduce(
      (sum, seg) =>
        sum +
        (seg.geometryDistanceCoveredMeters ?? seg.distanceCoveredMeters),
      0
    );

    const totalLength = groupSegments.reduce(
      (sum, seg) => sum + seg.lengthMeters,
      0
    );

    // Calculate coverage ratios
    const rawCoverageRatio =
      totalLength > 0 ? totalDistanceCovered / totalLength : 0;

    // Clamp coverage ratio to max 1.0 for UX (but keep raw for debugging)
    const coverageRatio = Math.min(
      rawCoverageRatio,
      STREET_AGGREGATION.MAX_DISPLAY_COVERAGE_RATIO
    );

    // Determine completion status based on geometry ratio if available
    // Otherwise use regular coverage ratio
    const effectiveCoverageRatio = rawCoverageRatio;
    const completionStatus: CompletionStatus =
      effectiveCoverageRatio >= STREET_MATCHING.COMPLETION_THRESHOLD
        ? "FULL"
        : "PARTIAL";

    // Build aggregated street
    aggregatedStreets.push({
      name: firstSegment.name, // Use original name (not normalized) for display
      normalizedName,
      highwayType,
      totalLengthMeters: Math.round(totalLength * 100) / 100,
      totalDistanceCoveredMeters: Math.round(totalDistanceCovered * 100) / 100,
      coverageRatio: Math.round(coverageRatio * 1000) / 1000,
      rawCoverageRatio: Math.round(rawCoverageRatio * 1000) / 1000,
      completionStatus,
      segmentCount: groupSegments.length,
      segmentOsmIds: groupSegments.map((seg) => seg.osmId),
    });
  }

  // Sort by distance covered (most covered first)
  return aggregatedStreets.sort(
    (a, b) => b.totalDistanceCoveredMeters - a.totalDistanceCoveredMeters
  );
}

// ============================================
// Unnamed Road Bucketing
// ============================================

/**
 * Bucket unnamed road segments by highway type
 *
 * Groups unnamed roads by highway type and filters out tiny segments.
 * This reduces clutter and provides meaningful summaries.
 *
 * @param segments - Unnamed street segments
 * @returns Array of unnamed road buckets
 */
function bucketUnnamedRoads(
  segments: MatchedStreet[]
): UnnamedRoadBucket[] {
  // Filter out tiny unnamed segments
  const filteredSegments = segments.filter((seg) => {
    const isLongEnough =
      seg.lengthMeters >= STREET_AGGREGATION.MIN_UNNAMED_LENGTH_METERS;
    const isCoveredEnough =
      seg.distanceCoveredMeters >=
      STREET_AGGREGATION.MIN_UNNAMED_COVERED_METERS;

    // Both conditions must be met (AND logic)
    return isLongEnough && isCoveredEnough;
  });

  // Group by highway type
  const groups = new Map<string, MatchedStreet[]>();

  for (const segment of filteredSegments) {
    const highwayType = segment.highwayType || "unknown";

    if (!groups.has(highwayType)) {
      groups.set(highwayType, []);
    }
    groups.get(highwayType)!.push(segment);
  }

  // Build buckets
  const buckets: UnnamedRoadBucket[] = [];

  for (const [highwayType, groupSegments] of groups) {
    // Use geometry-based distance if available (Phase 2), otherwise use regular distance
    const totalDistanceCovered = groupSegments.reduce(
      (sum, seg) =>
        sum +
        (seg.geometryDistanceCoveredMeters ?? seg.distanceCoveredMeters),
      0
    );

    const totalLength = groupSegments.reduce(
      (sum, seg) => sum + seg.lengthMeters,
      0
    );

    const coverageRatio =
      totalLength > 0 ? totalDistanceCovered / totalLength : 0;

    // Count full vs partial completions
    const fullCount = groupSegments.filter(
      (seg) => seg.completionStatus === "FULL"
    ).length;
    const partialCount = groupSegments.length - fullCount;

    // Generate display name
    const displayName = formatUnnamedRoadDisplayName(highwayType);

    buckets.push({
      highwayType,
      displayName,
      totalLengthMeters: Math.round(totalLength * 100) / 100,
      totalDistanceCoveredMeters: Math.round(totalDistanceCovered * 100) / 100,
      coverageRatio: Math.round(coverageRatio * 1000) / 1000,
      segmentCount: groupSegments.length,
      fullCount,
      partialCount,
    });
  }

  // Sort by distance covered (most covered first)
  return buckets.sort(
    (a, b) => b.totalDistanceCoveredMeters - a.totalDistanceCoveredMeters
  );
}

/**
 * Format display name for unnamed road bucket
 *
 * Creates a user-friendly display name for unnamed road buckets
 * based on highway type.
 *
 * @param highwayType - Highway type from OSM (e.g., "footway", "path")
 * @returns Formatted display name
 *
 * @example
 * formatUnnamedRoadDisplayName("footway")  // "Footpath (Unnamed)"
 * formatUnnamedRoadDisplayName("path")     // "Path (Unnamed)"
 * formatUnnamedRoadDisplayName("track")    // "Track (Unnamed)"
 */
function formatUnnamedRoadDisplayName(highwayType: string): string {
  const displayNames: Record<string, string> = {
    footway: "Footpath (Unnamed)",
    path: "Path (Unnamed)",
    track: "Track (Unnamed)",
    cycleway: "Cycleway (Unnamed)",
    pedestrian: "Pedestrian Way (Unnamed)",
    steps: "Steps (Unnamed)",
    service: "Service Road (Unnamed)",
    unknown: "Unknown Road (Unnamed)",
  };

  return (
    displayNames[highwayType.toLowerCase()] ||
    `${highwayType.charAt(0).toUpperCase() + highwayType.slice(1)} (Unnamed)`
  );
}
