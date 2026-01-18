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
    "residential", "primary", "secondary", "tertiary",
    "unclassified", "living_street", "pedestrian",
    "footway", "path", "cycleway", "track",
  ],
} as const;

export const STREET_MATCHING = {
  MAX_DISTANCE_METERS: 25,
  BBOX_BUFFER_METERS: 100,
  COMPLETION_THRESHOLD: 0.90,
  MIN_POINTS_PER_STREET: 3,
} as const;

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
} as const;

