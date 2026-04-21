/**
 * Sync Service
 * Manual sync of Strava activities into Street Keeper
 *
 * Fetches recent activities from Strava API (list athlete activities),
 * then for each: ensures we have it in DB (fetch full + streams if new),
 * and runs the activity processor to update route/street progress.
 *
 * Used by POST /activities/sync when the user taps "Sync from Strava".
 */

import prisma from "../lib/prisma.js";
import { ACTIVITIES } from "../config/constants.js";
import {
  refreshAccessToken,
  isTokenExpired,
  listAthleteActivities,
  fetchActivity,
  fetchActivityStreams,
  streamsToGpxPoints,
  StravaApiError,
} from "./strava.service.js";
import {
  getActivityByStravaId,
  saveActivity,
  isSupportedActivityType,
  isActivityTooOld,
} from "./activity.service.js";
import {
  processActivity,
  recheckActivityForNewProjects,
} from "./activity-processor.service.js";
import { addSyncJob } from "../queues/activity.queue.js";

// ============================================
// Types
// ============================================

export interface SyncRecentOptions {
  /** Unix timestamp (seconds) - only activities after this time. Default: 30 days ago. */
  after?: number;
  /** Unix timestamp (seconds) - only activities before this time. */
  before?: number;
  /** Max activities to fetch per page (default 30, max 200). */
  perPage?: number;
}

export interface SyncRecentResult {
  /** Number of activities newly saved and processed. */
  synced: number;
  /** Number of activities that were already in DB and (if needed) processed. */
  processed: number;
  /** Number of activities skipped (unsupported type, too old, no GPS, etc.). */
  skipped: number;
  /** Per-activity errors (e.g. deleted on Strava, token error). */
  errors: Array<{ stravaId: string; reason: string }>;
}

// ============================================
// Sync Implementation
// ============================================

/**
 * Ensure the user has a valid Strava access token; refresh if expired.
 * Returns the access token and updates the DB if refreshed.
 */
async function getValidAccessToken(userId: string): Promise<string> {
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
    throw new SyncError("User not found", "USER_NOT_FOUND");
  }

  if (!user.stravaAccessToken || !user.stravaRefreshToken) {
    throw new SyncError("User has no Strava connection", "NO_STRAVA");
  }

  let accessToken = user.stravaAccessToken;

  if (user.stravaTokenExpiresAt && isTokenExpired(user.stravaTokenExpiresAt)) {
    const refreshed = await refreshAccessToken(user.stravaRefreshToken);
    accessToken = refreshed.access_token;
    await prisma.user.update({
      where: { id: userId },
      data: {
        stravaAccessToken: refreshed.access_token,
        stravaRefreshToken: refreshed.refresh_token,
        stravaTokenExpiresAt: new Date(refreshed.expires_at * 1000),
      },
    });
  }

  return accessToken;
}

/**
 * Process a single Strava activity: fetch if missing, save, then run processor.
 * Skips with a reason (unsupported type, too old, no GPS, etc.) are returned as skipped, not errors.
 */
async function processOneActivity(
  userId: string,
  stravaActivityId: string,
  accessToken: string
): Promise<
  | { status: "synced" }
  | { status: "processed" }
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string }
> {
  const stravaId = String(stravaActivityId);

  const existing = await getActivityByStravaId(stravaId);
  if (existing) {
    if (!existing.isProcessed) {
      console.log(`[Sync] Activity ${stravaId} exists in DB but unprocessed — processing now`);
      await processActivity(existing.id, userId);
      return { status: "processed" };
    }
    const newProjectsUpdated = await recheckActivityForNewProjects(
      existing.id,
      userId
    );
    if (newProjectsUpdated > 0) {
      return { status: "processed" };
    }
    return { status: "skipped", reason: "already_processed" };
  }

  let stravaActivity;
  try {
    stravaActivity = await fetchActivity(accessToken, stravaId);
  } catch (err) {
    if (err instanceof StravaApiError && err.code === "ACTIVITY_NOT_FOUND") {
      return { status: "skipped", reason: "activity_deleted_on_strava" };
    }
    if (err instanceof StravaApiError && err.code === "TOKEN_INVALID") {
      return { status: "error", reason: "Strava token invalid or expired" };
    }
    throw err;
  }

  if (!isSupportedActivityType(stravaActivity.type)) {
    return {
      status: "skipped",
      reason: `unsupported_type:${stravaActivity.type}`,
    };
  }

  const startDate = new Date(stravaActivity.start_date);
  if (isActivityTooOld(startDate)) {
    return { status: "skipped", reason: "activity_too_old" };
  }

  if (stravaActivity.distance < ACTIVITIES.MIN_DISTANCE_METERS) {
    return {
      status: "skipped",
      reason: `too_short:${stravaActivity.distance}m`,
    };
  }

  let streams;
  try {
    streams = await fetchActivityStreams(accessToken, stravaId);
  } catch (err) {
    if (err instanceof StravaApiError && err.code === "STREAMS_NOT_FOUND") {
      return { status: "skipped", reason: "no_gps_data" };
    }
    throw err;
  }

  const coordinates = streamsToGpxPoints(streams, startDate);
  if (coordinates.length === 0) {
    return { status: "skipped", reason: "empty_coordinates" };
  }

  const saved = await saveActivity(userId, stravaActivity, coordinates);
  await processActivity(saved.id, userId);
  return { status: "synced" };
}

/**
 * Sync recent Strava activities for a user.
 *
 * 1. Gets a valid Strava access token (refreshes if needed).
 * 2. Lists recent activities from Strava (default: last 30 days).
 * 3. For each activity: ensure it exists in DB (fetch + save if new), then process.
 *
 * @param userId - Internal user ID
 * @param options - Optional time window and page size
 * @returns Counts of synced, processed, skipped, and any errors
 */
export async function syncRecentActivities(
  userId: string,
  options?: SyncRecentOptions
): Promise<SyncRecentResult> {
  const syncStart = Date.now();
  console.log(`[Sync] Starting sync for user ${userId.slice(0, 8)}…`);

  let accessToken = await getValidAccessToken(userId);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const defaultAfter = nowSeconds - ACTIVITIES.MAX_AGE_DAYS * 24 * 60 * 60;
  const after = options?.after ?? defaultAfter;
  const before = options?.before;
  const perPage = Math.min(200, Math.max(1, options?.perPage ?? 30));

  console.log(
    `[Sync] Fetching from Strava: after=${new Date(after * 1000).toISOString()}, perPage=${perPage}`
  );

  let summaries;
  try {
    summaries = await listAthleteActivities(accessToken, {
      after,
      before,
      page: 1,
      perPage,
    });
  } catch (err) {
    if (err instanceof StravaApiError && err.code === "TOKEN_INVALID") {
      throw new SyncError("Strava token invalid or expired", "TOKEN_INVALID");
    }
    throw err;
  }

  console.log(`[Sync] Strava returned ${summaries.length} activities`);

  const result: SyncRecentResult = {
    synced: 0,
    processed: 0,
    skipped: 0,
    errors: [],
  };

  // Phase 1: Process activities returned by Strava
  for (let idx = 0; idx < summaries.length; idx++) {
    const summary = summaries[idx];
    const stravaId = String(summary.id);

    if (idx > 0 && idx % TOKEN_REFRESH_INTERVAL === 0) {
      try {
        accessToken = await getValidAccessToken(userId);
      } catch {
        // keep previous token
      }
    }

    try {
      const one = await processOneActivity(userId, stravaId, accessToken);
      console.log(`[Sync] Strava activity ${stravaId}: ${one.status}${"reason" in one ? ` (${one.reason})` : ""}`);
      switch (one.status) {
        case "synced":
          result.synced += 1;
          break;
        case "processed":
          result.processed += 1;
          break;
        case "skipped":
          result.skipped += 1;
          break;
        case "error":
          result.errors.push({ stravaId, reason: one.reason });
          break;
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      console.error(`[Sync] Error processing Strava activity ${stravaId}:`, reason);
      result.errors.push({ stravaId, reason });
    }
  }

  // Phase 2: Process any remaining unprocessed activities already in the DB.
  // This catches activities older than the Strava time window or beyond the page size
  // (e.g. after running reset:everything).
  const unprocessed = await prisma.activity.findMany({
    where: { userId, isProcessed: false },
    select: { id: true, stravaId: true, startDate: true },
    orderBy: { startDate: "asc" },
  });

  if (unprocessed.length > 0) {
    console.log(
      `[Sync] Found ${unprocessed.length} unprocessed activities in DB (not covered by Strava window). Processing…`
    );
  }

  for (const act of unprocessed) {
    try {
      await processActivity(act.id, userId);
      result.processed += 1;
      console.log(
        `[Sync] DB activity ${act.stravaId} (${act.startDate.toISOString().slice(0, 10)}): processed`
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      console.error(`[Sync] Error processing DB activity ${act.stravaId}:`, reason);
      result.errors.push({ stravaId: act.stravaId, reason });
    }
  }

  const elapsed = Date.now() - syncStart;
  console.log(
    `[Sync] Done in ${elapsed}ms — synced: ${result.synced}, processed: ${result.processed}, skipped: ${result.skipped}, errors: ${result.errors.length}`
  );

  return result;
}

// ============================================
// Background sync (pg-boss)
// ============================================

const INTER_ACTIVITY_DELAY_MS = 300;
const TOKEN_REFRESH_INTERVAL = 10;
/** Queued jobs older than this are considered stale (worker never picked up). */
const QUEUED_STALE_MS = 2 * 60 * 1000;

/**
 * Fetch all activity summaries from Strava with pagination (page size 200).
 * Loops until an empty page is returned.
 */
async function fetchAllActivitySummaries(
  accessToken: string,
  after?: number,
  before?: number
): Promise<Array<{ id: number }>> {
  const perPage = 200;
  const all: Array<{ id: number }> = [];
  let page = 1;

  for (;;) {
    const chunk = await listAthleteActivities(accessToken, {
      after,
      before,
      page,
      perPage,
    });
    if (chunk.length === 0) break;
    for (const a of chunk) all.push({ id: a.id });
    if (chunk.length < perPage) break;
    page += 1;
  }

  return all;
}

export interface StartBackgroundSyncResult {
  syncId: string;
  total: number;
  status: string;
}

/** Cooldown: no new sync if last completed sync was within this many hours.
 *  Override with env SYNC_COOLDOWN_HOURS=0 for local dev. */
const envCooldown = process.env.SYNC_COOLDOWN_HOURS;
const SYNC_COOLDOWN_MS =
  (envCooldown != null ? Number(envCooldown) : ACTIVITIES.SYNC_COOLDOWN_HOURS) *
  60 *
  60 *
  1000;

/**
 * Start a background sync: fetch activity list with pagination, create SyncJob, enqueue.
 * Returns immediately. Duplicate guard: if user already has queued/running job, returns that job.
 * Stale guard: queued jobs older than QUEUED_STALE_MS are marked failed and a new job is created.
 * Rate limit: only one successful sync per SYNC_COOLDOWN_HOURS (default 24); otherwise throws SYNC_RATE_LIMITED with nextSyncAt.
 */
export async function startBackgroundSync(
  userId: string,
  options?: { after?: number; before?: number }
): Promise<StartBackgroundSyncResult> {
  const lastCompleted = await prisma.syncJob.findFirst({
    where: { userId, status: "completed" },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true },
  });
  if (lastCompleted?.completedAt) {
    const nextSyncAt = new Date(
      lastCompleted.completedAt.getTime() + SYNC_COOLDOWN_MS
    );
    if (Date.now() < nextSyncAt.getTime()) {
      throw new SyncError(
        "Strava can only be synced once per day. Try again later.",
        "SYNC_RATE_LIMITED",
        nextSyncAt
      );
    }
  }

  const existing = await prisma.syncJob.findFirst({
    where: {
      userId,
      status: { in: ["queued", "running"] },
    },
    orderBy: { startedAt: "desc" },
  });

  if (existing) {
    const ageMs = Date.now() - existing.startedAt.getTime();
    if (
      existing.status === "queued" &&
      ageMs > QUEUED_STALE_MS
    ) {
      console.log(
        `[Sync] Stale queued job ${existing.id} (${Math.round(ageMs / 1000)}s old) — marking failed, creating new job`
      );
      await prisma.syncJob.update({
        where: { id: existing.id },
        data: {
          status: "failed",
          lastErrorMessage: "Job never picked up by worker (queue may have been unavailable)",
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      });
    } else {
      return {
        syncId: existing.id,
        total: existing.total,
        status: existing.status,
      };
    }
  }

  const accessToken = await getValidAccessToken(userId);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const defaultAfter = nowSeconds - ACTIVITIES.MAX_AGE_DAYS * 24 * 60 * 60;
  const after = options?.after ?? defaultAfter;
  const before = options?.before ?? undefined;

  console.log(
    `[Sync] Fetching all activities: after=${new Date(after * 1000).toISOString()} (MAX_AGE_DAYS=${ACTIVITIES.MAX_AGE_DAYS})`,
  );
  const summaries = await fetchAllActivitySummaries(accessToken, after, before);
  const total = summaries.length;
  console.log(`[Sync] Found ${total} activities from Strava`);

  const job = await prisma.syncJob.create({
    data: {
      userId,
      status: "queued",
      type: "initial",
      total,
      after,
      before: before ?? null,
    },
  });

  await addSyncJob({ syncJobId: job.id, userId });

  return {
    syncId: job.id,
    total,
    status: "queued",
  };
}

/**
 * Process a sync job (called by pg-boss worker).
 * Loads fresh credentials, re-fetches activity list, processes from job.processed onward.
 */
export async function processSyncJob(syncJobId: string, userId: string): Promise<void> {
  const job = await prisma.syncJob.findUnique({
    where: { id: syncJobId },
  });

  if (!job || job.status !== "queued") {
    return;
  }

  await prisma.syncJob.update({
    where: { id: syncJobId },
    data: { status: "running" },
  });

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.syncJob.update({
      where: { id: syncJobId },
      data: {
        status: "failed",
        lastErrorMessage: `Token: ${msg}`,
        completedAt: new Date(),
      },
    });
    return;
  }

  const summaries = await fetchAllActivitySummaries(
    accessToken,
    job.after ?? undefined,
    job.before ?? undefined
  );

  let processed = job.processed;
  let skipped = job.skipped;
  let errors = job.errors;
  let lastErrorMessage: string | null = job.lastErrorMessage;

  for (let i = job.processed; i < summaries.length; i++) {
    if (i > 0 && i % TOKEN_REFRESH_INTERVAL === 0) {
      try {
        accessToken = await getValidAccessToken(userId);
      } catch {
        // keep previous token
      }
    }

    const stravaId = String(summaries[i].id);
    try {
      const one = await processOneActivity(userId, stravaId, accessToken);
      switch (one.status) {
        case "synced":
        case "processed":
          processed += 1;
          break;
        case "skipped":
          skipped += 1;
          break;
        case "error":
          errors += 1;
          lastErrorMessage = one.reason;
          break;
      }
    } catch (err) {
      errors += 1;
      lastErrorMessage = err instanceof Error ? err.message : String(err);
    }

    await prisma.syncJob.update({
      where: { id: syncJobId },
      data: {
        processed,
        skipped,
        errors,
        lastErrorMessage,
        updatedAt: new Date(),
      },
    });

    if (i < summaries.length - 1) {
      await new Promise((r) => setTimeout(r, INTER_ACTIVITY_DELAY_MS));
    }
  }

  await prisma.syncJob.update({
    where: { id: syncJobId },
    data: {
      status: "completed",
      completedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

// ============================================
// Errors
// ============================================

export class SyncError extends Error {
  public code: string;
  /** When the next sync is allowed (for SYNC_RATE_LIMITED). */
  public nextSyncAt?: Date;

  constructor(message: string, code: string, nextSyncAt?: Date) {
    super(message);
    this.name = "SyncError";
    this.code = code;
    this.nextSyncAt = nextSyncAt;
  }
}
