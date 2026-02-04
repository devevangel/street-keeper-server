/**
 * Activity Types
 * Types for Strava activities, webhooks, and activity processing
 */

import type { GpxPoint } from "./run.types.js";

// ============================================
// Strava API Response Types
// ============================================

/**
 * Strava activity response from GET /activities/{id}
 * @see https://developers.strava.com/docs/reference/#api-Activities-getActivityById
 */
export interface StravaActivity {
  id: number;
  name: string;
  distance: number; // meters
  moving_time: number; // seconds
  elapsed_time: number; // seconds
  total_elevation_gain: number;
  type: string; // "Run", "Walk", "Hike", etc.
  sport_type: string;
  start_date: string; // ISO date string (UTC)
  start_date_local: string; // ISO date string (local timezone)
  timezone: string;
  start_latlng: [number, number] | null;
  end_latlng: [number, number] | null;

  // Map data
  map: {
    id: string;
    summary_polyline: string | null;
    polyline: string | null;
  };

  // Optional fields
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  calories?: number;
  description?: string | null;

  // Athlete info (partial)
  athlete: {
    id: number;
  };
}

/**
 * Strava summary activity from GET /athlete/activities (list)
 * @see https://developers.strava.com/docs/reference/#api-Activities-getLoggedInAthleteActivities
 */
export interface StravaActivitySummary {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  start_date: string;
  start_date_local: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  athlete: { id: number };
}

/**
 * Strava streams response from GET /activities/{id}/streams
 * @see https://developers.strava.com/docs/reference/#api-Streams-getActivityStreams
 */
export interface StravaStream {
  latlng?: {
    data: [number, number][]; // [lat, lng] pairs
    series_type: "distance" | "time";
    original_size: number;
    resolution: "low" | "medium" | "high";
  };
  time?: {
    data: number[]; // seconds from start
    series_type: "distance" | "time";
    original_size: number;
    resolution: "low" | "medium" | "high";
  };
  distance?: {
    data: number[]; // meters from start
    series_type: "distance" | "time";
    original_size: number;
    resolution: "low" | "medium" | "high";
  };
  altitude?: {
    data: number[]; // meters
    series_type: "distance" | "time";
    original_size: number;
    resolution: "low" | "medium" | "high";
  };
}

// ============================================
// Webhook Types
// ============================================

/**
 * Strava webhook event payload
 * @see https://developers.strava.com/docs/webhooks/
 */
export interface StravaWebhookPayload {
  object_type: "activity" | "athlete";
  object_id: number; // Activity ID or Athlete ID
  aspect_type: "create" | "update" | "delete";
  owner_id: number; // Athlete ID who owns the object
  subscription_id: number;
  event_time: number; // Unix timestamp
  updates?: Record<string, unknown>; // For update events
}

/**
 * Strava webhook verification query params
 */
export interface StravaWebhookVerifyQuery {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
}

/**
 * Strava webhook verification response
 */
export interface StravaWebhookVerifyResponse {
  "hub.challenge": string;
}

// ============================================
// Activity Processing Types
// ============================================

/**
 * Job data for BullMQ activity processing queue
 *
 * Contains the information needed to fetch and process a Strava activity.
 * The worker uses this to:
 * 1. Look up the user by stravaAthleteId (ownerId)
 * 2. Fetch the activity details from Strava using stravaActivityId
 * 3. Process the activity against the user's routes
 */
export interface ProcessActivityJob {
  /** Strava activity ID (to fetch from Strava API) */
  stravaActivityId: string;
  /** Strava athlete ID (owner_id from webhook) */
  ownerId: number;
  /** Our internal user ID (looked up from ownerId) */
  userId: string;
  /** Unix timestamp when event was received */
  eventTime: number;
}

/**
 * Impact of an activity on a route
 */
export interface ActivityImpact {
  completed: string[]; // OSM IDs of streets completed (crossed 90% threshold)
  improved: Array<{
    osmId: string;
    from: number; // Previous percentage
    to: number; // New percentage
  }>;
}

/**
 * Summary of activity's impact across all routes
 */
export interface ActivityProcessingResult {
  activityId: string;
  routesAffected: number;
  totalStreetsCompleted: number;
  totalStreetsImproved: number;
  routeImpacts: Array<{
    routeId: string;
    routeName: string;
    impact: ActivityImpact;
  }>;
}

// ============================================
// Activity Input/Output Types
// ============================================

/**
 * Activity summary for list view
 */
export interface ActivityListItem {
  id: string;
  stravaId: string;
  name: string;
  distanceMeters: number;
  durationSeconds: number;
  startDate: string;
  activityType: string;
  isProcessed: boolean;
  createdAt: string;

  // Impact summary (if processed)
  routesAffected?: number;
  streetsCompleted?: number;
  streetsImproved?: number;
}

/**
 * Activity detail with full data
 */
export interface ActivityDetail extends ActivityListItem {
  coordinates: GpxPoint[];
  processedAt: string | null;

  // Impact on each route
  routeImpacts: Array<{
    routeId: string;
    routeName: string;
    streetsCompleted: number;
    streetsImproved: number;
    impactDetails: ActivityImpact | null;
  }>;
}

/**
 * Activity for route view (filtered to specific route)
 */
export interface RouteActivityItem {
  id: string;
  activityId: string;
  activityName: string;
  date: string;
  distanceMeters: number;
  durationSeconds: number;
  streetsCompleted: number;
  streetsImproved: number;
  impactDetails: ActivityImpact | null;
}

// ============================================
// API Response Types
// ============================================

/**
 * Response for activity list endpoint
 */
export interface ActivityListResponse {
  success: true;
  activities: ActivityListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Response for activity detail endpoint
 */
export interface ActivityDetailResponse {
  success: true;
  activity: ActivityDetail;
}

/**
 * Response for route activities endpoint
 */
export interface RouteActivitiesResponse {
  success: true;
  activities: RouteActivityItem[];
  total: number;
}

/**
 * Response for activity deletion
 */
export interface ActivityDeleteResponse {
  success: true;
  message: string;
  routesRecalculated: number;
}
