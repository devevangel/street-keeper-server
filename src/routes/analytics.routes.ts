/**
 * Analytics API – client event ingestion
 *
 * POST /analytics/events – batch ingest events (homepage_viewed, suggestion_opened, etc.)
 */
import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { trackEventsBatch } from "../services/analytics.service.js";
import type { AnalyticsEventsBatchRequest } from "../types/analytics.types.js";

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /analytics/events:
 *   post:
 *     summary: Ingest analytics events (batch)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [events]
 *             properties:
 *               events:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [event]
 *                   properties:
 *                     event: { type: string }
 *                     properties: { type: object }
 *                     sessionId: { type: string }
 *                     timestamp: { type: string, format: date-time }
 *     responses:
 *       200: { description: Events stored }
 *       400: { description: Invalid payload }
 */
router.post("/events", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { user: { id: string } }).user?.id ?? null;
  const body = req.body as AnalyticsEventsBatchRequest;

  if (!body?.events || !Array.isArray(body.events)) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_PAYLOAD", message: "Missing or invalid 'events' array" },
    });
    return;
  }

  const events = body.events.slice(0, 50).map((e) => ({
    event: e.event,
    properties: e.properties,
    sessionId: e.sessionId,
    timestamp: e.timestamp,
  }));

  await trackEventsBatch(userId, events);
  res.json({ success: true });
});

export default router;
