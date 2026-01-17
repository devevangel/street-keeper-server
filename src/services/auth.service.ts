/**
 * Auth Service
 * Handles authentication business logic
 */

import prisma from "../lib/prisma.js";
import {
  exchangeCodeForTokens,
  refreshAccessToken,
  isTokenExpired,
} from "./strava.service.js";
import type {
  StravaTokenResponse,
  StravaUserData,
  AuthUser,
} from "../types/auth.types.js";

/**
 * Process Strava OAuth callback
 * Exchanges code for tokens and creates/updates user
 */
export async function handleStravaCallback(code: string): Promise<AuthUser> {
  // Exchange code for tokens
  const tokenData = await exchangeCodeForTokens(code);

  // Extract user data from token response
  const userData = extractStravaUserData(tokenData);

  // Find or create user
  const user = await findOrCreateStravaUser(userData);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    stravaId: user.stravaId,
    garminId: user.garminId,
    profilePic: user.profilePic,
  };
}

/**
 * Extract user data from Strava token response
 */
function extractStravaUserData(tokenData: StravaTokenResponse): StravaUserData {
  const { athlete, access_token, refresh_token, expires_at } = tokenData;

  return {
    stravaId: String(athlete.id),
    name: `${athlete.firstname} ${athlete.lastname}`.trim(),
    email: athlete.email ?? null,
    profilePic: athlete.profile ?? null,
    stravaAccessToken: access_token,
    stravaRefreshToken: refresh_token,
    stravaTokenExpiresAt: new Date(expires_at * 1000), // Convert Unix timestamp to Date
  };
}

/**
 * Find existing user by Strava ID or create new one
 */
async function findOrCreateStravaUser(userData: StravaUserData) {
  // Try to find existing user
  const existingUser = await prisma.user.findUnique({
    where: { stravaId: userData.stravaId },
  });

  if (existingUser) {
    // Update existing user with new tokens
    return prisma.user.update({
      where: { id: existingUser.id },
      data: {
        name: userData.name,
        email: userData.email,
        profilePic: userData.profilePic,
        stravaAccessToken: userData.stravaAccessToken,
        stravaRefreshToken: userData.stravaRefreshToken,
        stravaTokenExpiresAt: userData.stravaTokenExpiresAt,
      },
    });
  }

  // Create new user
  return prisma.user.create({
    data: {
      stravaId: userData.stravaId,
      name: userData.name,
      email: userData.email,
      profilePic: userData.profilePic,
      stravaAccessToken: userData.stravaAccessToken,
      stravaRefreshToken: userData.stravaRefreshToken,
      stravaTokenExpiresAt: userData.stravaTokenExpiresAt,
    },
  });
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    stravaId: user.stravaId,
    garminId: user.garminId,
    profilePic: user.profilePic,
  };
}

/**
 * Get valid Strava access token for a user
 * Refreshes the token if expired
 */
export async function getValidStravaToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      stravaAccessToken: true,
      stravaRefreshToken: true,
      stravaTokenExpiresAt: true,
    },
  });

  if (!user?.stravaAccessToken || !user?.stravaRefreshToken) {
    return null;
  }

  // Check if token is still valid
  if (user.stravaTokenExpiresAt && !isTokenExpired(user.stravaTokenExpiresAt)) {
    return user.stravaAccessToken;
  }

  // Token expired, refresh it
  try {
    const refreshData = await refreshAccessToken(user.stravaRefreshToken);

    // Update user with new tokens
    await prisma.user.update({
      where: { id: userId },
      data: {
        stravaAccessToken: refreshData.access_token,
        stravaRefreshToken: refreshData.refresh_token,
        stravaTokenExpiresAt: new Date(refreshData.expires_at * 1000),
      },
    });

    return refreshData.access_token;
  } catch (error) {
    console.error("Failed to refresh Strava token:", error);
    return null;
  }
}
