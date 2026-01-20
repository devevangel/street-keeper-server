/**
 * Webhook Routes
 * Handles incoming webhook events from external services (Strava)
 * 
 * STRAVA WEBHOOK SETUP:
 * ---------------------
 * 
 * Strava webhooks require a two-step process:
 * 
 * 1. **Verification (GET)**: When you create a subscription, Strava sends
 *    a GET request to verify you own the endpoint. We echo back a challenge.
 * 
 * 2. **Events (POST)**: When users create/update/delete activities,
 *    Strava sends POST requests. We must respond within 2 seconds.
 * 
 * ENDPOINTS:
 * ----------
 * 
 * GET  /api/v1/webhooks/strava
 *   - Strava subscription verification
 *   - Called once when setting up the subscription
 * 
 * POST /api/v1/webhooks/strava
 *   - Receive webhook events
 *   - Called every time a user creates/updates/deletes an activity
 * 
 * SECURITY:
 * ---------
 * - Verification uses a shared secret token (STRAVA_WEBHOOK_VERIFY_TOKEN)
 * - Events are validated for structure before processing
 * - Processing is queued, not done inline (prevents DoS via slow operations)
 * 
 * @see https://developers.strava.com/docs/webhooks/
 */

import { Router, Request, Response } from "express";
import {
  verifyWebhookSubscription,
  handleWebhookEvent,
  isValidWebhookPayload,
  getSubscriptionInfo,
} from "../services/webhook.service.js";
import { ERROR_CODES, STRAVA_WEBHOOK } from "../config/constants.js";
import type { StravaWebhookVerifyQuery } from "../types/activity.types.js";

const router = Router();

// ============================================
// Strava Webhook Endpoints
// ============================================

/**
 * @openapi
 * /webhooks/strava:
 *   get:
 *     summary: Strava webhook verification
 *     description: |
 *       Called by Strava when creating a new webhook subscription to verify
 *       we own the callback URL. We echo back the challenge.
 *       
 *       **Note:** This endpoint is called by Strava, not by users.
 *     tags: [Webhooks]
 *     parameters:
 *       - in: query
 *         name: hub.mode
 *         schema:
 *           type: string
 *         description: Should be "subscribe"
 *       - in: query
 *         name: hub.verify_token
 *         schema:
 *           type: string
 *         description: Our configured verify token
 *       - in: query
 *         name: hub.challenge
 *         schema:
 *           type: string
 *         description: Random string to echo back
 *     responses:
 *       200:
 *         description: Verification successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 hub.challenge:
 *                   type: string
 *       403:
 *         description: Verification failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.get("/strava", async (req: Request, res: Response) => {
  console.log("[Webhook] Received Strava verification request");

  // Cast query to our expected type
  const query = req.query as unknown as StravaWebhookVerifyQuery;

  // Attempt verification
  const result = verifyWebhookSubscription(query);

  if (result) {
    // Verification successful - echo challenge
    console.log("[Webhook] Verification successful");
    res.status(200).json(result);
  } else {
    // Verification failed
    console.warn("[Webhook] Verification failed");
    res.status(403).json({
      success: false,
      error: "Webhook verification failed",
      code: ERROR_CODES.WEBHOOK_VERIFICATION_FAILED,
    });
  }
});

/**
 * @openapi
 * /webhooks/strava:
 *   post:
 *     summary: Receive Strava webhook events
 *     description: |
 *       Called by Strava when users create/update/delete activities.
 *       Must respond within 2 seconds (Strava requirement).
 *       
 *       Events are queued for async processing - we don't process inline.
 *       
 *       **Note:** This endpoint is called by Strava, not by users.
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StravaWebhookPayload'
 *     responses:
 *       200:
 *         description: Event received (always returns 200 for valid payloads)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WebhookResponse'
 *       400:
 *         description: Invalid payload structure
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.post("/strava", async (req: Request, res: Response) => {
  const startTime = Date.now();

  // Log raw body for debugging (truncated)
  console.log("[Webhook] Received Strava event:", JSON.stringify(req.body).slice(0, 200));

  // Step 1: Validate payload structure
  if (!isValidWebhookPayload(req.body)) {
    console.warn("[Webhook] Invalid payload structure");
    res.status(400).json({
      success: false,
      error: "Invalid webhook payload",
      code: ERROR_CODES.WEBHOOK_INVALID_SIGNATURE,
    });
    return;
  }

  try {
    // Step 2: Process the event
    // This is fast (<100ms) because it only queues a job
    const result = await handleWebhookEvent(req.body);

    // Step 3: Check if we're within Strava's time limit
    const processingTime = Date.now() - startTime;
    if (processingTime > STRAVA_WEBHOOK.MAX_RESPONSE_TIME_MS) {
      console.warn(
        `[Webhook] Response took ${processingTime}ms (limit: ${STRAVA_WEBHOOK.MAX_RESPONSE_TIME_MS}ms)`
      );
    }

    // Step 4: Respond with success
    // Always return 200 to prevent Strava retries for intentional skips
    res.status(200).json({
      status: "received",
      action: result.action,
      ...(result.jobId && { jobId: result.jobId }),
      ...(result.reason && { reason: result.reason }),
      processingTimeMs: processingTime,
    });

  } catch (error) {
    // Log error but still return 200 to prevent retries
    // The error is logged and we can investigate manually
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[Webhook] Error handling event:", errorMessage);

    res.status(200).json({
      status: "received",
      action: "error",
      error: "Internal processing error",
      // Don't expose error details externally
    });
  }
});

// ============================================
// Utility Endpoints (for development/setup)
// ============================================

/**
 * GET /api/v1/webhooks/strava/info
 * 
 * Get webhook subscription setup information.
 * Useful for initial setup and debugging.
 * 
 * Only available in development mode.
 */
router.get("/strava/info", async (req: Request, res: Response) => {
  // Only allow in development
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({
      success: false,
      error: "Not found",
    });
    return;
  }

  const info = getSubscriptionInfo();

  res.status(200).json({
    success: true,
    subscription: info,
  });
});

export default router;
