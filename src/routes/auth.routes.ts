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
import { requireAuth } from "../middleware/auth.middleware.js";
import { ERROR_CODES, FRONTEND_URL } from "../config/constants.js";
import type {
  StravaCallbackQuery,
  ApiErrorResponse,
} from "../types/auth.types.js";

const router = Router();

/**
 * @openapi
 * /auth/me:
 *   get:
 *     summary: Get current user
 *     description: Returns the authenticated user (via x-user-id header or session).
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Current user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthSuccessResponse'
 *       401:
 *         description: Not authenticated
 */
router.get("/me", requireAuth, (req: Request, res: Response) => {
  const user = req.user!;
  res.status(200).json({
    success: true,
    message: "OK",
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      stravaId: user.stravaId,
      profilePic: user.profilePic,
    },
  });
});

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
      error:
        "Failed to initiate Strava authentication. Please check server configuration.",
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

  // Handle user denied access - redirect to frontend login with error
  if (error) {
    const redirectUrl = `${FRONTEND_URL}/login?${new URLSearchParams({
      error: "access_denied",
    })}`;
    return res.redirect(redirectUrl);
  }

  // Validate code parameter - redirect to frontend login with error
  if (!code) {
    const redirectUrl = `${FRONTEND_URL}/login?${new URLSearchParams({
      error: "missing_code",
    })}`;
    return res.redirect(redirectUrl);
  }

  try {
    // Process the OAuth callback
    const user = await handleStravaCallback(code);

    // Redirect to frontend callback with userId so the app can set user state
    const redirectUrl = `${FRONTEND_URL}/auth/callback?${new URLSearchParams({
      userId: user.id,
    })}`;
    return res.redirect(redirectUrl);
  } catch (err) {
    console.error("Strava callback error:", err);

    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    const isInvalidCode =
      errorMessage.includes("Invalid") || errorMessage.includes("expired");
    const errorParam = isInvalidCode ? "invalid_code" : "auth_failed";

    const redirectUrl = `${FRONTEND_URL}/login?${new URLSearchParams({
      error: errorParam,
    })}`;
    return res.redirect(redirectUrl);
  }
});

export default router;
