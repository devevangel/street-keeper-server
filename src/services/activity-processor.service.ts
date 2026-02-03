/**
 * Activity Processor Service
 * Orchestrates the complete pipeline for processing an activity against routes
 *
 * OVERVIEW:
 * ---------
 * When a user completes a run, this service determines:
 * 1. Which of the user's routes were affected (overlap detection)
 * 2. Which streets were covered on each route (street matching)
 * 3. How much of each street was covered (coverage calculation)
 * 4. Update route progress (snapshot updates)
 *
 * PROCESSING PIPELINE:
 * --------------------
 *
 * ```
 * Activity GPS Points
 *        │
 *        ▼
 * ┌─────────────────────┐
 * │ 1. Overlap Detection│  ← Which routes does this activity touch?
 * │    (bbox-first)     │    Uses two-phase algorithm for efficiency
 * └─────────────────────┘
 *        │
 *        ▼ (for each overlapping route)
 * ┌─────────────────────┐
 * │ 2. Get Route Streets│  ← What streets are in this route?
 * │    (from snapshot)  │    Uses existing snapshot data
 * └─────────────────────┘
 *        │
 *        ▼
 * ┌─────────────────────┐
 * │ 3. Query Geometries │  ← Need full street geometries for matching
 * │    (cache/Overpass) │    Uses geometry cache when possible
 * └─────────────────────┘
 *        │
 *        ▼
 * ┌─────────────────────┐
 * │ 4. Match to Streets │  ← Which GPS points are on which streets?
 * │    (Mapbox/Overpass)│    Hybrid matching for best accuracy
 * └─────────────────────┘
 *        │
 *        ▼
 * ┌─────────────────────┐
 * │ 5. Calculate Impact │  ← What % of each street was covered?
 * │                     │    Maps matched streets to snapshot
 * └─────────────────────┘
 *        │
 *        ▼
 * ┌─────────────────────┐
 * │ 6. Update Progress  │  ← Update route snapshot with new progress
 * │                     │    Uses MAX (never decrease progress)
 * └─────────────────────┘
 *        │
 *        ▼
 * ┌─────────────────────┐
 * │ 7. Save Relationship│  ← Record RouteActivity for history
 * │                     │    Includes impact details
 * └─────────────────────┘
 * ```
 *
 * KEY DESIGN DECISIONS:
 * ---------------------
 *
 * 1. **MAX Progress Rule**: Street percentage never decreases.
 *    If a user runs 80% of a street, then 60% on next run, progress stays at 80%.
 *    This prevents "losing" progress due to GPS variations or different routes.
 *
 * 2. **Completion Threshold (90%)**: Streets are "completed" at 90% coverage.
 *    This accounts for GPS drift at street ends and corner cutting.
 *
 * 3. **Hybrid Matching**: Uses Mapbox when available for ~98% accuracy,
 *    falls back to Overpass-only (~85% accuracy) if Mapbox fails.
 *
 * 4. **Geometry Caching**: Caches Overpass responses to avoid redundant API calls.
 *    Cache is checked before querying Overpass for street geometries.
 *
 * @example
 * // Process an activity
 * const result = await processActivity("activity-123", "user-456");
 *
 * console.log(result.routesProcessed);
 * // [
 * //   { routeId: "route-1", streetsCovered: 15, streetsCompleted: 3 },
 * //   { routeId: "route-2", streetsCovered: 8, streetsCompleted: 1 }
 * // ]
 */

import {
  getActivityCoordinates,
  markActivityProcessed,
  saveRouteActivity,
} from "./activity.service.js";
import {
  detectOverlappingRoutes,
  type OverlapResult,
} from "./overlap-detection.service.js";
import { updateRouteProgress } from "./route.service.js";
import { upsertStreetProgress } from "./user-street-progress.service.js";
import { queryStreetsInRadius } from "./overpass.service.js";
import { matchPointsToStreetsHybrid } from "./street-matching.service.js";
import {
  aggregateSegmentsIntoLogicalStreets,
  normalizeStreetNameForMatching,
  streetNamesMatch,
} from "./street-aggregation.service.js";
import {
  generateRadiusCacheKey,
  getCachedGeometries,
  setCachedGeometries,
} from "./geometry-cache.service.js";
import prisma from "../lib/prisma.js";
import type { GpxPoint, OsmStreet, MatchedStreet } from "../types/run.types.js";
import type { StreetSnapshot, SnapshotStreet } from "../types/route.types.js";
import type { ActivityImpact } from "../types/activity.types.js";

// ============================================
// Type Definitions
// ============================================

/**
 * Result of processing a single route
 *
 * Contains details about which streets were affected and how.
 */
export interface RouteProcessingResult {
  /** Route ID */
  routeId: string;
  /** Route name (for logging) */
  routeName: string;
  /** Number of GPS points that fell within the route */
  pointsInRoute: number;
  /** Total streets that had any coverage from this activity */
  streetsCovered: number;
  /** Streets that reached 90%+ completion (newly or still) */
  streetsCompleted: number;
  /** Streets whose percentage increased */
  streetsImproved: number;
  /** Detailed impact information */
  impact: ActivityImpact;
}

/**
 * Full result of processing an activity
 */
export interface ActivityProcessingResult {
  /** Activity ID */
  activityId: string;
  /** Whether processing completed successfully */
  success: boolean;
  /** Total routes that were affected */
  routesProcessed: number;
  /** Details for each route */
  routes: RouteProcessingResult[];
  /** Total time taken in milliseconds */
  processingTimeMs: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Street coverage result from matching
 */
interface StreetCoverage {
  /** OSM ID of the street */
  osmId: string;
  /** Coverage percentage (0-100) */
  percentage: number;
  /** Whether this activity alone would complete the street */
  isComplete: boolean;
}

// ============================================
// Main Processing Function
// ============================================

/**
 * Process an activity against all user routes
 *
 * This is the main entry point for activity processing. It:
 * 1. Gets the activity's GPS coordinates
 * 2. Detects which routes overlap with the activity
 * 3. For each overlapping route, calculates street coverage
 * 4. Updates route progress and saves relationships
 *
 * @param activityId - Internal activity ID
 * @param userId - User ID (for fetching routes)
 * @returns Processing result with details for each affected route
 *
 * @example
 * const result = await processActivity("activity-123", "user-456");
 * if (result.success) {
 *   console.log(`Processed ${result.routesProcessed} routes`);
 *   for (const route of result.routes) {
 *     console.log(`  ${route.routeName}: ${route.streetsCompleted} completed`);
 *   }
 * }
 */
export async function processActivity(
  activityId: string,
  userId: string
): Promise<ActivityProcessingResult> {
  const startTime = Date.now();
  const routeResults: RouteProcessingResult[] = [];

  try {
    // Step 1: Get activity coordinates
    console.log(`[Processor] Starting processing for activity ${activityId}`);
    const coordinates = await getActivityCoordinates(activityId);

    if (coordinates.length === 0) {
      console.log(`[Processor] Activity ${activityId} has no coordinates`);
      await markActivityProcessed(activityId);
      return {
        activityId,
        success: true,
        routesProcessed: 0,
        routes: [],
        processingTimeMs: Date.now() - startTime,
      };
    }

    console.log(`[Processor] Activity has ${coordinates.length} GPS points`);

    // Step 2: Detect overlapping routes
    const overlappingRoutes = await detectOverlappingRoutes(
      userId,
      coordinates
    );
    console.log(
      `[Processor] Found ${overlappingRoutes.length} overlapping routes`
    );

    if (overlappingRoutes.length === 0) {
      // No routes affected - still mark as processed
      await markActivityProcessed(activityId);
      return {
        activityId,
        success: true,
        routesProcessed: 0,
        routes: [],
        processingTimeMs: Date.now() - startTime,
      };
    }

    // Step 3: Process each overlapping route
    for (const overlap of overlappingRoutes) {
      try {
        const result = await processRouteOverlap(
          activityId,
          userId,
          overlap,
          coordinates
        );
        routeResults.push(result);
      } catch (error) {
        // Log error but continue processing other routes
        console.error(
          `[Processor] Error processing route ${overlap.route.id}:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    // Step 4: Mark activity as processed
    await markActivityProcessed(activityId);

    const processingTimeMs = Date.now() - startTime;
    console.log(
      `[Processor] Completed processing activity ${activityId} in ${processingTimeMs}ms. ` +
        `Routes: ${routeResults.length}, Total completed: ${routeResults.reduce(
          (sum, r) => sum + r.streetsCompleted,
          0
        )}`
    );

    return {
      activityId,
      success: true,
      routesProcessed: routeResults.length,
      routes: routeResults,
      processingTimeMs,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(
      `[Processor] Failed to process activity ${activityId}:`,
      errorMessage
    );

    return {
      activityId,
      success: false,
      routesProcessed: 0,
      routes: [],
      processingTimeMs: Date.now() - startTime,
      error: errorMessage,
    };
  }
}

// ============================================
// Route Processing
// ============================================

/**
 * Process a single route overlap
 *
 * For a route that overlaps with the activity:
 * 1. Gets the route's current snapshot
 * 2. Queries street geometries (from cache or Overpass)
 * 3. Matches GPS points to streets
 * 4. Calculates coverage for each street
 * 5. Updates route progress
 * 6. Updates user-level street progress (for map feature)
 * 7. Saves the route-activity relationship
 *
 * @param activityId - Activity ID
 * @param userId - User ID (for user street progress)
 * @param overlap - Overlap detection result
 * @param coordinates - GPS coordinates from activity
 * @returns Processing result for this route
 */
async function processRouteOverlap(
  activityId: string,
  userId: string,
  overlap: OverlapResult,
  coordinates: GpxPoint[]
): Promise<RouteProcessingResult> {
  const { route } = overlap;
  console.log(`[Processor] Processing route "${route.name}" (${route.id})`);

  // Step 1: Get the route's current snapshot
  const routeData = await prisma.route.findUnique({
    where: { id: route.id },
    select: {
      streetsSnapshot: true,
      centerLat: true,
      centerLng: true,
      radiusMeters: true,
    },
  });

  if (!routeData) {
    throw new Error(`Route ${route.id} not found`);
  }

  const snapshot = routeData.streetsSnapshot as StreetSnapshot;

  // Step 2: Get street geometries (for matching)
  // Try cache first, then Overpass
  const geometries = await getStreetGeometries(
    routeData.centerLat,
    routeData.centerLng,
    routeData.radiusMeters
  );

  // Step 3: Match GPS points to streets
  // Use hybrid matching for best accuracy
  const matchedStreets = await matchPointsToStreetsHybrid(
    coordinates,
    geometries
  );
  console.log(
    `[Processor] Matched ${matchedStreets.length} streets for route "${route.name}"`
  );

  // Step 4: Aggregate matched streets (combine segments)
  const aggregated = aggregateSegmentsIntoLogicalStreets(matchedStreets);

  // Step 5: Calculate coverage and impact
  const { coverages, impact } = calculateRouteImpact(
    snapshot,
    aggregated.streets,
    matchedStreets
  );

  // Step 6: Update route progress
  if (coverages.length > 0) {
    const streetUpdates = coverages.map((c) => ({
      osmId: c.osmId,
      percentage: c.percentage,
      lastRunDate: new Date().toISOString(),
    }));

    await updateRouteProgress(route.id, streetUpdates);
    console.log(
      `[Processor] Updated ${streetUpdates.length} streets in route "${route.name}"`
    );

    // Step 6b: Update user-level street progress (for map feature)
    const snapshotByOsmId = new Map(snapshot.streets.map((s) => [s.osmId, s]));
    const streetProgressInput = coverages
      .map((c) => {
        const snap = snapshotByOsmId.get(c.osmId);
        if (!snap) return null;
        return {
          osmId: c.osmId,
          name: snap.name,
          highwayType: snap.highwayType,
          lengthMeters: snap.lengthMeters,
          percentage: c.percentage,
          isComplete: c.isComplete,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    await upsertStreetProgress(userId, streetProgressInput);
  }

  // Step 7: Save route-activity relationship
  await saveRouteActivity(route.id, activityId, impact);

  return {
    routeId: route.id,
    routeName: route.name,
    pointsInRoute: overlap.pointsInsideCount,
    streetsCovered: coverages.length,
    streetsCompleted: impact.completed.length,
    streetsImproved: impact.improved.length,
    impact,
  };
}

// ============================================
// Street Geometry Fetching
// ============================================

/**
 * Get street geometries for a route area
 *
 * Checks cache first, then queries Overpass if needed.
 * Caches the result for future use.
 *
 * @param centerLat - Route center latitude
 * @param centerLng - Route center longitude
 * @param radiusMeters - Route radius
 * @returns Array of OsmStreet with full geometries
 */
async function getStreetGeometries(
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): Promise<OsmStreet[]> {
  // Try cache first
  const cacheKey = generateRadiusCacheKey(centerLat, centerLng, radiusMeters);
  const cached = await getCachedGeometries(cacheKey);

  if (cached) {
    console.log(
      `[Processor] Using cached geometries for ${radiusMeters}m radius`
    );
    return cached;
  }

  // Query Overpass
  console.log(`[Processor] Querying Overpass for ${radiusMeters}m radius`);
  const geometries = await queryStreetsInRadius(
    centerLat,
    centerLng,
    radiusMeters
  );

  // Cache for future use
  await setCachedGeometries(cacheKey, geometries);

  return geometries;
}

// ============================================
// Coverage Calculation
// ============================================

/**
 * Calculate impact of activity on route streets
 *
 * Compares matched streets from the activity with the route's snapshot
 * to determine which streets were affected and how.
 *
 * MATCHING ALGORITHM:
 * -------------------
 * For each matched street from the activity, we find the corresponding
 * street in the route snapshot by:
 * 1. Exact OSM ID match (preferred)
 * 2. Normalized name match (for cross-source matching)
 *
 * COVERAGE CALCULATION:
 * ---------------------
 * Coverage percentage = (distance covered / total length) × 100
 * - Uses geometry-based coverage when available (more accurate)
 * - Clamps to 100% maximum
 * - 90%+ is considered "completed"
 *
 * @param snapshot - Route's current street snapshot
 * @param aggregatedStreets - Aggregated matched streets
 * @param rawMatchedStreets - Raw matched streets (for OSM ID lookup)
 * @returns Coverage results and impact details
 */
function calculateRouteImpact(
  snapshot: StreetSnapshot,
  aggregatedStreets: Array<{
    name: string;
    normalizedName: string;
    coverageRatio: number;
    segmentOsmIds: string[];
  }>,
  rawMatchedStreets: MatchedStreet[]
): { coverages: StreetCoverage[]; impact: ActivityImpact } {
  const coverages: StreetCoverage[] = [];
  const completed: string[] = [];
  const improved: Array<{ osmId: string; from: number; to: number }> = [];

  // Build lookup maps for efficient matching
  // Map: osmId -> MatchedStreet (for raw matches)
  const rawByOsmId = new Map(rawMatchedStreets.map((s) => [s.osmId, s]));

  // Map: normalizedName -> aggregated street
  const aggregatedByName = new Map(
    aggregatedStreets.map((s) => [s.normalizedName, s])
  );

  // Process each street in the snapshot
  for (const snapshotStreet of snapshot.streets) {
    // Try to find matching activity coverage
    const coverage = findMatchingCoverage(
      snapshotStreet,
      rawByOsmId,
      aggregatedByName,
      rawMatchedStreets
    );

    if (coverage === null) {
      // Street not covered by this activity
      continue;
    }

    // Calculate new percentage (0-100)
    const newPercentage = Math.min(Math.round(coverage.ratio * 100), 100);
    const oldPercentage = snapshotStreet.percentage;

    // Only update if coverage increased (MAX rule)
    if (newPercentage > oldPercentage) {
      coverages.push({
        osmId: snapshotStreet.osmId,
        percentage: newPercentage,
        isComplete: newPercentage >= 90,
      });

      // Track improvements
      improved.push({
        osmId: snapshotStreet.osmId,
        from: oldPercentage,
        to: newPercentage,
      });

      // Track completions (newly completed)
      if (newPercentage >= 90 && oldPercentage < 90) {
        completed.push(snapshotStreet.osmId);
      }
    } else if (newPercentage >= 90 && oldPercentage >= 90) {
      // Already complete, still count as coverage but no improvement
      coverages.push({
        osmId: snapshotStreet.osmId,
        percentage: oldPercentage, // Keep existing
        isComplete: true,
      });
    }
  }

  return {
    coverages,
    impact: { completed, improved },
  };
}

/**
 * Find matching coverage from activity for a snapshot street
 *
 * Tries multiple matching strategies:
 * 1. Direct OSM ID match in raw matched streets
 * 2. Normalized name match in aggregated streets
 * 3. Fuzzy name match against all matched streets
 *
 * @param snapshotStreet - Street from route snapshot
 * @param rawByOsmId - Map of OSM ID -> MatchedStreet
 * @param aggregatedByName - Map of normalized name -> aggregated street
 * @param rawMatchedStreets - All raw matched streets
 * @returns Coverage ratio or null if not covered
 */
function findMatchingCoverage(
  snapshotStreet: SnapshotStreet,
  rawByOsmId: Map<string, MatchedStreet>,
  aggregatedByName: Map<
    string,
    { coverageRatio: number; segmentOsmIds: string[] }
  >,
  rawMatchedStreets: MatchedStreet[]
): { ratio: number } | null {
  // Strategy 1: Direct OSM ID match
  const rawMatch = rawByOsmId.get(snapshotStreet.osmId);
  if (rawMatch) {
    // Use geometry coverage if available (more accurate)
    const ratio = rawMatch.geometryCoverageRatio ?? rawMatch.coverageRatio;
    return { ratio };
  }

  // Strategy 2: Normalized name match
  const normalizedName = normalizeStreetNameForMatching(snapshotStreet.name);
  const aggregatedMatch = aggregatedByName.get(normalizedName);
  if (aggregatedMatch) {
    return { ratio: aggregatedMatch.coverageRatio };
  }

  // Strategy 3: Fuzzy name match
  for (const matched of rawMatchedStreets) {
    if (streetNamesMatch(snapshotStreet.name, matched.name)) {
      const ratio = matched.geometryCoverageRatio ?? matched.coverageRatio;
      return { ratio };
    }
  }

  // No match found
  return null;
}

// ============================================
// Batch Processing
// ============================================

/**
 * Process multiple activities (batch processing)
 *
 * Useful for backfilling when user creates a new route
 * and wants to apply historical activities.
 *
 * @param activityIds - Array of activity IDs to process
 * @param userId - User ID
 * @returns Array of processing results
 */
export async function processActivitiesBatch(
  activityIds: string[],
  userId: string
): Promise<ActivityProcessingResult[]> {
  const results: ActivityProcessingResult[] = [];

  for (const activityId of activityIds) {
    try {
      const result = await processActivity(activityId, userId);
      results.push(result);
    } catch (error) {
      console.error(
        `[Processor] Batch error for activity ${activityId}:`,
        error instanceof Error ? error.message : error
      );
      results.push({
        activityId,
        success: false,
        routesProcessed: 0,
        routes: [],
        processingTimeMs: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return results;
}

/**
 * Reprocess all activities for a specific route
 *
 * Called when a route is refreshed and we need to recalculate
 * progress based on all historical activities.
 *
 * @param routeId - Route ID to reprocess
 * @param userId - User ID (for verification)
 * @returns Number of activities reprocessed
 */
export async function reprocessRouteActivities(
  routeId: string,
  userId: string
): Promise<{ activitiesProcessed: number }> {
  // Get all activities for this user that are processed
  const activities = await prisma.activity.findMany({
    where: {
      userId,
      isProcessed: true,
    },
    select: {
      id: true,
      coordinates: true,
    },
    orderBy: {
      startDate: "asc", // Process in chronological order
    },
  });

  console.log(
    `[Processor] Reprocessing ${activities.length} activities for route ${routeId}`
  );

  // Get route data
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    select: {
      centerLat: true,
      centerLng: true,
      radiusMeters: true,
      name: true,
    },
  });

  if (!route) {
    throw new Error(`Route ${routeId} not found`);
  }

  // Reset route progress first
  await resetRouteProgress(routeId);

  // Process each activity against this route
  let processed = 0;

  for (const activity of activities) {
    const coordinates = activity.coordinates as GpxPoint[];

    if (!coordinates || coordinates.length === 0) {
      continue;
    }

    // Check if activity overlaps with route (simplified check)
    const overlaps = checkActivityOverlapsRoute(
      coordinates,
      route.centerLat,
      route.centerLng,
      route.radiusMeters
    );

    if (overlaps) {
      // Create a mock overlap result for processing
      const mockOverlap: OverlapResult = {
        route: {
          id: routeId,
          name: route.name,
          centerLat: route.centerLat,
          centerLng: route.centerLng,
          radiusMeters: route.radiusMeters,
        },
        samplePointsInside: [],
        pointsInsideCount: 1, // Just needs to be > 0
      };

      try {
        await processRouteOverlap(
          activity.id,
          userId,
          mockOverlap,
          coordinates
        );
        processed++;
      } catch (error) {
        console.error(
          `[Processor] Error reprocessing activity ${activity.id}:`,
          error instanceof Error ? error.message : error
        );
      }
    }
  }

  console.log(
    `[Processor] Reprocessed ${processed} activities for route "${route.name}"`
  );

  return { activitiesProcessed: processed };
}

/**
 * Reset route progress to 0 for all streets
 *
 * Used before reprocessing all activities for a route.
 */
async function resetRouteProgress(routeId: string): Promise<void> {
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    select: { streetsSnapshot: true },
  });

  if (!route) return;

  const snapshot = route.streetsSnapshot as StreetSnapshot;

  // Reset all streets to 0%
  for (const street of snapshot.streets) {
    street.completed = false;
    street.percentage = 0;
    street.lastRunDate = null;
  }

  // Update route
  await prisma.route.update({
    where: { id: routeId },
    data: {
      streetsSnapshot: snapshot as object,
      completedStreets: 0,
      progress: 0,
    },
  });

  // Delete existing RouteActivity records
  await prisma.routeActivity.deleteMany({
    where: { routeId },
  });
}

/**
 * Quick check if an activity overlaps with a route
 *
 * Simplified version of overlap detection for reprocessing.
 * Checks if any GPS point is within the route radius.
 */
function checkActivityOverlapsRoute(
  coordinates: GpxPoint[],
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): boolean {
  // Check every 10th point for efficiency
  for (let i = 0; i < coordinates.length; i += 10) {
    const point = coordinates[i];
    const distance = haversineDistance(
      centerLat,
      centerLng,
      point.lat,
      point.lng
    );

    if (distance <= radiusMeters) {
      return true;
    }
  }

  return false;
}

/**
 * Haversine distance calculation
 */
function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
