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
        `Token refresh failed: ${error.response?.data?.message || error.message}`
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
