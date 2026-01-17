/**
 * Authentication Routes
 * Handles OAuth flows for Strava (and later Garmin)
 */

import { Router, Request, Response } from "express";
import { buildAuthorizationUrl } from "../services/strava.service.js";
import { handleStravaCallback } from "../services/auth.service.js";
import { ERROR_CODES } from "../config/constants.js";
import type { StravaCallbackQuery, ApiErrorResponse } from "../types/auth.types.js";

const router = Router();

/**
 * GET /api/v1/auth/strava
 * Initiates Strava OAuth flow by redirecting to Strava authorization page
 */
router.get("/strava", (req: Request, res: Response) => {
  try {
    const authorizationUrl = buildAuthorizationUrl();
    res.redirect(authorizationUrl);
  } catch (error) {
    console.error("Failed to build Strava authorization URL:", error);

    const errorResponse: ApiErrorResponse = {
      success: false,
      error: "Failed to initiate Strava authentication. Please check server configuration.",
      code: ERROR_CODES.AUTH_CONFIG_ERROR,
    };

    res.status(500).json(errorResponse);
  }
});

/**
 * GET /api/v1/auth/strava/callback
 * Handles the callback from Strava after user authorizes
 * Exchanges code for tokens and creates/updates user
 */
router.get("/strava/callback", async (req: Request, res: Response) => {
  const { code, error, scope } = req.query as StravaCallbackQuery;

  // Handle user denied access
  if (error) {
    const errorResponse: ApiErrorResponse = {
      success: false,
      error: "Authorization denied by user",
      code: ERROR_CODES.AUTH_DENIED,
    };
    return res.status(400).json(errorResponse);
  }

  // Validate code parameter
  if (!code) {
    const errorResponse: ApiErrorResponse = {
      success: false,
      error: "Missing authorization code",
      code: ERROR_CODES.AUTH_MISSING_CODE,
    };
    return res.status(400).json(errorResponse);
  }

  try {
    // Process the OAuth callback
    const user = await handleStravaCallback(code);

    // Return success response
    // Note: JWT token will be added in US-AUTH-04
    res.status(200).json({
      success: true,
      message: "Authentication successful",
      user,
    });
  } catch (error) {
    console.error("Strava callback error:", error);

    // Check if it's an invalid code error
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const isInvalidCode = errorMessage.includes("Invalid") || errorMessage.includes("expired");

    const errorResponse: ApiErrorResponse = {
      success: false,
      error: isInvalidCode ? "Invalid or expired authorization code" : "Authentication failed",
      code: isInvalidCode ? ERROR_CODES.AUTH_INVALID_CODE : ERROR_CODES.INTERNAL_ERROR,
    };

    res.status(isInvalidCode ? 401 : 500).json(errorResponse);
  }
});

export default router;
