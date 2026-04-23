/**
 * Run celebrations API (Phase 1 — backend only; UI in Phase 2)
 *
 * GET  /celebrations/pending
 * GET  /celebrations/map-data?eventIds=uuid,uuid2
 * POST /celebrations/acknowledge
 * POST /celebrations/share-to-strava
 */
import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  acknowledgeCelebrations,
  getPendingCelebrationBatch,
  shareBatchToStrava,
} from "../services/celebration.service.js";
import { getCelebrationMapData } from "../services/celebration-map.service.js";
import { StravaApiError } from "../services/strava.service.js";

const router = Router();

router.use(requireAuth);

router.get("/map-data", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { user: { id: string } }).user.id;
  const raw = req.query.eventIds;
  const parts = Array.isArray(raw)
    ? raw.flatMap((r) => String(r).split(","))
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  const eventIds = parts.map((s) => s.trim()).filter(Boolean);
  if (eventIds.length === 0) {
    res.status(400).json({
      success: false,
      error: "eventIds query parameter is required (comma-separated UUIDs)",
    });
    return;
  }
  try {
    const data = await getCelebrationMapData(userId, eventIds);
    res.json(data);
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      res.status(404).json({ success: false, error: err.message });
      return;
    }
    console.error("[Celebrations] GET /map-data error:", err);
    res.status(500).json({ success: false, error: "Failed to load celebration map data" });
  }
});

router.get("/pending", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { user: { id: string } }).user.id;
  try {
    const batch = await getPendingCelebrationBatch(userId);
    res.json({
      success: true,
      hasPending: batch.events.length > 0,
      ...batch,
    });
  } catch (err) {
    console.error("[Celebrations] GET /pending error:", err);
    res.status(500).json({ success: false, error: "Failed to load pending celebrations" });
  }
});

router.post("/acknowledge", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { user: { id: string } }).user.id;
  const body = req.body as { eventIds?: string[] };
  try {
    const result = await acknowledgeCelebrations(userId, body.eventIds);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[Celebrations] POST /acknowledge error:", err);
    res.status(500).json({ success: false, error: "Failed to acknowledge celebrations" });
  }
});

router.post("/share-to-strava", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { user: { id: string } }).user.id;
  const body = req.body as { eventIds?: string[] };
  if (!body.eventIds?.length) {
    res.status(400).json({
      success: false,
      error: "eventIds is required and must be non-empty",
    });
    return;
  }
  try {
    const result = await shareBatchToStrava(userId, body.eventIds);
    res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof StravaApiError) {
      if (err.code === "TOKEN_INVALID") {
        res.status(401).json({
          success: false,
          error: err.message,
          code: err.code,
        });
        return;
      }
      if (err.code === "SCOPE_MISSING") {
        res.status(403).json({
          success: false,
          error: err.message,
          code: err.code,
        });
        return;
      }
    }
    if (err instanceof Error && err.message.includes("not found")) {
      res.status(404).json({ success: false, error: err.message });
      return;
    }
    console.error("[Celebrations] POST /share-to-strava error:", err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to update Strava",
    });
  }
});

export default router;
