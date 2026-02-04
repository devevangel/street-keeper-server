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
      await processActivity(existing.id, userId);
      return { status: "processed" };
    }
    // Already processed: still check for new projects (created before this activity, date+time)
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
  const accessToken = await getValidAccessToken(userId);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const defaultAfter = nowSeconds - ACTIVITIES.MAX_AGE_DAYS * 24 * 60 * 60;
  const after = options?.after ?? defaultAfter;
  const before = options?.before;
  const perPage = Math.min(200, Math.max(1, options?.perPage ?? 30));

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

  const result: SyncRecentResult = {
    synced: 0,
    processed: 0,
    skipped: 0,
    errors: [],
  };

  for (const summary of summaries) {
    const stravaId = String(summary.id);
    try {
      const one = await processOneActivity(userId, stravaId, accessToken);
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
      result.errors.push({
        stravaId,
        reason: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return result;
}

// ============================================
// Errors
// ============================================

export class SyncError extends Error {
  public code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "SyncError";
    this.code = code;
  }
}
