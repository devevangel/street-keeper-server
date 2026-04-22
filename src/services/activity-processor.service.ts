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
 * │    (PostGIS)        │    WayTotalEdges.geometry in local DB
 * └─────────────────────┘
 *        │
 *        ▼
 * ┌─────────────────────┐
 * │ 4. Match to Streets │  ← Which GPS points are on which streets?
 * │    (Mapbox + OSM)   │    Hybrid matching for best accuracy
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
 * 4. **PostGIS geometries**: Street lines come from synced city data (WayTotalEdges).
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
import { upsertStreetProgress } from "./user-street-progress.service.js";
import { processActivityV2 } from "../engines/v2/process-activity.js";
import { deriveProjectProgressV2Scoped } from "../engines/v2/street-completion.js";
import prisma from "../lib/prisma.js";
import type { GpxPoint } from "../types/run.types.js";
import type { StreetSnapshot } from "../types/project.types.js";
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
 * Process an activity when the user has no overlapping routes.
 * Persists node hits (V2) for map-level progress.
 */
async function processStandaloneActivity(
  activityId: string,
  userId: string,
  coordinates: GpxPoint[],
  startDate: Date | null
): Promise<{ streetsCovered: number; streetsCompleted: number; v2Failed: boolean }> {
  try {
    const runDate = startDate ?? new Date();
    const result = await processActivityV2(userId, coordinates, runDate);
    console.log(
      `[Processor] Standalone v2: ${result.nodesHit} nodes hit for activity ${activityId}`
    );
    return { streetsCovered: 0, streetsCompleted: 0, v2Failed: false };
  } catch (v2Error) {
    console.warn(
      `[Processor] V2 pipeline failed for activity ${activityId}:`,
      v2Error instanceof Error ? v2Error.message : v2Error
    );
    return { streetsCovered: 0, streetsCompleted: 0, v2Failed: true };
  }
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
    const coordinates = activity.coordinates as unknown as GpxPoint[];

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
      if (!standalone.v2Failed) {
        await markActivityProcessed(activityId);
      } else {
        console.warn(
          `[Processor] Leaving activity ${activityId} unprocessed — V2 failed (will retry on next sync)`
        );
      }
      return {
        activityId,
        success: !standalone.v2Failed,
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
        console.error(
          `[Processor] Error processing project ${overlap.project.id}:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    // Step 4: Only mark processed if at least one project succeeded.
    // If all projects failed (e.g. statement timeout), leave unprocessed for retry.
    if (projectResults.length > 0) {
      await markActivityProcessed(activityId);
    } else {
      console.warn(
        `[Processor] All ${overlappingProjects.length} projects failed for activity ${activityId} — leaving unprocessed`
      );
    }

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
  const coordinates = activity?.coordinates as unknown as GpxPoint[] | undefined;
  if (!activity || !coordinates?.length) {
    return 0;
  }

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
      await processProjectOverlap(
        activityId,
        userId,
        overlap,
        coordinates,
        activity.startDate,
      );
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
 * Process a single project overlap (V2): persist node hits, derive scoped progress,
 * update project and user-level street progress, save ProjectActivity.
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

  const projectData = await prisma.project.findUnique({
    where: { id: project.id },
    select: {
      streetsSnapshot: true,
      createdAt: true,
    },
  });

  if (!projectData) {
    throw new Error(`Project ${project.id} not found`);
  }

  const snapshot = projectData.streetsSnapshot as unknown as StreetSnapshot;
  const snapshotByOsmId = new Map(snapshot.streets.map((s) => [s.osmId, s]));

  const runDate = startDate ?? new Date();
  await processActivityV2(userId, coordinates, runDate);

  const v2Results = await deriveProjectProgressV2Scoped(
    userId,
    snapshot.streets,
    projectData.createdAt,
  );
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
      startDate: true,
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
    const coordinates = activity.coordinates as unknown as GpxPoint[];

    if (!coordinates || coordinates.length === 0) {
      continue;
    }

    if (
      project.centerLat == null ||
      project.centerLng == null ||
      project.radiusMeters == null
    ) {
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
          coordinates,
          activity.startDate
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

  const snapshot = project.streetsSnapshot as unknown as StreetSnapshot;

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
