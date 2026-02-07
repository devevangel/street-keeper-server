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
  markActivityProcessed,
  saveProjectActivity,
  ActivityNotFoundError,
} from "./activity.service.js";
import {
  detectOverlappingProjects,
  type OverlapResult,
} from "./overlap-detection.service.js";
import { updateProjectProgress } from "./project.service.js";
import {
  upsertStreetProgress,
  calculateCoverageInterval,
  type CoverageInterval,
} from "./user-street-progress.service.js";
import { getCompletionThreshold, ENGINE } from "../config/constants.js";
import { processActivityV2 } from "../engines/v2/process-activity.js";
import { deriveProjectProgressV2 } from "../engines/v2/street-completion.js";
import {
  queryStreetsInRadius,
  queryStreetsInBoundingBox,
} from "./overpass.service.js";
import { matchPointsToStreetsHybrid } from "./street-matching.service.js";
import {
  aggregateSegmentsIntoLogicalStreets,
  isUnnamedStreet,
  normalizeStreetNameForMatching,
  streetNamesMatch,
} from "./street-aggregation.service.js";
import {
  generateRadiusCacheKey,
  getCachedGeometries,
  setCachedGeometries,
} from "./geometry-cache.service.js";
import { STREET_MATCHING } from "../config/constants.js";
import prisma from "../lib/prisma.js";
import type { GpxPoint, OsmStreet, MatchedStreet } from "../types/run.types.js";
import type { StreetSnapshot, SnapshotStreet } from "../types/project.types.js";
import type { ActivityImpact } from "../types/activity.types.js";

// ============================================
// Type Definitions
// ============================================

/**
 * Result of processing a single project
 *
 * Contains details about which streets were affected and how.
 */
export interface ProjectProcessingResult {
  /** Project ID */
  projectId: string;
  /** Project name (for logging) */
  projectName: string;
  /** Number of GPS points that fell within the project */
  pointsInProject: number;
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
  /** Total projects that were affected */
  projectsProcessed: number;
  /** Details for each project */
  projects: ProjectProcessingResult[];
  /** Total time taken in milliseconds */
  processingTimeMs: number;
  /** Error message if failed */
  error?: string;
  /** When no projects overlap: streets updated for map (standalone processing) */
  standaloneStreetsCovered?: number;
  /** When no projects overlap: streets completed (>= 90%) in standalone processing */
  standaloneStreetsCompleted?: number;
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
// Helper Functions
// ============================================

/**
 * Calculate bounding box from activity GPS coordinates.
 * Used for standalone activity processing (no routes) to query streets in area.
 *
 * @param coordinates - Activity GPS points
 * @returns Bounding box { south, west, north, east } with small buffer for edge matching
 */
function calculateActivityBoundingBox(coordinates: GpxPoint[]): {
  south: number;
  west: number;
  north: number;
  east: number;
} {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const pt of coordinates) {
    if (pt.lat < minLat) minLat = pt.lat;
    if (pt.lat > maxLat) maxLat = pt.lat;
    if (pt.lng < minLng) minLng = pt.lng;
    if (pt.lng > maxLng) maxLng = pt.lng;
  }
  // ~50m buffer for edge matching
  const buffer = 0.0005;
  return {
    south: minLat - buffer,
    west: minLng - buffer,
    north: maxLat + buffer,
    east: maxLng + buffer,
  };
}

/**
 * Process an activity when the user has no overlapping routes.
 * Queries streets in the activity's bounding box, matches GPS points to streets,
 * and updates UserStreetProgress (v1) and/or UserEdge (v2) per ENGINE.VERSION.
 *
 * @param activityId - Internal activity ID (for logging)
 * @param userId - User ID
 * @param coordinates - Activity GPS points
 * @param startDate - Activity start date (for v2 runDate)
 * @returns Count of streets covered and completed (from v1 when applicable)
 */
async function processStandaloneActivity(
  activityId: string,
  userId: string,
  coordinates: GpxPoint[],
  startDate: Date | null
): Promise<{ streetsCovered: number; streetsCompleted: number }> {
  let streetsCovered = 0;
  let streetsCompleted = 0;

  if (ENGINE.VERSION === "v1" || ENGINE.VERSION === "both") {
    const bbox = calculateActivityBoundingBox(coordinates);
    const geometries = await queryStreetsInBoundingBox(bbox);

    if (geometries.length === 0) {
      console.log(
        `[Processor] Standalone: no streets in bbox for activity ${activityId}`
      );
    } else {
      const matchedStreets = await matchPointsToStreetsHybrid(
        coordinates,
        geometries
      );

      if (matchedStreets.length === 0) {
        console.log(
          `[Processor] Standalone: no street matches for activity ${activityId}`
        );
      } else {
        const filteredStreets = matchedStreets.filter((m) => {
          const ratio = m.geometryCoverageRatio ?? m.coverageRatio;
          const percentage = ratio * 100;
          return (
            m.matchedPointsCount >= STREET_MATCHING.MIN_POINTS_PER_STREET &&
            percentage >= STREET_MATCHING.MIN_COVERAGE_PERCENTAGE
          );
        });

        if (filteredStreets.length === 0) {
          console.log(
            `[Processor] Standalone: no streets passed filter for activity ${activityId}`
          );
        } else {
          const namedStreets = filteredStreets.filter(
            (m) => !isUnnamedStreet(m.name)
          );

          if (namedStreets.length === 0) {
            console.log(
              `[Processor] Standalone: no named streets for activity ${activityId}`
            );
          } else {
            console.log(
              `[Processor] Standalone: matched ${matchedStreets.length} streets, ${namedStreets.length} named for activity ${activityId}`
            );

            const streetProgressInput = namedStreets.map((m) => {
              const ratio = m.geometryCoverageRatio ?? m.coverageRatio;
              const percentage = Math.min(100, Math.round(ratio * 100));
              const threshold = getCompletionThreshold(m.lengthMeters);
              const isComplete = ratio >= threshold;
              const coverageInterval: CoverageInterval | undefined =
                m.coverageInterval ??
                (percentage > 0 ? [0, percentage] : undefined);

              return {
                osmId: m.osmId,
                name: m.name,
                highwayType: m.highwayType,
                lengthMeters: m.lengthMeters,
                percentage,
                isComplete,
                coverageInterval,
              };
            });

            await upsertStreetProgress(userId, streetProgressInput);
            streetsCovered = streetProgressInput.length;
            streetsCompleted = streetProgressInput.filter(
              (s) => s.isComplete
            ).length;
          }
        }
      }
    }
  }

  if (ENGINE.VERSION === "v2" || ENGINE.VERSION === "both") {
    try {
      const runDate = startDate ?? new Date();
      const result = await processActivityV2(userId, coordinates, runDate);
      console.log(
        `[Processor] Standalone v2: ${result.edgesValid} edges persisted for activity ${activityId}`
      );
    } catch (v2Error) {
      console.warn(
        `[Processor] V2 pipeline failed for activity ${activityId}:`,
        v2Error instanceof Error ? v2Error.message : v2Error
      );
    }
  }

  return { streetsCovered, streetsCompleted };
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
  const projectResults: ProjectProcessingResult[] = [];

  try {
    // Step 1: Get activity coordinates and start date
    console.log(`[Processor] Starting processing for activity ${activityId}`);
    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
      select: { coordinates: true, startDate: true },
    });
    if (!activity) {
      throw new ActivityNotFoundError(activityId);
    }
    const coordinates = activity.coordinates as GpxPoint[];

    if (coordinates.length === 0) {
      console.log(`[Processor] Activity ${activityId} has no coordinates`);
      await markActivityProcessed(activityId);
      return {
        activityId,
        success: true,
        projectsProcessed: 0,
        projects: [],
        processingTimeMs: Date.now() - startTime,
      };
    }

    console.log(`[Processor] Activity has ${coordinates.length} GPS points`);

    // Step 2: Detect overlapping projects (only those created at or before activity start, date and time)
    const overlappingProjects = await detectOverlappingProjects(
      userId,
      coordinates,
      { activityStartDate: activity.startDate }
    );
    console.log(
      `[Processor] Found ${overlappingProjects.length} overlapping projects`
    );

    if (overlappingProjects.length === 0) {
      // No projects: still process for user-level street progress (map feature)
      const standalone = await processStandaloneActivity(
        activityId,
        userId,
        coordinates,
        activity.startDate
      );
      await markActivityProcessed(activityId);
      return {
        activityId,
        success: true,
        projectsProcessed: 0,
        projects: [],
        standaloneStreetsCovered: standalone.streetsCovered,
        standaloneStreetsCompleted: standalone.streetsCompleted,
        processingTimeMs: Date.now() - startTime,
      };
    }

    // Step 3: Process each overlapping project
    for (const overlap of overlappingProjects) {
      try {
        const result = await processProjectOverlap(
          activityId,
          userId,
          overlap,
          coordinates,
          activity.startDate
        );
        projectResults.push(result);
      } catch (error) {
        // Log error but continue processing other projects
        console.error(
          `[Processor] Error processing project ${overlap.project.id}:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    // Step 4: Mark activity as processed
    await markActivityProcessed(activityId);

    const processingTimeMs = Date.now() - startTime;
    console.log(
      `[Processor] Completed processing activity ${activityId} in ${processingTimeMs}ms. ` +
        `Projects: ${
          projectResults.length
        }, Total completed: ${projectResults.reduce(
          (sum, r) => sum + r.streetsCompleted,
          0
        )}`
    );

    return {
      activityId,
      success: true,
      projectsProcessed: projectResults.length,
      projects: projectResults,
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
      projectsProcessed: 0,
      projects: [],
      processingTimeMs: Date.now() - startTime,
      error: errorMessage,
    };
  }
}

/**
 * Re-check an already-processed activity for newly created projects.
 * Used when the user clicks Sync and an activity was processed before some
 * projects existed. Only projects with createdAt <= activity.startDate (date and time)
 * are considered, so "create project then run" still updates on next sync.
 *
 * @param activityId - Internal activity ID
 * @param userId - User ID
 * @returns Number of projects that were updated
 */
export async function recheckActivityForNewProjects(
  activityId: string,
  userId: string
): Promise<number> {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: { coordinates: true, startDate: true },
  });
  if (!activity || !activity.coordinates?.length) {
    return 0;
  }
  const coordinates = activity.coordinates as GpxPoint[];

  const overlappingProjects = await detectOverlappingProjects(
    userId,
    coordinates,
    { activityStartDate: activity.startDate }
  );
  if (overlappingProjects.length === 0) return 0;

  let updated = 0;
  for (const overlap of overlappingProjects) {
    const existing = await prisma.projectActivity.findUnique({
      where: {
        projectId_activityId: {
          projectId: overlap.project.id,
          activityId,
        },
      },
    });
    if (existing) continue;

    try {
      await processProjectOverlap(activityId, userId, overlap, coordinates);
      updated++;
    } catch (error) {
      console.error(
        `[Processor] Recheck: error processing project ${overlap.project.id}:`,
        error instanceof Error ? error.message : error
      );
    }
  }
  return updated;
}

// ============================================
// Project Processing
// ============================================

/**
 * Process a single project overlap
 *
 * When ENGINE.VERSION is v1: Gets snapshot, queries geometries, matches GPS to streets,
 * calculates coverage, updates project progress and UserStreetProgress, saves ProjectActivity.
 *
 * When ENGINE.VERSION is v2: Runs processActivityV2 first (persist UserEdge), then
 * deriveProjectProgressV2 to get percentages from UserEdge + WayTotalEdges; updates
 * project progress and UserStreetProgress from that; saves ProjectActivity. No Overpass/Mapbox.
 *
 * When ENGINE.VERSION is both: Same as v1, then also runs processActivityV2 for UserEdge.
 */
async function processProjectOverlap(
  activityId: string,
  userId: string,
  overlap: OverlapResult,
  coordinates: GpxPoint[],
  startDate: Date | null
): Promise<ProjectProcessingResult> {
  const { project } = overlap;
  console.log(
    `[Processor] Processing project "${project.name}" (${project.id})`
  );

  // Step 1: Get the project's current snapshot
  const projectData = await prisma.project.findUnique({
    where: { id: project.id },
    select: {
      streetsSnapshot: true,
      centerLat: true,
      centerLng: true,
      radiusMeters: true,
    },
  });

  if (!projectData) {
    throw new Error(`Project ${project.id} not found`);
  }

  const snapshot = projectData.streetsSnapshot as StreetSnapshot;
  const snapshotByOsmId = new Map(snapshot.streets.map((s) => [s.osmId, s]));

  // When ENGINE.VERSION is v2, use V2 pipeline only: persist edges then derive progress from UserEdge + WayTotalEdges.
  if (ENGINE.VERSION === "v2") {
    const runDate = startDate ?? new Date();
    await processActivityV2(userId, coordinates, runDate);

    const v2Results = await deriveProjectProgressV2(userId, snapshot.streets);
    const streetUpdates = v2Results.map((r) => ({
      osmId: r.osmId,
      percentage: r.percentage,
      lastRunDate: new Date().toISOString(),
    }));

    if (streetUpdates.length > 0) {
      await updateProjectProgress(project.id, streetUpdates);
      console.log(
        `[Processor] Updated ${streetUpdates.length} streets in project "${project.name}" (V2)`
      );
    }

    const completed: string[] = [];
    const improved: Array<{ osmId: string; from: number; to: number }> = [];
    for (const r of v2Results) {
      const old = snapshotByOsmId.get(r.osmId);
      if (r.isComplete && old && !old.completed) completed.push(r.osmId);
      if (old && r.percentage > old.percentage)
        improved.push({
          osmId: r.osmId,
          from: old.percentage,
          to: r.percentage,
        });
    }
    const impact: ActivityImpact = { completed, improved };

    const streetProgressInput = v2Results
      .map((r) => {
        const snap = snapshotByOsmId.get(r.osmId);
        if (!snap) return null;
        return {
          osmId: r.osmId,
          name: snap.name,
          highwayType: snap.highwayType,
          lengthMeters: snap.lengthMeters,
          percentage: r.percentage,
          isComplete: r.isComplete,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (streetProgressInput.length > 0)
      await upsertStreetProgress(userId, streetProgressInput);

    await saveProjectActivity(project.id, activityId, impact);

    return {
      projectId: project.id,
      projectName: project.name,
      pointsInProject: overlap.pointsInsideCount,
      streetsCovered: impact.improved.length,
      streetsCompleted: impact.completed.length,
      streetsImproved: impact.improved.length,
      impact,
    };
  }

  // V1 or both: use V1 matching (geometries, match, aggregate, calculate impact)
  // Step 2: Get street geometries (for matching)
  const geometries = await getStreetGeometries(
    projectData.centerLat,
    projectData.centerLng,
    projectData.radiusMeters
  );

  // Step 3: Match GPS points to streets
  const matchedStreets = await matchPointsToStreetsHybrid(
    coordinates,
    geometries
  );
  console.log(
    `[Processor] Matched ${matchedStreets.length} streets for project "${project.name}"`
  );

  // Step 4: Aggregate matched streets (combine segments)
  const aggregated = aggregateSegmentsIntoLogicalStreets(matchedStreets);

  // Step 5: Calculate coverage and impact
  const { coverages, impact } = calculateRouteImpact(
    snapshot,
    aggregated.streets,
    matchedStreets
  );

  // Step 6: Update project progress
  if (coverages.length > 0) {
    const streetUpdates = coverages.map((c) => ({
      osmId: c.osmId,
      percentage: c.percentage,
      lastRunDate: new Date().toISOString(),
    }));

    await updateProjectProgress(project.id, streetUpdates);
    console.log(
      `[Processor] Updated ${streetUpdates.length} streets in project "${project.name}"`
    );

    // Step 6b: Update user-level street progress (for map feature)
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

  // Step 7: Save project-activity relationship
  await saveProjectActivity(project.id, activityId, impact);

  if (ENGINE.VERSION === "both") {
    try {
      const runDate = startDate ?? new Date();
      await processActivityV2(userId, coordinates, runDate);
    } catch (v2Error) {
      console.warn(
        `[Processor] V2 pipeline failed for activity ${activityId} (project ${project.name}):`,
        v2Error instanceof Error ? v2Error.message : v2Error
      );
    }
  }

  return {
    projectId: project.id,
    projectName: project.name,
    pointsInProject: overlap.pointsInsideCount,
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

  // Map: normalizedName -> MatchedStreet[] (for grouping segments by name)
  const rawByName = groupRawMatchesByName(rawMatchedStreets);

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
      rawByName,
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

    // Use length-based threshold for completion determination
    const threshold = getCompletionThreshold(snapshotStreet.lengthMeters);
    const thresholdPercentage = Math.round(threshold * 100);

    // Only update if coverage increased (MAX rule)
    if (newPercentage > oldPercentage) {
      coverages.push({
        osmId: snapshotStreet.osmId,
        percentage: newPercentage,
        isComplete: newPercentage >= thresholdPercentage,
      });

      // Track improvements
      improved.push({
        osmId: snapshotStreet.osmId,
        from: oldPercentage,
        to: newPercentage,
      });

      // Track completions (newly completed)
      if (
        newPercentage >= thresholdPercentage &&
        oldPercentage < thresholdPercentage
      ) {
        completed.push(snapshotStreet.osmId);
      }
    } else if (
      newPercentage >= thresholdPercentage &&
      oldPercentage >= thresholdPercentage
    ) {
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
 * Group raw matched streets by normalized name
 *
 * Used to aggregate multiple OSM segments (ways) that share the same street name.
 *
 * @param rawMatchedStreets - Array of matched streets
 * @returns Map of normalized name -> MatchedStreet[]
 */
function groupRawMatchesByName(
  rawMatchedStreets: MatchedStreet[]
): Map<string, MatchedStreet[]> {
  const grouped = new Map<string, MatchedStreet[]>();

  for (const street of rawMatchedStreets) {
    const normalized = normalizeStreetNameForMatching(street.name);
    if (!grouped.has(normalized)) {
      grouped.set(normalized, []);
    }
    grouped.get(normalized)!.push(street);
  }

  return grouped;
}

/**
 * Find matching coverage from activity for a snapshot street
 *
 * Tries multiple matching strategies:
 * 1. Direct OSM ID match in raw matched streets (most accurate)
 * 2. Normalized name match in aggregated streets
 * 3. Grouped name match: find all raw segments with same name, calculate weighted coverage
 * 4. Fuzzy name match against all matched streets
 *
 * @param snapshotStreet - Street from route snapshot
 * @param rawByOsmId - Map of OSM ID -> MatchedStreet
 * @param rawByName - Map of normalized name -> MatchedStreet[] (for segment aggregation)
 * @param aggregatedByName - Map of normalized name -> aggregated street
 * @param rawMatchedStreets - All raw matched streets (for fuzzy matching)
 * @returns Coverage ratio or null if not covered
 */
function findMatchingCoverage(
  snapshotStreet: SnapshotStreet,
  rawByOsmId: Map<string, MatchedStreet>,
  rawByName: Map<string, MatchedStreet[]>,
  aggregatedByName: Map<
    string,
    { coverageRatio: number; segmentOsmIds: string[] }
  >,
  rawMatchedStreets: MatchedStreet[]
): { ratio: number } | null {
  // Strategy 1: Direct OSM ID match (most accurate)
  const rawMatch = rawByOsmId.get(snapshotStreet.osmId);
  if (rawMatch) {
    // Use geometry coverage if available (more accurate)
    const ratio = rawMatch.geometryCoverageRatio ?? rawMatch.coverageRatio;
    return { ratio };
  }

  // Strategy 2: Normalized name match in aggregated streets
  const normalizedName = normalizeStreetNameForMatching(snapshotStreet.name);
  const aggregatedMatch = aggregatedByName.get(normalizedName);
  if (aggregatedMatch) {
    return { ratio: aggregatedMatch.coverageRatio };
  }

  // Strategy 3: Grouped name match - find all raw segments with same name
  // This handles cases where Mapbox matched different OSM segments than the snapshot
  const nameMatches = rawByName.get(normalizedName);
  if (nameMatches && nameMatches.length > 0) {
    // Calculate length-weighted average coverage across all segments
    const totalLength = nameMatches.reduce((sum, s) => sum + s.lengthMeters, 0);
    if (totalLength > 0) {
      const weightedCoverage = nameMatches.reduce((sum, s) => {
        const ratio = s.geometryCoverageRatio ?? s.coverageRatio;
        return sum + ratio * s.lengthMeters;
      }, 0);
      const ratio = weightedCoverage / totalLength;
      console.log(
        `[Coverage] Name match for "${snapshotStreet.name}" (${
          nameMatches.length
        } segments): ${(ratio * 100).toFixed(1)}%`
      );
      return { ratio };
    }
  }

  // Strategy 4: Fuzzy name match
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
        projectsProcessed: 0,
        projects: [],
        processingTimeMs: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return results;
}

/**
 * Reprocess all activities for a specific project
 *
 * Called when a project is refreshed and we need to recalculate
 * progress based on all historical activities.
 *
 * @param projectId - Project ID to reprocess
 * @param userId - User ID (for verification)
 * @returns Number of activities reprocessed
 */
export async function reprocessProjectActivities(
  projectId: string,
  userId: string
): Promise<{ activitiesProcessed: number }> {
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
      startDate: "asc",
    },
  });

  console.log(
    `[Processor] Reprocessing ${activities.length} activities for project ${projectId}`
  );

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      centerLat: true,
      centerLng: true,
      radiusMeters: true,
      name: true,
    },
  });

  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  await resetProjectProgress(projectId);

  let processed = 0;

  for (const activity of activities) {
    const coordinates = activity.coordinates as GpxPoint[];

    if (!coordinates || coordinates.length === 0) {
      continue;
    }

    const overlaps = checkActivityOverlapsProject(
      coordinates,
      project.centerLat,
      project.centerLng,
      project.radiusMeters
    );

    if (overlaps) {
      const mockOverlap: OverlapResult = {
        project: {
          id: projectId,
          name: project.name,
          centerLat: project.centerLat,
          centerLng: project.centerLng,
          radiusMeters: project.radiusMeters,
        },
        samplePointsInside: [],
        pointsInsideCount: 1,
      };

      try {
        await processProjectOverlap(
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
    `[Processor] Reprocessed ${processed} activities for project "${project.name}"`
  );

  return { activitiesProcessed: processed };
}

/**
 * Reset project progress to 0 for all streets
 *
 * Used before reprocessing all activities for a project.
 */
async function resetProjectProgress(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { streetsSnapshot: true },
  });

  if (!project) return;

  const snapshot = project.streetsSnapshot as StreetSnapshot;

  for (const street of snapshot.streets) {
    street.completed = false;
    street.percentage = 0;
    street.lastRunDate = null;
  }

  await prisma.project.update({
    where: { id: projectId },
    data: {
      streetsSnapshot: snapshot as object,
      completedStreets: 0,
      progress: 0,
    },
  });

  await prisma.projectActivity.deleteMany({
    where: { projectId },
  });
}

/**
 * Quick check if an activity overlaps with a project
 *
 * Simplified version of overlap detection for reprocessing.
 */
function checkActivityOverlapsProject(
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
