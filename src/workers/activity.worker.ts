/**
 * Activity Processing Worker
 * pg-boss worker that processes activity jobs from the queue
 * 
 * WORKER RESPONSIBILITIES:
 * ------------------------
 * This worker picks up jobs from the activity queue and:
 * 
 * 1. **Validates** the job data (user exists, activity not already processed)
 * 2. **Fetches** the full activity from Strava API (including GPS streams)
 * 3. **Saves** the activity to our database
 * 4. **Processes** the activity against user's routes (street matching)
 * 5. **Reports** results back to the queue (success/failure)
 * 
 * WORKER FLOW:
 * ------------
 * 
 * ```
 * Job picked up from queue
 *          │
 *          ▼
 * ┌──────────────────────┐
 * │ 1. Validate user &   │
 * │    check duplicate   │
 * └──────────────────────┘
 *          │
 *          ▼
 * ┌──────────────────────┐
 * │ 2. Refresh Strava    │  ← If token expired
 * │    access token      │
 * └──────────────────────┘
 *          │
 *          ▼
 * ┌──────────────────────┐
 * │ 3. Fetch activity    │  ← Strava API
 * │    + GPS streams     │
 * └──────────────────────┘
 *          │
 *          ▼
 * ┌──────────────────────┐
 * │ 4. Validate activity │  ← Type, age, distance
 * │    is processable    │
 * └──────────────────────┘
 *          │
 *          ▼
 * ┌──────────────────────┐
 * │ 5. Save activity     │  ← To our database
 * │    to database       │
 * └──────────────────────┘
 *          │
 *          ▼
 * ┌──────────────────────┐
 * │ 6. Process against   │  ← Activity processor
 * │    user's routes     │
 * └──────────────────────┘
 *          │
 *          ▼
 * [Return result to queue]
 * ```
 * 
 * ERROR HANDLING:
 * ---------------
 * - Temporary errors (API timeout): Job retries with backoff
 * - Permanent errors (activity deleted): Job marked as completed (skipped)
 * - Token errors: Attempts token refresh, retries if successful
 * 
 * CONCURRENCY:
 * ------------
 * Worker processes jobs one at a time for simplicity and rate limit compliance.
 * 
 * @example
 * // Start the worker (typically called during server startup)
 * import { startActivityWorker } from "./workers/activity.worker.js";
 * 
 * await startActivityWorker();
 * 
 * // On shutdown
 * await stopActivityWorker();
 */

import { ACTIVITIES } from "../config/constants.js";
import prisma from "../lib/prisma.js";
import {
  fetchActivity,
  fetchActivityStreams,
  streamsToGpxPoints,
  refreshAccessToken,
  isTokenExpired,
  StravaApiError,
} from "../services/strava.service.js";
import {
  saveActivity,
  isSupportedActivityType,
  isActivityTooOld,
  getActivityByStravaId,
} from "../services/activity.service.js";
import { processActivity } from "../services/activity-processor.service.js";
import { registerActivityWorker, type ActivityJob } from "../queues/activity.queue.js";
import type { ProcessActivityJob } from "../types/activity.types.js";

// ============================================
// Type Definitions
// ============================================

/**
 * Result returned by the worker job
 */
interface WorkerJobResult {
  /** Whether processing succeeded */
  success: boolean;
  /** Internal activity ID (if saved) */
  activityId?: string;
  /** Number of routes affected */
  routesProcessed?: number;
  /** Reason for skipping (if applicable) */
  skipReason?: string;
  /** Error message (if failed) */
  error?: string;
}

// ============================================
// Worker State
// ============================================

/**
 * Worker subscription ID (for cleanup)
 */
let workerId: string | undefined;

/**
 * Whether the worker is currently running
 */
let isRunning = false;

// ============================================
// Worker Lifecycle
// ============================================

/**
 * Start the activity processing worker
 * 
 * Registers the worker function with pg-boss.
 * pg-boss will then call our handler for each job in the queue.
 * 
 * Should be called once during server startup.
 * 
 * @returns True if worker started, false if already running or disabled
 * 
 * @example
 * // During server startup
 * await startActivityWorker();
 * 
 * // On shutdown
 * await stopActivityWorker();
 */
export async function startActivityWorker(): Promise<boolean> {
  if (isRunning) {
    console.log("[Worker] Activity worker already running");
    return false;
  }

  try {
    // Register our handler with pg-boss
    workerId = await registerActivityWorker(handleJobs);
    
    if (!workerId) {
      console.log("[Worker] Queue is disabled, worker not started");
      return false;
    }

    isRunning = true;
    console.log(`[Worker] Activity worker started (id: ${workerId})`);
    return true;

  } catch (error) {
    console.error("[Worker] Failed to start activity worker:", error);
    return false;
  }
}

/**
 * Stop the activity processing worker
 * 
 * Gracefully stops accepting new jobs.
 * Active jobs will complete before the worker fully stops.
 */
export async function stopActivityWorker(): Promise<void> {
  if (!isRunning) {
    console.log("[Worker] Worker is not running");
    return;
  }

  // pg-boss handles cleanup when the queue is stopped
  // The workerId subscription is automatically cleaned up
  isRunning = false;
  workerId = undefined;
  console.log("[Worker] Activity worker stopped");
}

/**
 * Check if the worker is currently running
 */
export function isWorkerRunning(): boolean {
  return isRunning;
}

// ============================================
// Job Handler
// ============================================

/**
 * Handle a batch of activity processing jobs
 * 
 * This is the main job processor function that pg-boss calls.
 * We process one job at a time (batchSize: 1), but the interface
 * requires handling an array.
 * 
 * @param jobs - Array of pg-boss jobs (typically just one)
 */
async function handleJobs(jobs: ActivityJob[]): Promise<void> {
  for (const job of jobs) {
    await handleSingleJob(job);
  }
}

/**
 * Handle a single activity processing job
 * 
 * The job is automatically marked as completed if the handler succeeds,
 * or failed (and potentially retried) if the handler throws.
 * 
 * @param job - pg-boss job containing activity data
 */
async function handleSingleJob(job: ActivityJob): Promise<void> {
  const { stravaActivityId, userId } = job.data;
  const jobId = job.id;

  console.log(
    `[Worker] Processing job ${jobId}: activity ${stravaActivityId} for user ${userId}`
  );

  try {
    const result = await processActivityJob(job.data);

    if (result.success) {
      if (result.skipReason) {
        console.log(
          `[Worker] Job ${jobId} completed (skipped: ${result.skipReason})`
        );
      } else {
        console.log(
          `[Worker] Job ${jobId} completed successfully` +
          (result.routesProcessed ? ` (${result.routesProcessed} routes)` : "")
        );
      }
      // pg-boss automatically marks the job as complete when handler succeeds
    } else {
      // Permanent failure - don't retry (we handle by returning, not throwing)
      console.error(`[Worker] Job ${jobId} permanently failed: ${result.error}`);
    }

  } catch (error) {
    // Retriable error - pg-boss will retry based on configuration
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Worker] Job ${jobId} failed (will retry): ${errorMessage}`);
    
    // Re-throw to trigger pg-boss retry mechanism
    throw error;
  }
}

/**
 * Process a single activity job
 * 
 * Contains the core business logic for processing an activity.
 * Separated from handleSingleJob for testability.
 * 
 * @param jobData - Activity job data
 * @returns Processing result
 */
async function processActivityJob(
  jobData: ProcessActivityJob
): Promise<WorkerJobResult> {
  const { stravaActivityId, userId } = jobData;

  // Step 1: Check if activity already exists (idempotency)
  const existing = await getActivityByStravaId(stravaActivityId);
  if (existing) {
    console.log(
      `[Worker] Activity ${stravaActivityId} already exists (id: ${existing.id})`
    );
    
    // If not processed yet, process it
    if (!existing.isProcessed) {
      const result = await processActivity(existing.id, userId);
      return {
        success: true,
        activityId: existing.id,
        routesProcessed: result.routesProcessed,
      };
    }

    return {
      success: true,
      activityId: existing.id,
      skipReason: "already_processed",
    };
  }

  // Step 2: Get user and verify Strava connection
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      stravaAccessToken: true,
      stravaRefreshToken: true,
      stravaTokenExpiresAt: true,
    },
  });

  if (!user) {
    return {
      success: false,
      error: `User ${userId} not found`,
    };
  }

  if (!user.stravaAccessToken || !user.stravaRefreshToken) {
    return {
      success: false,
      error: `User ${userId} has no Strava connection`,
    };
  }

  // Step 3: Refresh token if needed
  let accessToken = user.stravaAccessToken;

  if (user.stravaTokenExpiresAt && isTokenExpired(user.stravaTokenExpiresAt)) {
    console.log(`[Worker] Refreshing Strava token for user ${userId}`);
    
    try {
      const refreshed = await refreshAccessToken(user.stravaRefreshToken);
      accessToken = refreshed.access_token;

      // Update tokens in database
      await prisma.user.update({
        where: { id: userId },
        data: {
          stravaAccessToken: refreshed.access_token,
          stravaRefreshToken: refreshed.refresh_token,
          stravaTokenExpiresAt: new Date(refreshed.expires_at * 1000),
        },
      });
    } catch (error) {
      // Token refresh failed - throw to retry
      throw new Error(
        `Token refresh failed: ${error instanceof Error ? error.message : "Unknown"}`
      );
    }
  }

  // Step 4: Fetch activity from Strava
  console.log(`[Worker] Fetching activity ${stravaActivityId} from Strava`);
  
  let stravaActivity;
  try {
    stravaActivity = await fetchActivity(accessToken, stravaActivityId);
  } catch (error) {
    if (error instanceof StravaApiError) {
      if (error.code === "ACTIVITY_NOT_FOUND") {
        // Activity was deleted on Strava - permanent skip
        return {
          success: true,
          skipReason: "activity_deleted_on_strava",
        };
      }
      if (error.code === "TOKEN_INVALID") {
        // Token invalid - throw to retry (might need refresh)
        throw new Error("Strava token invalid after refresh");
      }
    }
    throw error;
  }

  // Step 5: Validate activity is processable
  // Check activity type (Run, Walk, Hike, Trail Run)
  if (!isSupportedActivityType(stravaActivity.type)) {
    return {
      success: true,
      skipReason: `unsupported_type:${stravaActivity.type}`,
    };
  }

  // Check activity age
  const startDate = new Date(stravaActivity.start_date);
  if (isActivityTooOld(startDate)) {
    return {
      success: true,
      skipReason: "activity_too_old",
    };
  }

  // Check minimum distance
  if (stravaActivity.distance < ACTIVITIES.MIN_DISTANCE_METERS) {
    return {
      success: true,
      skipReason: `too_short:${stravaActivity.distance}m`,
    };
  }

  // Step 6: Fetch GPS streams
  console.log(`[Worker] Fetching GPS streams for activity ${stravaActivityId}`);
  
  let streams;
  try {
    streams = await fetchActivityStreams(accessToken, stravaActivityId);
  } catch (error) {
    if (error instanceof StravaApiError && error.code === "STREAMS_NOT_FOUND") {
      // Activity has no GPS data (manual entry or privacy settings)
      return {
        success: true,
        skipReason: "no_gps_data",
      };
    }
    throw error;
  }

  // Convert streams to GPS points
  const coordinates = streamsToGpxPoints(streams, startDate);

  if (coordinates.length === 0) {
    return {
      success: true,
      skipReason: "empty_coordinates",
    };
  }

  console.log(`[Worker] Got ${coordinates.length} GPS points`);

  // Step 7: Save activity to database
  const saved = await saveActivity(userId, stravaActivity, coordinates);
  console.log(`[Worker] Saved activity ${saved.id}`);

  // Step 8: Process activity against routes
  const result = await processActivity(saved.id, userId);

  console.log(
    `[Worker] Completed processing activity ${stravaActivityId}: ` +
    `${result.routesProcessed} routes, ${result.routes.reduce((sum, r) => sum + r.streetsCompleted, 0)} streets completed`
  );

  return {
    success: true,
    activityId: saved.id,
    routesProcessed: result.routesProcessed,
  };
}

// ============================================
// Exports
// ============================================

export { isRunning as workerRunning };
