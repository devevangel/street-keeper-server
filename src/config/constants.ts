/**
 * Application Constants
 * Centralized configuration values
 */

// ============================================
// Strava OAuth Constants
// ============================================

export const STRAVA = {
  // OAuth URLs
  AUTHORIZE_URL: "https://www.strava.com/oauth/authorize",
  TOKEN_URL: "https://www.strava.com/oauth/token",
  API_BASE_URL: "https://www.strava.com/api/v3",

  // OAuth Scopes
  // read: Read public segments, public routes, public profile data, public posts, public events
  // activity:read_all: Read the user's activities (includes private activities)
  DEFAULT_SCOPE: "read,activity:read_all",

  // Token expiry buffer (refresh token 5 minutes before expiry)
  TOKEN_REFRESH_BUFFER_SECONDS: 300,
} as const;

// ============================================
// API Configuration
// ============================================

export const API = {
  VERSION: "v1",
  PREFIX: "/api/v1",
} as const;

/** Backend: which pipeline(s) run when processing Strava activities. v1 | v2 | both. Default v1. */
export const ENGINE = {
  VERSION: (process.env.GPX_ENGINE_VERSION ?? "v1") as "v1" | "v2" | "both",
} as const;

// ============================================
// Frontend URL (for OAuth redirect)
// ============================================

export const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

// ============================================
// Error Codes
// ============================================

export const ERROR_CODES = {
  // Auth errors
  AUTH_DENIED: "AUTH_DENIED",
  AUTH_MISSING_CODE: "AUTH_MISSING_CODE",
  AUTH_INVALID_CODE: "AUTH_INVALID_CODE",
  AUTH_TOKEN_EXPIRED: "AUTH_TOKEN_EXPIRED",
  AUTH_CONFIG_ERROR: "AUTH_CONFIG_ERROR",
  AUTH_REQUIRED: "AUTH_REQUIRED",

  // General errors
  INTERNAL_ERROR: "INTERNAL_ERROR",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",

  // GPX errors
  GPX_PARSE_ERROR: "GPX_PARSE_ERROR",
  GPX_INVALID_FORMAT: "GPX_INVALID_FORMAT",
  GPX_NO_TRACK_POINTS: "GPX_NO_TRACK_POINTS",
  GPX_FILE_TOO_LARGE: "GPX_FILE_TOO_LARGE",
  GPX_FILE_REQUIRED: "GPX_FILE_REQUIRED",
  OVERPASS_API_ERROR: "OVERPASS_API_ERROR",
  STREET_MATCHING_FAILED: "STREET_MATCHING_FAILED",
  MAPBOX_API_ERROR: "MAPBOX_API_ERROR",

  // Project errors
  PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
  PROJECT_INVALID_RADIUS: "PROJECT_INVALID_RADIUS",
  PROJECT_NO_STREETS: "PROJECT_NO_STREETS",
  PROJECT_ACCESS_DENIED: "PROJECT_ACCESS_DENIED",

  // Activity errors
  ACTIVITY_NOT_FOUND: "ACTIVITY_NOT_FOUND",
  ACTIVITY_ALREADY_EXISTS: "ACTIVITY_ALREADY_EXISTS",
  ACTIVITY_PROCESSING_FAILED: "ACTIVITY_PROCESSING_FAILED",

  // Map errors
  MAP_INVALID_COORDINATES: "MAP_INVALID_COORDINATES",
  MAP_RADIUS_TOO_LARGE: "MAP_RADIUS_TOO_LARGE",

  // Webhook errors
  WEBHOOK_INVALID_SIGNATURE: "WEBHOOK_INVALID_SIGNATURE",
  WEBHOOK_VERIFICATION_FAILED: "WEBHOOK_VERIFICATION_FAILED",

  // Strava API errors
  STRAVA_API_ERROR: "STRAVA_API_ERROR",
  STRAVA_TOKEN_REFRESH_FAILED: "STRAVA_TOKEN_REFRESH_FAILED",
} as const;

// ============================================
// Environment Variable Helpers
// ============================================

/**
 * Get required environment variable or throw
 */
export function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Get optional environment variable with default
 */
export function getEnvVarOptional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

export const OVERPASS = {
  // Primary API endpoint
  API_URL: "https://overpass-api.de/api/interpreter",

  // Fallback servers (tried in order if primary fails)
  FALLBACK_URLS: [
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  ],

  // Client timeout (axios timeout)
  TIMEOUT_MS: 60000, // Increased from 30s to 60s

  // Query timeout (Overpass QL timeout parameter)
  QUERY_TIMEOUT_SECONDS: 60, // Increased from 25s to 60s

  // Maximum retry attempts (including fallback servers)
  MAX_RETRIES: 3,

  HIGHWAY_TYPES: [
    "residential",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "living_street",
    "pedestrian",
    "footway",
    "path",
    "cycleway",
    "track",
  ],
} as const;

export const STREET_MATCHING = {
  MAX_DISTANCE_METERS: 25,
  BBOX_BUFFER_METERS: 100,
  COMPLETION_THRESHOLD: 0.9, // Default threshold (for backwards compatibility)
  MIN_POINTS_PER_STREET: 3,
  /** Don't save street progress for segments with less than this coverage (noise) */
  MIN_COVERAGE_PERCENTAGE: 5,
  /** Confidence thresholds for Mapbox matching fallback */
  CONFIDENCE_THRESHOLDS: {
    HIGH: 0.7, // Use Mapbox result directly
    MEDIUM: 0.3, // Use Mapbox with caution, consider hybrid fallback
    LOW: 0.1, // Fallback to Overpass-only
  },
  /** Length-based completion thresholds - STRICT for accuracy */
  COMPLETION_THRESHOLDS: {
    VERY_SHORT: { maxLength: 50, threshold: 0.85 }, // < 50m: 85% required
    SHORT: { maxLength: 100, threshold: 0.9 }, // 50-100m: 90% required
    MEDIUM: { maxLength: 300, threshold: 0.95 }, // 100-300m: 95% required
    LONG: { maxLength: Infinity, threshold: 0.98 }, // > 300m: 98% required
  },
} as const;

/**
 * Get the appropriate completion threshold for a street based on its length.
 *
 * Shorter streets have slightly lower thresholds to account for GPS accuracy limitations.
 * GPS devices typically have ±5-15m accuracy, which has a larger impact on shorter streets.
 *
 * STRICT thresholds ensure users must actually complete streets, not just run 80%.
 *
 * @param streetLengthMeters - Total length of the street in meters
 * @returns Completion threshold (0.0 to 1.0) - coverage ratio required for "FULL" status
 *
 * @example
 * getCompletionThreshold(45)  // 0.85 (very short street)
 * getCompletionThreshold(75)  // 0.9 (short street)
 * getCompletionThreshold(200) // 0.95 (medium street)
 * getCompletionThreshold(500) // 0.98 (long street)
 */
export function getCompletionThreshold(streetLengthMeters: number): number {
  const thresholds = STREET_MATCHING.COMPLETION_THRESHOLDS;

  if (streetLengthMeters <= thresholds.VERY_SHORT.maxLength) {
    return thresholds.VERY_SHORT.threshold;
  }
  if (streetLengthMeters <= thresholds.SHORT.maxLength) {
    return thresholds.SHORT.threshold;
  }
  if (streetLengthMeters <= thresholds.MEDIUM.maxLength) {
    return thresholds.MEDIUM.threshold;
  }
  return thresholds.LONG.threshold;
}

export const GPX_UPLOAD = {
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
  MIN_POINTS: 2,
} as const;

// ============================================
// GPS Quality & Analysis Constants
// ============================================

export const GPS_QUALITY = {
  // GPS jump detection threshold
  // Points with distance > this threshold are considered "jumps" (GPS errors)
  // Typical running speed: 2-5 m/s, so 100m jump = 20-50 seconds gap (likely GPS error)
  JUMP_THRESHOLD_METERS: 100,

  // Stopped speed threshold (meters per second)
  // Points moving slower than this are considered "stopped"
  // 0.5 m/s = 1.8 km/h (walking speed threshold)
  STOPPED_SPEED_THRESHOLD_MS: 0.5,

  // Minimum time difference between points to calculate speed (seconds)
  // Prevents division by zero and handles missing timestamps
  MIN_TIME_DIFF_SECONDS: 1,
} as const;

// ============================================
// Street Aggregation Constants
// ============================================

export const STREET_AGGREGATION = {
  // Unnamed road filtering thresholds
  // Filter out tiny unnamed segments that clutter results
  // Both conditions must be met for filtering (AND logic)
  MIN_UNNAMED_LENGTH_METERS: 30, // Minimum street length
  MIN_UNNAMED_COVERED_METERS: 20, // Minimum distance covered

  // Coverage clamping
  // Clamp coverage ratios to max 1.0 for UX (display purposes)
  // Raw ratios are kept unclamped for debugging
  MAX_DISPLAY_COVERAGE_RATIO: 1.0,

  // Street-level completion (map aggregation)
  // A street is "completed" when its length-weighted completion ratio meets this threshold.
  // STRICT: Requires 98% weighted completion for full accuracy.
  STREET_COMPLETION_THRESHOLD: 0.98,

  // Connector segments: short links (e.g. between intersections) that count less.
  // Segments with length <= this are treated as connectors in weighted completion.
  CONNECTOR_MAX_LENGTH_METERS: 20,

  // Weight applied to connector segments in length-weighted completion (0–1).
  // Connectors contribute less so one short gap doesn't override long completed stretches.
  CONNECTOR_WEIGHT: 0.5,
} as const;

// ============================================
// Mapbox Map Matching Constants
// ============================================

export const MAPBOX = {
  // Mapbox Map Matching API endpoint
  // Profile "walking" is best for running (uses pedestrian paths)
  API_URL: "https://api.mapbox.com/matching/v5/mapbox/walking",

  // Map matching parameters
  // See: https://docs.mapbox.com/api/navigation/map-matching/
  GEOMETRIES: "geojson", // Return GeoJSON geometry (easier to work with)
  OVERVIEW: "full", // Full route geometry (not simplified)
  ANNOTATIONS: "distance,duration,speed", // Include distance, duration, and speed annotations for validation
  TIDY: true, // Clean up noisy traces (removes redundant points)
  STEPS: true, // Include turn-by-turn steps (gives us street names)

  /** Maximum expected speed in m/s for validation (15 m/s = 54 km/h) */
  MAX_EXPECTED_SPEED_MS: 15,
  /** Minimum expected average speed for a valid activity (0.5 m/s = ~1.8 km/h) */
  MIN_EXPECTED_SPEED_MS: 0.5,

  // Radiuses: How far from the road network to search (meters)
  // Higher = more lenient matching, lower = stricter
  // Matches existing STREET_MATCHING.MAX_DISTANCE_METERS for consistency
  DEFAULT_RADIUS: 25,

  // Maximum coordinates per request (Mapbox API limit)
  // Larger traces must be chunked into multiple requests
  MAX_COORDINATES: 100,

  // Request timeout (milliseconds)
  TIMEOUT_MS: 30000,

  // Minimum confidence threshold for accepting a match
  // Mapbox returns confidence 0-1; below this threshold, match is rejected
  MIN_CONFIDENCE: 0.5,
} as const;

// ============================================
// Projects Configuration
// ============================================

/**
 * Project creation and management constants
 *
 * Projects define geographic areas (circles) where users track street completion.
 * Users select a center point and radius to create a project, then the system
 * tracks which streets they've run.
 */
export const PROJECTS = {
  /**
   * Allowed radius values in meters
   * Limited set prevents excessively large or small projects
   * - 500m: Small neighborhood
   * - 1000m: Large neighborhood
   * - 2000m: Small town area (default)
   * - 5000m: Town/city district
   * - 10000m: Large city area
   */
  ALLOWED_RADII: [500, 1000, 2000, 5000, 10000] as const,

  /**
   * Days before project snapshot is considered stale
   * When user views project, if snapshot is older than this, refresh from OSM
   * 30 days balances freshness with API usage
   */
  SNAPSHOT_REFRESH_DAYS: 30,

  /**
   * Street count threshold for warning
   * If project contains more streets than this, show warning to user
   * Large projects may be overwhelming to complete
   */
  MAX_STREETS_WARNING: 500,

  /**
   * Highway types that are typically not runnable
   * Used to generate warnings during project preview
   */
  NON_RUNNABLE_HIGHWAYS: ["motorway", "trunk", "motorway_link", "trunk_link"],
} as const;

// ============================================
// Map Feature Configuration
// ============================================

/**
 * Map endpoint (home page map view) configuration
 */
export const MAP = {
  /** Default radius in meters when not specified */
  DEFAULT_RADIUS_METERS: 2000,
  /** Maximum allowed radius in meters */
  MAX_RADIUS_METERS: 10000,
  /** Minimum allowed radius in meters */
  MIN_RADIUS_METERS: 100,
} as const;

// ============================================
// Activities Configuration
// ============================================

/**
 * Activity types and processing constants
 *
 * Activities are synced from Strava via webhook.
 * Only certain activity types are processed for street tracking.
 */
export const ACTIVITIES = {
  /**
   * Strava activity types that count for street completion
   * Only these types will be processed when received via webhook
   */
  ALLOWED_TYPES: ["Run", "Walk", "Hike", "Trail Run"] as const,

  /**
   * Minimum distance in meters for activity to be processed
   * Very short activities are likely GPS errors or false starts
   */
  MIN_DISTANCE_METERS: 100,

  /**
   * Maximum age of activity to process (in days)
   * Prevents processing very old backlog if webhook was delayed
   */
  MAX_AGE_DAYS: 30,
} as const;

// ============================================
// Geometry Cache Configuration
// ============================================

/**
 * Caching configuration for street geometries
 *
 * Geometry cache reduces Overpass API calls by storing street data
 * in the database. Used for:
 * - Route preview (before creation)
 * - Map view (street geometries)
 * - Activity processing (matching streets)
 */
export const GEOMETRY_CACHE = {
  /**
   * Cache time-to-live in hours
   * Street geometries don't change often, 24h is reasonable
   */
  TTL_HOURS: 24,

  /**
   * Prefix for cache keys
   * Keys are formatted as: "geo:radius:{lat}:{lng}:{meters}"
   */
  KEY_PREFIX: "geo:",

  /**
   * Number of decimal places for coordinate rounding in cache keys
   * 4 decimal places = ~11m accuracy (sufficient for caching)
   */
  COORD_PRECISION: 4,
} as const;

// ============================================
// Job Queue Configuration (pg-boss)
// ============================================

/**
 * pg-boss job queue configuration
 *
 * Activity processing is handled asynchronously via pg-boss.
 * pg-boss uses PostgreSQL (same as Prisma) for job storage,
 * eliminating the need for Redis.
 *
 * Webhook receives activity notification, saves to DB, then enqueues
 * a processing job. Worker picks up job and processes in background.
 */
export const QUEUE = {
  /**
   * Queue name for activity processing jobs
   */
  ACTIVITY_PROCESSING: "activity-processing",

  /**
   * Number of concurrent jobs to process
   * Higher = faster processing, but more load on external APIs
   */
  CONCURRENCY: 5,

  /**
   * Job retry configuration
   * Failed jobs are retried with exponential backoff
   */
  RETRY: {
    MAX_ATTEMPTS: 3,
    BACKOFF_DELAY_MS: 5000, // 5s, 10s, 20s (pg-boss uses seconds)
  },

  /**
   * Job timeout in milliseconds
   * Jobs taking longer than this are considered failed
   */
  JOB_TIMEOUT_MS: 120000, // 2 minutes (allows for slow Overpass)
} as const;

// ============================================
// Strava Webhook Configuration
// ============================================

/**
 * Strava webhook constants
 *
 * Strava sends webhook events when users create/update/delete activities.
 * We must respond within 2 seconds, so actual processing is queued.
 *
 * @see https://developers.strava.com/docs/webhooks/
 */
export const STRAVA_WEBHOOK = {
  /**
   * Maximum response time for webhook (Strava requirement)
   * Must respond within this time or Strava considers delivery failed
   */
  MAX_RESPONSE_TIME_MS: 2000,

  /**
   * Event types we care about
   * We only process activity creates (not updates or deletes)
   */
  SUPPORTED_EVENTS: {
    OBJECT_TYPE: "activity",
    ASPECT_TYPE: "create",
  },
} as const;
