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

/** Backend: which pipeline(s) run when processing Strava activities. v1 | v2 | both. Default v2. */
export const ENGINE = {
  VERSION: (process.env.GPX_ENGINE_VERSION ?? "v2") as "v1" | "v2" | "both",
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
  SYNC_RATE_LIMITED: "SYNC_RATE_LIMITED",

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
  /**
   * Server list, tried in order.
   *
   * overpass-api.de resolves to two independent servers (gall + lambert) with
   * separate rate-limit pools.  We list both explicitly so we can check their
   * /api/status endpoints independently and pick whichever has a free slot.
   *
   * @see https://dev.overpass-api.de/overpass-doc/en/preface/commons.html
   * @see https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances
   */
  SERVERS: [
    "https://gall.openstreetmap.de/api/interpreter",
    "https://lambert.openstreetmap.de/api/interpreter",
  ] as readonly string[],

  /** axios client timeout */
  TIMEOUT_MS: 60_000,

  /** Overpass QL [timeout:] — how long the server may run the query */
  QUERY_TIMEOUT_SECONDS: 30,

  /**
   * Overpass QL [maxsize:] in bytes.
   * Street queries for a 1–2 km radius typically return < 2 MB.
   * A lower declaration makes the server more likely to admit our request.
   */
  QUERY_MAXSIZE_BYTES: 16 * 1024 * 1024, // 16 MiB

  /**
   * Default max seconds to wait for a slot (request-path callers).
   * Keep short — this blocks the user's HTTP response on cache misses.
   * Background jobs should pass a longer budget via OverpassQueryOptions.
   */
  MAX_SLOT_WAIT_SECONDS: 10,

  /** Max seconds to wait when called from a pg-boss background job. */
  BACKGROUND_MAX_SLOT_WAIT_SECONDS: 45,

  /** Per-server retry attempts (for transient HTTP / network errors) */
  MAX_RETRIES: 2,

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
// Milestones Configuration
// ============================================

/** Max active (incomplete) milestones per project and globally. */
export const MILESTONES = {
  MAX_ACTIVE_PER_PROJECT: 5,
  MAX_ACTIVE_GLOBAL: 7,
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
   * - 100m, 200m: Very small area (quick wins)
   * - 500m: Small neighborhood
   * - 1000m: Large neighborhood
   * - 2000m: Small town area
   * - 5000m: Town/city district
   * - 10000m: Large city area
   * - 50000m: Entire city/metropolitan area
   */
  ALLOWED_RADII: [100, 200, 500, 1000, 2000, 5000, 10000, 50000] as const,

  /** Min/max/step for radius slider (100–50000 m in 100 m steps) */
  RADIUS_MIN: 100,
  RADIUS_MAX: 50000,
  RADIUS_STEP: 100,

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

/**
 * Validate radius is within allowed range and step (100–50000 m in 100 m steps).
 */
export function isValidRadius(r: number): boolean {
  return (
    r >= PROJECTS.RADIUS_MIN &&
    r <= PROJECTS.RADIUS_MAX &&
    r % PROJECTS.RADIUS_STEP === 0
  );
}

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
  MAX_RADIUS_METERS: 50000,
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
   * Maximum age of activity to process (in days).
   * Override with env SYNC_MAX_AGE_DAYS for a full history import.
   */
  MAX_AGE_DAYS: Number(process.env.SYNC_MAX_AGE_DAYS) || 30,

  /**
   * Minimum hours between manual Strava syncs (CityStrides-style once per day).
   */
  SYNC_COOLDOWN_HOURS: 24,
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
   * Street geometries rarely change; 7 days reduces Overpass load significantly
   */
  TTL_HOURS: 168,

  /**
   * Prefix for cache keys
   * Keys are formatted as: "geo:radius:{lat}:{lng}:{meters}"
   */
  KEY_PREFIX: "geo:",

  /**
   * Number of decimal places for coordinate rounding in cache keys
   * 3 decimal places = ~111m accuracy (improves cache hit rate, fewer Overpass calls)
   */
  COORD_PRECISION: 3,
} as const;

// ============================================
// City Sync (On-Demand: CityStrides Model)
// ============================================
export const CITY_SYNC = {
  /** Days after which a city is re-synced from Overpass (match CityStrides ~6 weeks) */
  EXPIRY_DAYS: parseInt(process.env.CITY_SYNC_EXPIRY_DAYS ?? "42", 10),
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
   * Queue name for background Strava sync (onboarding / initial import)
   */
  BACKGROUND_SYNC: "background-sync",

  /** Background Overpass city sync (singleton per relationId) */
  CITY_SYNC: "city-sync",

  /** Deferred GPX analyze when city street data is not ready */
  GPX_ANALYZE: "gpx-analyze",

  /**
   * Number of concurrent jobs to process
   * Reduced to 2 to avoid Overpass rate limits during sync
   */
  CONCURRENCY: 2,

  /**
   * Job retry configuration
   * Failed jobs are retried with exponential backoff
   */
  RETRY: {
    MAX_ATTEMPTS: 3,
    BACKOFF_DELAY_MS: 5000, // 5s, 10s, 20s (pg-boss uses seconds)
  },

  /**
   * Sync job retry (longer delay for Strava/Overpass)
   */
  SYNC_RETRY: {
    MAX_ATTEMPTS: 3,
    DELAY_SECONDS: 30,
  },

  /**
   * Job timeout in milliseconds
   * Jobs taking longer than this are considered failed
   */
  JOB_TIMEOUT_MS: 120000, // 2 minutes (allows for slow Overpass)

  /**
   * Sync job timeout (initial sync can have many activities)
   */
  SYNC_JOB_TIMEOUT_MS: 600000, // 10 minutes
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
