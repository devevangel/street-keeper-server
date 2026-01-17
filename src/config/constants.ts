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
