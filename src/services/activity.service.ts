/**
 * Activity Service
 * Handles activity storage, retrieval, and management
 *
 * Activities represent user runs/walks synced from Strava.
 * This service handles:
 * - Saving activities from Strava webhook
 * - Retrieving activity lists and details
 * - Managing activity-route relationships (impact tracking)
 * - Activity deletion with route recalculation
 *
 * Note: Activity PROCESSING (matching to routes) is handled by
 * activity-processor.service.ts, not this service.
 *
 * @example
 * // Save activity from Strava
 * const activity = await saveActivity(userId, stravaActivity, coordinates);
 *
 * // List user's activities
 * const activities = await listActivities(userId, { page: 1, pageSize: 20 });
 */

import prisma from "../lib/prisma.js";
import { ACTIVITIES } from "../config/constants.js";
import type { GpxPoint } from "../types/run.types.js";
import type {
  StravaActivity,
  ActivityListItem,
  ActivityDetail,
  ActivityImpact,
  ProjectActivityItem,
} from "../types/activity.types.js";

// ============================================
// Activity Creation
// ============================================

/**
 * Save a new activity from Strava
 *
 * Creates an activity record with GPS coordinates.
 * Called by webhook handler after fetching activity data from Strava.
 *
 * @param userId - Internal user ID
 * @param stravaActivity - Activity data from Strava API
 * @param coordinates - GPS coordinates from Strava streams
 * @returns Created activity record
 * @throws Error if activity already exists (duplicate stravaId)
 *
 * @example
 * const activity = await saveActivity(
 *   "user-123",
 *   stravaActivityData,
 *   gpsCoordinates
 * );
 */
export async function saveActivity(
  userId: string,
  stravaActivity: StravaActivity,
  coordinates: GpxPoint[]
): Promise<{ id: string; stravaId: string; name: string }> {
  // Check if activity already exists
  const existing = await prisma.activity.findUnique({
    where: { stravaId: String(stravaActivity.id) },
  });

  if (existing) {
    throw new ActivityAlreadyExistsError(String(stravaActivity.id));
  }

  // Create activity
  const activity = await prisma.activity.create({
    data: {
      userId,
      stravaId: String(stravaActivity.id),
      name: stravaActivity.name,
      distanceMeters: stravaActivity.distance,
      durationSeconds: stravaActivity.moving_time,
      startDate: new Date(stravaActivity.start_date),
      activityType: stravaActivity.type,
      coordinates: coordinates as unknown as object,
      isProcessed: false,
    },
  });

  console.log(
    `[Activity] Saved activity "${stravaActivity.name}" (${stravaActivity.id}) for user ${userId}`
  );

  return {
    id: activity.id,
    stravaId: activity.stravaId,
    name: activity.name,
  };
}

/**
 * Check if activity type is supported for processing
 *
 * @param activityType - Strava activity type (e.g., "Run", "Ride")
 * @returns True if activity should be processed
 */
export function isSupportedActivityType(activityType: string): boolean {
  return ACTIVITIES.ALLOWED_TYPES.includes(
    activityType as (typeof ACTIVITIES.ALLOWED_TYPES)[number]
  );
}

/**
 * Check if activity is too old to process
 *
 * @param startDate - Activity start date
 * @returns True if activity is too old
 */
export function isActivityTooOld(startDate: Date): boolean {
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  return diffDays > ACTIVITIES.MAX_AGE_DAYS;
}

// ============================================
// Activity Reading
// ============================================

/**
 * Get activity by ID
 *
 * @param activityId - Activity ID
 * @param userId - User ID (for authorization)
 * @returns Activity with coordinates and project impacts
 * @throws ActivityNotFoundError if not found or access denied
 */
export async function getActivityById(
  activityId: string,
  userId: string
): Promise<ActivityDetail> {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: {
      projects: {
        include: {
          project: {
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  if (!activity) {
    throw new ActivityNotFoundError(activityId);
  }

  if (activity.userId !== userId) {
    throw new ActivityNotFoundError(activityId); // Don't reveal existence
  }

  // Map project impacts
  const projectImpacts = activity.projects.map((ra) => ({
    projectId: ra.project.id,
    projectName: ra.project.name,
    streetsCompleted: ra.streetsCompleted,
    streetsImproved: ra.streetsImproved,
    impactDetails: ra.impactDetails as ActivityImpact | null,
  }));

  return {
    id: activity.id,
    stravaId: activity.stravaId,
    name: activity.name,
    distanceMeters: activity.distanceMeters,
    durationSeconds: activity.durationSeconds,
    startDate: activity.startDate.toISOString(),
    activityType: activity.activityType,
    isProcessed: activity.isProcessed,
    createdAt: activity.createdAt.toISOString(),
    coordinates: activity.coordinates as GpxPoint[],
    processedAt: activity.processedAt?.toISOString() ?? null,
    projectImpacts,
    projectsAffected: projectImpacts.length,
    streetsCompleted: projectImpacts.reduce(
      (sum, r) => sum + r.streetsCompleted,
      0
    ),
    streetsImproved: projectImpacts.reduce(
      (sum, r) => sum + r.streetsImproved,
      0
    ),
  };
}

/**
 * List activities for a user
 *
 * Returns paginated list of activities with summary info.
 * Most recent activities first.
 *
 * @param userId - User ID
 * @param options - Pagination options
 * @returns Paginated activity list
 */
export async function listActivities(
  userId: string,
  options: { page?: number; pageSize?: number } = {}
): Promise<{
  activities: ActivityListItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 20;
  const skip = (page - 1) * pageSize;

  const [activities, total] = await Promise.all([
    prisma.activity.findMany({
      where: { userId },
      orderBy: { startDate: "desc" },
      skip,
      take: pageSize,
      include: {
        projects: {
          select: {
            streetsCompleted: true,
            streetsImproved: true,
          },
        },
      },
    }),
    prisma.activity.count({ where: { userId } }),
  ]);

  const activityList: ActivityListItem[] = activities.map((a) => ({
    id: a.id,
    stravaId: a.stravaId,
    name: a.name,
    distanceMeters: a.distanceMeters,
    durationSeconds: a.durationSeconds,
    startDate: a.startDate.toISOString(),
    activityType: a.activityType,
    isProcessed: a.isProcessed,
    createdAt: a.createdAt.toISOString(),
    projectsAffected: a.projects.length,
    streetsCompleted: a.projects.reduce(
      (sum, r) => sum + r.streetsCompleted,
      0
    ),
    streetsImproved: a.projects.reduce((sum, r) => sum + r.streetsImproved, 0),
  }));

  return { activities: activityList, total, page, pageSize };
}

/**
 * List activities that affected a specific project
 *
 * @param projectId - Project ID
 * @param userId - User ID (for authorization)
 * @returns List of activities with their impact on this project
 */
export async function listActivitiesForProject(
  projectId: string,
  userId: string
): Promise<ProjectActivityItem[]> {
  // Verify project exists and user has access
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project || project.userId !== userId) {
    throw new Error("Project not found or access denied");
  }

  // Get project activities
  const projectActivities = await prisma.projectActivity.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: {
      activity: {
        select: {
          id: true,
          name: true,
          startDate: true,
          distanceMeters: true,
          durationSeconds: true,
        },
      },
    },
  });

  return projectActivities.map((ra) => ({
    id: ra.id,
    activityId: ra.activity.id,
    activityName: ra.activity.name,
    date: ra.activity.startDate.toISOString(),
    distanceMeters: ra.activity.distanceMeters,
    durationSeconds: ra.activity.durationSeconds,
    streetsCompleted: ra.streetsCompleted,
    streetsImproved: ra.streetsImproved,
    impactDetails: ra.impactDetails as ActivityImpact | null,
  }));
}

// ============================================
// Activity Processing Status
// ============================================

/**
 * Mark activity as processed
 *
 * Called after activity-processor completes.
 *
 * @param activityId - Activity ID
 */
export async function markActivityProcessed(activityId: string): Promise<void> {
  await prisma.activity.update({
    where: { id: activityId },
    data: {
      isProcessed: true,
      processedAt: new Date(),
    },
  });

  console.log(`[Activity] Marked activity ${activityId} as processed`);
}

/**
 * Save project-activity relationship with impact
 *
 * Records how an activity affected a project.
 * Called by activity-processor after matching.
 *
 * @param projectId - Project ID
 * @param activityId - Activity ID
 * @param impact - Impact details (streets completed/improved)
 */
export async function saveProjectActivity(
  projectId: string,
  activityId: string,
  impact: ActivityImpact
): Promise<void> {
  await prisma.projectActivity.upsert({
    where: {
      projectId_activityId: { projectId, activityId },
    },
    create: {
      projectId,
      activityId,
      streetsCompleted: impact.completed.length,
      streetsImproved: impact.improved.length,
      impactDetails: impact as unknown as object,
    },
    update: {
      streetsCompleted: impact.completed.length,
      streetsImproved: impact.improved.length,
      impactDetails: impact as unknown as object,
    },
  });

  console.log(
    `[Activity] Saved ProjectActivity: project=${projectId}, activity=${activityId}, ` +
      `completed=${impact.completed.length}, improved=${impact.improved.length}`
  );
}

// ============================================
// Activity Deletion
// ============================================

/**
 * Delete an activity
 *
 * Deletes activity and recalculates affected projects.
 * This is expensive because we need to replay all remaining activities.
 *
 * @param activityId - Activity ID
 * @param userId - User ID (for authorization)
 * @returns Number of projects that need recalculation
 */
export async function deleteActivity(
  activityId: string,
  userId: string
): Promise<{ projectsAffected: number }> {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: {
      projects: {
        select: { projectId: true },
      },
    },
  });

  if (!activity) {
    throw new ActivityNotFoundError(activityId);
  }

  if (activity.userId !== userId) {
    throw new ActivityNotFoundError(activityId);
  }

  const affectedProjectIds = activity.projects.map((r) => r.projectId);

  // Delete activity (cascades to ProjectActivity)
  await prisma.activity.delete({
    where: { id: activityId },
  });

  console.log(
    `[Activity] Deleted activity ${activityId}, affects ${affectedProjectIds.length} projects`
  );

  // Note: Project recalculation should be done by caller
  // This is a heavy operation that may need to be queued

  return { projectsAffected: affectedProjectIds.length };
}

/**
 * Get activity by Strava ID
 *
 * Used to check if activity already exists when processing webhook.
 *
 * @param stravaId - Strava activity ID
 * @returns Activity if exists, null otherwise
 */
export async function getActivityByStravaId(
  stravaId: string
): Promise<{ id: string; isProcessed: boolean } | null> {
  const activity = await prisma.activity.findUnique({
    where: { stravaId },
    select: { id: true, isProcessed: true },
  });

  return activity;
}

/**
 * Get coordinates for an activity
 *
 * Used by activity processor to get GPS data for matching.
 *
 * @param activityId - Activity ID
 * @returns GPS coordinates
 */
export async function getActivityCoordinates(
  activityId: string
): Promise<GpxPoint[]> {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: { coordinates: true },
  });

  if (!activity) {
    throw new ActivityNotFoundError(activityId);
  }

  return activity.coordinates as GpxPoint[];
}

// ============================================
// Custom Error Classes
// ============================================

/**
 * Error thrown when activity is not found
 */
export class ActivityNotFoundError extends Error {
  public activityId: string;

  constructor(activityId: string) {
    super(`Activity not found: ${activityId}`);
    this.name = "ActivityNotFoundError";
    this.activityId = activityId;
  }
}

/**
 * Error thrown when activity already exists
 */
export class ActivityAlreadyExistsError extends Error {
  public stravaId: string;

  constructor(stravaId: string) {
    super(`Activity already exists: ${stravaId}`);
    this.name = "ActivityAlreadyExistsError";
    this.stravaId = stravaId;
  }
}
