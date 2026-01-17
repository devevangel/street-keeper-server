/**
 * Authentication Types
 * Single source of truth for all auth-related types
 */

// ============================================
// Strava OAuth Types
// ============================================

/**
 * Strava athlete data returned from OAuth token exchange
 */
export interface StravaAthlete {
  id: number;
  firstname: string;
  lastname: string;
  profile: string; // Profile picture URL
  profile_medium?: string;
  email?: string | null; // May be null if user hasn't shared
  city?: string | null;
  state?: string | null;
  country?: string | null;
  sex?: "M" | "F" | null;
  premium?: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * Response from Strava token exchange endpoint
 * POST https://www.strava.com/oauth/token
 */
export interface StravaTokenResponse {
  token_type: string; // "Bearer"
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp (seconds)
  expires_in: number; // Seconds until expiration
  athlete: StravaAthlete;
}

/**
 * Response from Strava token refresh endpoint
 */
export interface StravaRefreshResponse {
  token_type: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
}

// ============================================
// Auth Callback Types
// ============================================

/**
 * Query parameters from Strava OAuth callback
 * GET /api/v1/auth/strava/callback?code=xxx&scope=xxx
 */
export interface StravaCallbackQuery {
  code?: string;
  scope?: string;
  state?: string;
  error?: string; // Present if user denied access
}

// ============================================
// API Response Types
// ============================================

/**
 * Successful authentication response
 */
export interface AuthSuccessResponse {
  success: true;
  message: string;
  user: AuthUser;
}

/**
 * User data returned in auth responses
 */
export interface AuthUser {
  id: string;
  name: string;
  email?: string | null;
  stravaId?: string | null;
  garminId?: string | null;
  profilePic?: string | null;
}

/**
 * Generic API error response
 */
export interface ApiErrorResponse {
  success: false;
  error: string;
  code?: string;
}

/**
 * Union type for auth responses
 */
export type AuthResponse = AuthSuccessResponse | ApiErrorResponse;

// ============================================
// Internal Types
// ============================================

/**
 * Data needed to create or update a user from Strava
 */
export interface StravaUserData {
  stravaId: string;
  name: string;
  email?: string | null;
  profilePic?: string | null;
  stravaAccessToken: string;
  stravaRefreshToken: string;
  stravaTokenExpiresAt: Date;
}

/**
 * Strava OAuth configuration
 */
export interface StravaOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
}
