/**
 * Authentication Routes
 * Handles OAuth flows for Strava (and later Garmin)
 * 
 * @openapi
 * tags:
 *   - name: Auth
 *     description: Authentication endpoints (Strava OAuth)
 */

import { Router, Request, Response } from "express";
import { buildAuthorizationUrl } from "../services/strava.service.js";
import { handleStravaCallback } from "../services/auth.service.js";
import { ERROR_CODES } from "../config/constants.js";
import type { StravaCallbackQuery, ApiErrorResponse } from "../types/auth.types.js";

const router = Router();

/**
 * @openapi
 * /auth/strava:
 *   get:
 *     summary: Initiate Strava OAuth flow
 *     description: Redirects user to Strava authorization page. After authorization, Strava redirects back to the callback endpoint.
 *     tags: [Auth]
 *     responses:
 *       302:
 *         description: Redirect to Strava authorization page
 *       500:
 *         description: Server configuration error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
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
 * @openapi
 * /auth/strava/callback:
 *   get:
 *     summary: Handle Strava OAuth callback
 *     description: |
 *       Called by Strava after user authorizes. Exchanges the authorization code for tokens,
 *       creates or updates the user, and returns user data.
 *       
 *       **Note:** This endpoint is typically called by Strava redirect, not directly by frontend.
 *     tags: [Auth]
 *     parameters:
 *       - in: query
 *         name: code
 *         schema:
 *           type: string
 *         description: Authorization code from Strava
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *         description: Granted OAuth scopes
 *       - in: query
 *         name: error
 *         schema:
 *           type: string
 *         description: Error if user denied access
 *     responses:
 *       200:
 *         description: Authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthSuccessResponse'
 *       400:
 *         description: User denied access or missing code
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *             examples:
 *               denied:
 *                 summary: User denied access
 *                 value:
 *                   success: false
 *                   error: "Authorization denied by user"
 *                   code: "AUTH_DENIED"
 *               missingCode:
 *                 summary: Missing authorization code
 *                 value:
 *                   success: false
 *                   error: "Missing authorization code"
 *                   code: "AUTH_MISSING_CODE"
 *       401:
 *         description: Invalid or expired authorization code
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
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
