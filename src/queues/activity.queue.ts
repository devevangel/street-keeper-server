/**
 * Activity Processing Queue
 * pg-boss queue for asynchronous activity processing
 * 
 * WHY pg-boss?
 * ------------
 * pg-boss uses PostgreSQL (which we already have via Prisma) for job storage.
 * This eliminates the need for Redis and simplifies local development.
 * 
 * WHY ASYNC PROCESSING?
 * ---------------------
 * When Strava sends a webhook notification about a new activity:
 * 1. We must respond within 2 seconds (Strava requirement)
 * 2. Processing an activity takes 5-30 seconds (Overpass, Mapbox, DB updates)
 * 
 * Solution: Queue the processing job and respond immediately.
 * The worker processes jobs in the background at its own pace.
 * 
 * JOB LIFECYCLE:
 * --------------
 * 
 * ```
 * Webhook Received
 *        │
 *        ▼
 * ┌─────────────────┐
 * │ Add job to queue│  ← Instant (~5ms)
 * └─────────────────┘
 *        │
 *        ▼
 * [Respond to Strava: 200 OK]  ← Must happen within 2s
 *        
 *        ... later (async) ...
 *        
 * ┌─────────────────┐
 * │ Worker picks up │  ← When ready
 * │ job from queue  │
 * └─────────────────┘
 *        │
 *        ▼
 * ┌─────────────────┐
 * │ Fetch activity  │  ← Strava API call
 * │ from Strava     │
 * └─────────────────┘
 *        │
 *        ▼
 * ┌─────────────────┐
 * │ Process against │  ← Street matching pipeline
 * │ user's routes   │
 * └─────────────────┘
 *        │
 *        ▼
 * [Job Complete]
 * ```
 * 
 * RELIABILITY FEATURES:
 * ---------------------
 * - Jobs persist in PostgreSQL (survive server restarts)
 * - Failed jobs retry with exponential backoff (3 attempts)
 * - Completed jobs auto-expire after 24 hours
 * - Job timeout prevents stuck jobs (2 minutes)
 * 
 * @example
 * // Add a job to process a new activity
 * await addActivityProcessingJob({
 *   stravaActivityId: "12345678",
 *   userId: "user-abc-123",
 *   ownerId: 67890, // Strava athlete ID
 * });
 */

import { PgBoss } from "pg-boss";
import { QUEUE } from "../config/constants.js";
import type { ProcessActivityJob } from "../types/activity.types.js";

// ============================================
// Type Definitions
// ============================================

/**
 * pg-boss job structure for activity processing
 */
export interface ActivityJob {
  id: string;
  name: string;
  data: ProcessActivityJob;
}

/**
 * Handler function type for processing activity jobs
 * pg-boss passes an array of jobs (we use batch size 1)
 */
export type ActivityJobHandler = (jobs: ActivityJob[]) => Promise<void>;

// ============================================
// Queue Instance (Singleton)
// ============================================

/**
 * pg-boss instance - manages job queues using PostgreSQL
 * 
 * Initialized lazily on first use to avoid connection errors at import time.
 * Uses the same DATABASE_URL as Prisma.
 */
let boss: PgBoss | null = null;
let bossStartPromise: Promise<PgBoss> | null = null;

/**
 * Check if queue functionality is enabled
 * 
 * Queue can be disabled by setting DISABLE_QUEUE=true in environment.
 * This allows running the server without queue processing for development.
 */
function isQueueEnabled(): boolean {
  return process.env.DISABLE_QUEUE !== "true";
}

/**
 * Get the database URL for pg-boss
 * 
 * Uses the same DATABASE_URL as Prisma.
 * pg-boss creates its own schema (pgboss) to store job data.
 */
function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return url;
}

/**
 * Initialize and start pg-boss
 * 
 * Creates the pg-boss instance if not already created.
 * Handles the async startup process.
 * 
 * @returns Promise resolving to the pg-boss instance
 */
async function getBoss(): Promise<PgBoss | null> {
  // If queue is disabled, return null
  if (!isQueueEnabled()) {
    return null;
  }

  // If already initialized, return the instance
  if (boss) {
    return boss;
  }

  // If initialization is in progress, wait for it
  if (bossStartPromise) {
    return bossStartPromise;
  }

  // Start initialization
  bossStartPromise = initializeBoss();
  return bossStartPromise;
}

/**
 * Initialize pg-boss with configuration
 * 
 * Creates tables in PostgreSQL (pgboss schema) on first run.
 * Subsequent runs reuse existing tables.
 */
async function initializeBoss(): Promise<PgBoss> {
  console.log("[Queue] Initializing pg-boss queue...");

  const newBoss = new PgBoss({
    connectionString: getDatabaseUrl(),
    // Schema name for pg-boss tables (keeps them separate from app tables)
    schema: "pgboss",
    // How often to check for new jobs (in seconds)
    monitorIntervalSeconds: 1,
    // Maintenance - clean up old jobs
    maintenanceIntervalSeconds: 60 * 5, // Every 5 minutes
  });

  // Handle errors
  newBoss.on("error", (error: Error) => {
    console.error("[Queue] pg-boss error:", error.message);
  });

  // Start the boss (creates tables if needed)
  await newBoss.start();
  
  boss = newBoss;
  console.log("[Queue] pg-boss queue initialized successfully");
  
  return newBoss;
}

// ============================================
// Queue Status Functions
// ============================================

/**
 * Check if the queue is available
 * 
 * Returns true if queue is enabled and initialized.
 * Does not trigger initialization - use for quick checks.
 */
export function isQueueAvailable(): boolean {
  if (!isQueueEnabled()) return false;
  return boss !== null;
}

/**
 * Get the queue error if initialization failed
 * (Currently not tracking errors - pg-boss handles retries internally)
 */
export function getQueueError(): Error | null {
  return null;
}

// ============================================
// Job Management Functions
// ============================================

/**
 * Queue name for activity processing jobs
 * 
 * All activity jobs go into this queue.
 * Workers subscribe to this queue to process jobs.
 */
const ACTIVITY_QUEUE_NAME = QUEUE.ACTIVITY_PROCESSING;

/**
 * Add an activity processing job to the queue
 * 
 * Called by webhook handler when Strava notifies us of a new activity.
 * The job will be picked up by the worker and processed asynchronously.
 * 
 * @param jobData - Activity processing job data
 * @param options - Optional job-specific options
 * @returns Job ID for tracking (or null if queue unavailable/duplicate)
 * 
 * @example
 * // From webhook handler
 * const jobId = await addActivityProcessingJob({
 *   stravaActivityId: "12345678",
 *   userId: "user-abc-123",
 *   ownerId: 67890,
 *   eventTime: Date.now(),
 * });
 * console.log(`Queued job: ${jobId}`);
 */
export async function addActivityProcessingJob(
  jobData: ProcessActivityJob,
  options?: {
    /** Priority (higher = more important). Default: 0 */
    priority?: number;
    /** Delay before processing in seconds */
    startAfter?: number;
    /** Custom singleton key (useful for deduplication) */
    singletonKey?: string;
  }
): Promise<string | null> {
  const bossInstance = await getBoss();

  if (!bossInstance) {
    console.warn("[Queue] Queue is disabled, job not queued");
    throw new QueueUnavailableError("Queue is disabled");
  }

  // Use singletonKey for deduplication - prevents duplicate jobs for same activity
  const jobId = await bossInstance.send(
    ACTIVITY_QUEUE_NAME,
    jobData,
    {
      priority: options?.priority ?? 0,
      startAfter: options?.startAfter,
      // Singleton key prevents duplicate jobs while one is active/pending
      singletonKey: options?.singletonKey ?? `activity-${jobData.stravaActivityId}`,
      // How long the job can run before being considered stalled
      expireInSeconds: QUEUE.JOB_TIMEOUT_MS / 1000,
      // Retry configuration
      retryLimit: QUEUE.RETRY.MAX_ATTEMPTS,
      retryDelay: QUEUE.RETRY.BACKOFF_DELAY_MS / 1000,
      retryBackoff: true, // Exponential backoff
    }
  );

  if (jobId) {
    console.log(
      `[Queue] Added activity processing job: ${jobId} (Strava: ${jobData.stravaActivityId})`
    );
  } else {
    // Job with same singletonKey already exists
    console.log(
      `[Queue] Job already queued for activity ${jobData.stravaActivityId}`
    );
  }

  return jobId;
}

/**
 * Check if a job for this activity already exists
 * 
 * Used to prevent duplicate processing when webhooks are retried.
 * 
 * @param stravaActivityId - Strava activity ID
 * @returns True if job exists and is not completed
 */
export async function isActivityJobQueued(
  stravaActivityId: string
): Promise<boolean> {
  const bossInstance = await getBoss();
  
  if (!bossInstance) {
    return false;
  }

  // pg-boss handles this via singletonKey - if we try to add a duplicate,
  // it returns null instead of a job ID. So this function is mainly for
  // explicit checks if needed.
  // 
  // For now, we'll rely on the singletonKey mechanism in addActivityProcessingJob
  // which automatically prevents duplicates.
  return false;
}

/**
 * Get queue statistics
 * 
 * Returns counts of jobs in various states.
 * Useful for monitoring and health checks.
 */
export async function getQueueStats(): Promise<{
  queued: number;
  active: number;
} | null> {
  const bossInstance = await getBoss();

  if (!bossInstance) {
    return null;
  }

  // pg-boss v10+ uses getQueues() to get queue information
  const queues = await bossInstance.getQueues();
  const activityQueue = queues.find(q => q.name === ACTIVITY_QUEUE_NAME);
  
  return {
    queued: activityQueue?.queuedCount ?? 0,
    active: activityQueue?.activeCount ?? 0,
  };
}

// ============================================
// Queue Lifecycle Functions
// ============================================

/**
 * Start the queue (initialize pg-boss)
 * 
 * Called during server startup.
 * Creates pg-boss tables in PostgreSQL if they don't exist.
 */
export async function startQueue(): Promise<void> {
  await getBoss();
}

/**
 * Stop the queue gracefully
 * 
 * Waits for active jobs to complete, then closes connections.
 * Call this during server shutdown.
 */
export async function closeQueue(): Promise<void> {
  if (boss) {
    await boss.stop();
    boss = null;
    bossStartPromise = null;
    console.log("[Queue] pg-boss queue stopped");
  }
}

// ============================================
// Worker Registration
// ============================================

/**
 * Register a worker function to process activity jobs
 * 
 * Called by the worker module to register its processing function.
 * pg-boss will call this function for each job in the queue.
 * 
 * @param handler - Async function to process each job batch
 * @returns Worker ID (for reference)
 */
export async function registerActivityWorker(
  handler: ActivityJobHandler
): Promise<string | undefined> {
  const bossInstance = await getBoss();

  if (!bossInstance) {
    console.warn("[Queue] Queue is disabled, worker not registered");
    return undefined;
  }

  // Subscribe to the activity queue
  // batchSize controls how many jobs we receive at once
  const workerId = await bossInstance.work<ProcessActivityJob>(
    ACTIVITY_QUEUE_NAME,
    {
      batchSize: 1, // Process one job at a time for simplicity
      pollingIntervalSeconds: 1, // Check for new jobs every second
    },
    // pg-boss calls our handler with an array of jobs
    async (jobs) => {
      for (const job of jobs) {
        await handler([{
          id: job.id,
          name: job.name,
          data: job.data,
        }]);
      }
    }
  );

  console.log(
    `[Queue] Activity worker registered (worker: ${workerId})`
  );

  return workerId;
}

/**
 * Complete a job successfully
 * 
 * Called by worker after successfully processing a job.
 * Note: pg-boss auto-completes jobs when the handler resolves without error.
 */
export async function completeJob(jobId: string): Promise<void> {
  const bossInstance = await getBoss();
  if (bossInstance) {
    await bossInstance.complete(ACTIVITY_QUEUE_NAME, jobId);
  }
}

/**
 * Fail a job (will be retried if attempts remain)
 * 
 * Called by worker when job processing fails.
 * Note: pg-boss auto-fails jobs when the handler throws an error.
 */
export async function failJob(jobId: string, error: Error): Promise<void> {
  const bossInstance = await getBoss();
  if (bossInstance) {
    await bossInstance.fail(ACTIVITY_QUEUE_NAME, jobId, { message: error.message });
  }
}

// ============================================
// Custom Error Class
// ============================================

/**
 * Error thrown when queue operations fail due to queue unavailability
 */
export class QueueUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueUnavailableError";
  }
}
