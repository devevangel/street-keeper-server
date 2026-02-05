/**
 * Strava Service
 * Handles all Strava API interactions
 */

import axios, { AxiosError } from "axios";
import { STRAVA, getEnvVar } from "../config/constants.js";
import type {
  StravaTokenResponse,
  StravaRefreshResponse,
  StravaOAuthConfig,
} from "../types/auth.types.js";

/**
 * Get Strava OAuth configuration from environment
 */
export function getStravaConfig(): StravaOAuthConfig {
  return {
    clientId: getEnvVar("STRAVA_CLIENT_ID"),
    clientSecret: getEnvVar("STRAVA_CLIENT_SECRET"),
    redirectUri: getEnvVar("STRAVA_REDIRECT_URI"),
    scope: STRAVA.DEFAULT_SCOPE,
  };
}

/**
 * Build the Strava authorization URL for OAuth redirect
 */
export function buildAuthorizationUrl(state?: string): string {
  const config = getStravaConfig();

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scope,
    approval_prompt: "auto",
  });

  // Add state parameter if provided (for CSRF protection)
  if (state) {
    params.append("state", state);
  }

  return `${STRAVA.AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for access and refresh tokens
 * Called after user authorizes on Strava
 */
export async function exchangeCodeForTokens(
  code: string
): Promise<StravaTokenResponse> {
  const config = getStravaConfig();

  try {
    const response = await axios.post<StravaTokenResponse>(
      STRAVA.TOKEN_URL,
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: code,
        grant_type: "authorization_code",
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      // Strava returns 400 for invalid/expired codes
      if (error.response?.status === 400) {
        throw new Error("Invalid or expired authorization code");
      }
      throw new Error(
        `Strava API error: ${error.response?.data?.message || error.message}`
      );
    }
    throw error;
  }
}

/**
 * Refresh an expired access token using refresh token
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<StravaRefreshResponse> {
  const config = getStravaConfig();

  try {
    const response = await axios.post<StravaRefreshResponse>(
      STRAVA.TOKEN_URL,
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(
        `Token refresh failed: ${
          error.response?.data?.message || error.message
        }`
      );
    }
    throw error;
  }
}

/**
 * Check if a token is expired or will expire soon
 * @param expiresAt - Unix timestamp (seconds) when token expires
 * @returns true if token is expired or will expire within buffer period
 */
export function isTokenExpired(expiresAt: number | Date): boolean {
  const expiresAtSeconds =
    expiresAt instanceof Date
      ? Math.floor(expiresAt.getTime() / 1000)
      : expiresAt;

  const nowSeconds = Math.floor(Date.now() / 1000);
  return expiresAtSeconds - nowSeconds <= STRAVA.TOKEN_REFRESH_BUFFER_SECONDS;
}

// ============================================
// List Athlete Activities (for Manual Sync)
// ============================================

export interface ListActivitiesOptions {
  /** Unix timestamp - return activities before this time */
  before?: number;
  /** Unix timestamp - return activities after this time */
  after?: number;
  /** Page number (default 1) */
  page?: number;
  /** Items per page (default 30, max 200) */
  perPage?: number;
}

/**
 * List recent activities for the authenticated athlete
 *
 * Used by the manual sync endpoint to fetch activities without webhooks.
 * @see https://developers.strava.com/docs/reference/#api-Activities-getLoggedInAthleteActivities
 */
export async function listAthleteActivities(
  accessToken: string,
  options?: ListActivitiesOptions
): Promise<StravaActivitySummary[]> {
  const params = new URLSearchParams();
  if (options?.before != null) params.set("before", String(options.before));
  if (options?.after != null) params.set("after", String(options.after));
  if (options?.page != null) params.set("page", String(options.page));
  params.set("per_page", String(options?.perPage ?? 30));

  const url = `${STRAVA.API_BASE_URL}/athlete/activities?${params.toString()}`;

  try {
    const response = await axios.get<StravaActivitySummary[]>(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000,
    });
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      if (error.response?.status === 401) {
        throw new StravaApiError(
          "Strava access token is invalid or expired",
          "TOKEN_INVALID"
        );
      }
      throw new StravaApiError(
        `Failed to list activities: ${
          error.response?.data?.message ?? error.message
        }`,
        "API_ERROR"
      );
    }
    throw error;
  }
}

// ============================================
// Activity Fetching (for Webhook Processing)
// ============================================

import type {
  StravaActivity,
  StravaActivitySummary,
  StravaStream,
} from "../types/activity.types.js";
import type { GpxPoint } from "../types/run.types.js";

/**
 * Fetch a single activity from Strava API
 *
 * Called when webhook notifies us of a new activity.
 * Returns activity metadata (name, distance, duration, etc.)
 *
 * @param accessToken - Valid Strava access token
 * @param activityId - Strava activity ID (from webhook)
 * @returns Activity metadata
 * @throws Error if API call fails
 *
 * @example
 * const activity = await fetchActivity(token, "12345678");
 * console.log(activity.name); // "Morning Run"
 * console.log(activity.distance); // 5234.2 (meters)
 */
export async function fetchActivity(
  accessToken: string,
  activityId: string
): Promise<StravaActivity> {
  try {
    const response = await axios.get<StravaActivity>(
      `${STRAVA.API_BASE_URL}/activities/${activityId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 30000, // 30 second timeout
      }
    );

    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      if (error.response?.status === 404) {
        throw new StravaApiError(
          `Activity ${activityId} not found`,
          "ACTIVITY_NOT_FOUND"
        );
      }
      if (error.response?.status === 401) {
        throw new StravaApiError(
          "Strava access token is invalid or expired",
          "TOKEN_INVALID"
        );
      }
      throw new StravaApiError(
        `Failed to fetch activity: ${
          error.response?.data?.message || error.message
        }`,
        "API_ERROR"
      );
    }
    throw error;
  }
}

/**
 * Fetch GPS streams (detailed coordinates) for an activity
 *
 * Strava streams provide detailed GPS data (~1 point per second).
 * This is much more accurate than the simplified polyline.
 *
 * Streams available:
 * - latlng: GPS coordinates [lat, lng]
 * - time: Seconds from start
 * - distance: Meters from start
 * - altitude: Elevation in meters
 * - velocity_smooth: Smoothed velocity in m/s (for GPS error detection)
 * - moving: Boolean indicating if athlete was moving (for filtering stops)
 *
 * @param accessToken - Valid Strava access token
 * @param activityId - Strava activity ID
 * @returns Stream data with coordinates, timestamps, velocity, and moving status
 * @throws Error if API call fails
 *
 * @example
 * const streams = await fetchActivityStreams(token, "12345678");
 * console.log(streams.latlng.data.length); // ~1800 points for 30min run
 */
export async function fetchActivityStreams(
  accessToken: string,
  activityId: string
): Promise<StravaStream> {
  try {
    const response = await axios.get<StravaStream>(
      `${STRAVA.API_BASE_URL}/activities/${activityId}/streams`,
      {
        params: {
          // Request these stream types including velocity and moving for quality filtering
          keys: "latlng,time,distance,altitude,velocity_smooth,moving",
          // Return as object keyed by type (easier to work with)
          key_by_type: true,
        },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 30000,
      }
    );

    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      if (error.response?.status === 404) {
        throw new StravaApiError(
          `Streams not found for activity ${activityId}`,
          "STREAMS_NOT_FOUND"
        );
      }
      if (error.response?.status === 401) {
        throw new StravaApiError(
          "Strava access token is invalid or expired",
          "TOKEN_INVALID"
        );
      }
      throw new StravaApiError(
        `Failed to fetch streams: ${
          error.response?.data?.message || error.message
        }`,
        "API_ERROR"
      );
    }
    throw error;
  }
}

/**
 * Maximum velocity in m/s for valid running GPS points.
 * Points with velocity above this are likely GPS errors (teleportation).
 * 15 m/s = 54 km/h = ~33 mph (faster than any human can run)
 */
const MAX_VALID_VELOCITY_MS = 15;

/**
 * Options for converting Strava streams to GPS points
 */
export interface StreamsToGpxOptions {
  /** Filter out points where velocity exceeds threshold (GPS errors) */
  filterHighVelocity?: boolean;
  /** Filter out points where athlete was stopped (reduces noise) */
  filterStopped?: boolean;
}

/**
 * Convert Strava streams to GpxPoint array with quality filtering
 *
 * Transforms Strava's stream format into our internal GpxPoint format
 * that's compatible with the existing street matching services.
 *
 * Quality filtering (when enabled):
 * - Filters points with unrealistic velocity (GPS teleportation errors)
 * - Filters stopped points (reduce noise at traffic lights, etc.)
 *
 * @param streams - Strava stream data (from fetchActivityStreams)
 * @param startDate - Activity start time (for calculating timestamps)
 * @param options - Optional filtering options
 * @returns Array of GpxPoint objects ready for street matching
 *
 * @example
 * const streams = await fetchActivityStreams(token, activityId);
 * const points = streamsToGpxPoints(streams, new Date(activity.start_date), {
 *   filterHighVelocity: true,
 *   filterStopped: true
 * });
 * const matched = await matchPointsToStreetsHybrid(points, streets);
 */
export function streamsToGpxPoints(
  streams: StravaStream,
  startDate: Date,
  options?: StreamsToGpxOptions
): GpxPoint[] {
  // Need at least latlng data
  if (!streams.latlng?.data || streams.latlng.data.length === 0) {
    return [];
  }

  const points: GpxPoint[] = [];
  const latlngData = streams.latlng.data;
  const timeData = streams.time?.data;
  const altitudeData = streams.altitude?.data;
  const velocityData = streams.velocity_smooth?.data;
  const movingData = streams.moving?.data;

  const filterHighVelocity = options?.filterHighVelocity ?? true;
  const filterStopped = options?.filterStopped ?? false; // Default false to preserve existing behavior

  let filteredCount = 0;

  for (let i = 0; i < latlngData.length; i++) {
    // Filter out GPS errors based on velocity
    if (filterHighVelocity && velocityData && velocityData[i] !== undefined) {
      if (velocityData[i] > MAX_VALID_VELOCITY_MS) {
        filteredCount++;
        continue; // Skip this point - likely GPS teleportation
      }
    }

    // Filter out stopped points if requested
    if (filterStopped && movingData && movingData[i] !== undefined) {
      if (!movingData[i]) {
        filteredCount++;
        continue; // Skip this point - athlete was stopped
      }
    }

    const [lat, lng] = latlngData[i];

    const point: GpxPoint = {
      lat,
      lng,
    };

    // Add elevation if available
    if (altitudeData && altitudeData[i] !== undefined) {
      point.elevation = altitudeData[i];
    }

    // Add timestamp if time data available
    if (timeData && timeData[i] !== undefined) {
      // timeData[i] is seconds from start
      point.timestamp = new Date(startDate.getTime() + timeData[i] * 1000);
    }

    points.push(point);
  }

  if (filteredCount > 0) {
    console.log(
      `[Strava] Filtered ${filteredCount} low-quality GPS points (velocity/stopped)`
    );
  }

  return points;
}

// ============================================
// Custom Error Class for Strava API
// ============================================

/**
 * Custom error class for Strava API errors
 *
 * Provides structured error information for handling different
 * failure scenarios (auth issues, rate limits, etc.)
 */
export class StravaApiError extends Error {
  public code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "StravaApiError";
    this.code = code;
  }
}
