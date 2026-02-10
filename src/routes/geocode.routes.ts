/**
 * Geocode API
 * Universal location search (addresses, places, POIs) via Nominatim.
 * No auth required - used on project creation page before user has a project.
 */

import { Router, Request, Response } from "express";
import { searchLocation } from "../services/geocoding.service.js";

const router = Router();

/**
 * GET /geocode?q=...&limit=5&countrycodes=gb
 * Search for locations. q is required; limit defaults to 5.
 */
router.get("/", async (req: Request, res: Response) => {
  const q = req.query.q as string | undefined;
  if (!q || typeof q !== "string") {
    return res.status(400).json({
      success: false,
      error: "Query parameter 'q' is required",
    });
  }

  const limit = req.query.limit
    ? Math.min(Math.max(1, parseInt(String(req.query.limit), 10)), 10)
    : 5;
  const countrycodes = req.query.countrycodes as string | undefined;

  let viewbox: [number, number, number, number] | undefined;
  if (req.query.viewbox && typeof req.query.viewbox === "string") {
    const parts = req.query.viewbox.split(",").map(parseFloat);
    if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
      viewbox = parts as [number, number, number, number];
    }
  }

  try {
    const results = await searchLocation(q, {
      limit,
      countrycodes,
      viewbox,
    });
    return res.json({
      success: true,
      results,
    });
  } catch (err) {
    console.error("[geocode] search failed:", err);
    return res.status(502).json({
      success: false,
      error: "Search failed. Please try again.",
    });
  }
});

export default router;
