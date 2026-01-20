/**
 * Webhook Service
 * Handles Strava webhook events and subscription management
 * 
 * STRAVA WEBHOOK FLOW:
 * --------------------
 * 
 * 1. **Subscription Setup** (one-time):
 *    - We register a webhook endpoint with Strava
 *    - Strava sends a verification GET request with a challenge
 *    - We echo the challenge back to verify ownership
 * 
 * 2. **Event Reception** (ongoing):
 *    - User creates/updates/deletes an activity on Strava
 *    - Strava sends a POST to our webhook endpoint
 *    - We MUST respond within 2 seconds (or Strava retries)
 *    - We queue the event for async processing
 * 
 * WEBHOOK PAYLOAD EXAMPLE:
 * ------------------------
 * 
 * ```json
 * {
 *   "object_type": "activity",
 *   "object_id": 12345678,      // Strava activity ID
 *   "aspect_type": "create",     // create | update | delete
 *   "owner_id": 67890,           // Strava athlete ID
 *   "subscription_id": 12345,
 *   "event_time": 1674123456     // Unix timestamp
 * }
 * ```
 * 
 * WHY QUEUE INSTEAD OF PROCESS DIRECTLY:
 * --------------------------------------
 * - Strava requires response within 2 seconds
 * - Activity processing takes 5-30+ seconds (Strava API, Mapbox, Overpass)
 * - Queuing is instant (~5ms), then worker processes at its own pace
 * - Retries are automatic if processing fails
 * 
 * @see https://developers.strava.com/docs/webhooks/
 */

import prisma from "../lib/prisma.js";
import { STRAVA_WEBHOOK, ERROR_CODES } from "../config/constants.js";
import {
  addActivityProcessingJob,
  isActivityJobQueued,
  isQueueAvailable,
  QueueUnavailableError,
} from "../queues/activity.queue.js";
import type { StravaWebhookPayload, StravaWebhookVerifyQuery } from "../types/activity.types.js";

// ============================================
// Webhook Verification (Subscription Setup)
// ============================================

/**
 * Handle Strava webhook verification request
 * 
 * When you create a webhook subscription, Strava sends a GET request
 * to verify you own the endpoint. We must echo back the challenge.
 * 
 * Verification Flow:
 * 1. Strava sends: GET /webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=RANDOM_STRING
 * 2. We verify hub.mode is "subscribe"
 * 3. We verify hub.verify_token matches our configured token
 * 4. We respond with: { "hub.challenge": "RANDOM_STRING" }
 * 
 * @param query - Query parameters from Strava
 * @returns Challenge response or null if invalid
 * 
 * @example
 * // In route handler:
 * const response = verifyWebhookSubscription(req.query);
 * if (response) {
 *   res.json(response);
 * } else {
 *   res.status(403).json({ error: "Verification failed" });
 * }
 */
export function verifyWebhookSubscription(
  query: StravaWebhookVerifyQuery
): { "hub.challenge": string } | null {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];

  // All parameters must be present
  if (!mode || !token || !challenge) {
    console.warn("[Webhook] Verification missing parameters");
    return null;
  }

  // Mode must be "subscribe"
  if (mode !== "subscribe") {
    console.warn(`[Webhook] Invalid mode: ${mode}`);
    return null;
  }

  // Verify token matches our configured token
  // The verify token should be set when creating the subscription
  const expectedToken = getWebhookVerifyToken();
  if (token !== expectedToken) {
    console.warn("[Webhook] Invalid verify token");
    return null;
  }

  console.log("[Webhook] Subscription verified successfully");

  // Echo the challenge back to Strava
  return { "hub.challenge": challenge };
}

/**
 * Get the webhook verification token
 * 
 * This token is set when creating the webhook subscription and
 * must match what Strava sends during verification.
 */
export function getWebhookVerifyToken(): string {
  // Use environment variable, or default for development
  return process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || "street-keeper-verify-token";
}

// ============================================
// Webhook Event Processing
// ============================================

/**
 * Handle an incoming Strava webhook event
 * 
 * This is called when Strava sends a POST to our webhook endpoint.
 * We validate the event, check if we should process it, and queue
 * a job if appropriate.
 * 
 * IMPORTANT: This function must complete quickly (<2s) to satisfy
 * Strava's requirements. All heavy processing is done async via queue.
 * 
 * @param payload - Webhook payload from Strava
 * @returns Result indicating what action was taken
 * 
 * @example
 * const result = await handleWebhookEvent(req.body);
 * // result: { action: "queued", jobId: "..." }
 * // result: { action: "skipped", reason: "unsupported_event" }
 * // result: { action: "skipped", reason: "user_not_found" }
 */
export async function handleWebhookEvent(
  payload: StravaWebhookPayload
): Promise<WebhookEventResult> {
  const startTime = Date.now();

  console.log(
    `[Webhook] Received event: ${payload.object_type}/${payload.aspect_type} ` +
    `(object_id: ${payload.object_id}, owner_id: ${payload.owner_id})`
  );

  // Step 1: Validate event type
  // We only care about activity creates
  if (!isEventSupported(payload)) {
    const reason = `unsupported_event:${payload.object_type}/${payload.aspect_type}`;
    console.log(`[Webhook] Skipping: ${reason}`);
    return { action: "skipped", reason };
  }

  // Step 2: Find user by Strava athlete ID
  const user = await findUserByStravaId(payload.owner_id);

  if (!user) {
    console.log(`[Webhook] Skipping: user not found for athlete ${payload.owner_id}`);
    return { action: "skipped", reason: "user_not_found" };
  }

  // Step 3: Check if job already queued (deduplication)
  const stravaActivityId = String(payload.object_id);
  const alreadyQueued = await isActivityJobQueued(stravaActivityId);

  if (alreadyQueued) {
    console.log(`[Webhook] Skipping: job already queued for activity ${stravaActivityId}`);
    return { action: "skipped", reason: "already_queued" };
  }

  // Step 4: Queue job for async processing
  try {
    const jobId = await addActivityProcessingJob({
      stravaActivityId,
      ownerId: payload.owner_id,
      userId: user.id,
      eventTime: payload.event_time,
    });

    const processingTime = Date.now() - startTime;
    console.log(
      `[Webhook] Queued job ${jobId} for activity ${stravaActivityId} ` +
      `(${processingTime}ms)`
    );

    return {
      action: "queued",
      jobId,
      processingTimeMs: processingTime,
    };
  } catch (error) {
    // Handle queue unavailable (Redis not running)
    if (error instanceof QueueUnavailableError) {
      console.warn(`[Webhook] Queue unavailable: ${error.message}`);
      return {
        action: "error",
        error: "Queue unavailable - Redis may not be running",
      };
    }
    throw error;
  }
}

/**
 * Check if event type is supported
 * 
 * We only process:
 * - object_type: "activity" (not "athlete")
 * - aspect_type: "create" (not "update" or "delete")
 */
function isEventSupported(payload: StravaWebhookPayload): boolean {
  return (
    payload.object_type === STRAVA_WEBHOOK.SUPPORTED_EVENTS.OBJECT_TYPE &&
    payload.aspect_type === STRAVA_WEBHOOK.SUPPORTED_EVENTS.ASPECT_TYPE
  );
}

/**
 * Find user by Strava athlete ID
 * 
 * @param stravaAthleteId - Strava athlete ID (owner_id from webhook)
 * @returns User if found, null otherwise
 */
async function findUserByStravaId(
  stravaAthleteId: number
): Promise<{ id: string; stravaId: string } | null> {
  const user = await prisma.user.findFirst({
    where: {
      stravaId: String(stravaAthleteId),
    },
    select: {
      id: true,
      stravaId: true,
    },
  });

  return user;
}

// ============================================
// Type Definitions
// ============================================

/**
 * Result of handling a webhook event
 */
export interface WebhookEventResult {
  /** Action taken: queued, skipped, or error */
  action: "queued" | "skipped" | "error";
  /** Job ID if queued */
  jobId?: string;
  /** Reason if skipped */
  reason?: string;
  /** Error message if error */
  error?: string;
  /** Processing time in milliseconds */
  processingTimeMs?: number;
}

// ============================================
// Subscription Management (for setup)
// ============================================

/**
 * Get webhook subscription info for manual setup
 * 
 * Returns the information needed to create a Strava webhook subscription.
 * You'll need to call the Strava API manually or use their web interface.
 * 
 * @returns Subscription configuration
 */
export function getSubscriptionInfo(): {
  callbackUrl: string;
  verifyToken: string;
  instructions: string[];
} {
  const baseUrl = process.env.BASE_URL || "http://localhost:8000";
  const callbackUrl = `${baseUrl}/api/v1/webhooks/strava`;
  const verifyToken = getWebhookVerifyToken();

  return {
    callbackUrl,
    verifyToken,
    instructions: [
      "To create a Strava webhook subscription:",
      "1. Go to your Strava API app settings",
      "2. Or use the API:",
      `   POST https://www.strava.com/api/v3/push_subscriptions`,
      `   Body: {`,
      `     "client_id": YOUR_CLIENT_ID,`,
      `     "client_secret": YOUR_CLIENT_SECRET,`,
      `     "callback_url": "${callbackUrl}",`,
      `     "verify_token": "${verifyToken}"`,
      `   }`,
      "3. Strava will call GET /webhooks/strava with a challenge",
      "4. Our server will respond with the challenge to verify",
    ],
  };
}

/**
 * Validate webhook payload structure
 * 
 * Basic validation that the payload has required fields.
 * 
 * @param payload - Raw payload from request body
 * @returns True if valid structure
 */
export function isValidWebhookPayload(
  payload: unknown
): payload is StravaWebhookPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const p = payload as Record<string, unknown>;

  return (
    typeof p.object_type === "string" &&
    typeof p.object_id === "number" &&
    typeof p.aspect_type === "string" &&
    typeof p.owner_id === "number" &&
    typeof p.subscription_id === "number" &&
    typeof p.event_time === "number"
  );
}
