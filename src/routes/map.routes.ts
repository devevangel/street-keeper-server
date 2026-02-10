/**
 * Map API Endpoints
 * Serves street progress with geometry for the home page map view
 *
 * ENDPOINTS:
 * ----------
 * | Method | Path           | Description                    | Auth |
 * |--------|----------------|--------------------------------|------|
 * | GET    | /map/streets   | Get user's streets in area     | Yes  |
 *
 * All routes require authentication. User ID is taken from req.user.
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getMapStreets } from "../services/map.service.js";
import { ERROR_CODES, MAP } from "../config/constants.js";

const router = Router();

router.use(requireAuth);

// ============================================
// GET /map/streets
// ============================================

/**
 * @openapi
 * /map/streets:
 *   get:
 *     tags:
 *       - Map
 *     summary: Get streets the user has run on in an area
 *     description: Returns street progress with geometry for the home page map. Streets are marked completed (green) or partial (yellow). Includes stats for the info icon popup.
 *     parameters:
 *       - in: query
 *         name: lat
 *         required: true
 *         schema: { type: number, format: double }
 *         description: Center latitude
 *       - in: query
 *         name: lng
 *         required: true
 *         schema: { type: number, format: double }
 *         description: Center longitude
 *       - in: query
 *         name: radius
 *         required: false
 *         schema: { type: integer, default: 2000 }
 *         description: Radius in meters (100-10000)
 *       - in: query
 *         name: minProgress
 *         required: false
 *         schema: { type: number, minimum: 0, maximum: 100, default: 45 }
 *         description: Only return streets with progress >= this percentage (0-100). Default 45 for homepage; use 0 for all streets with any progress.
 *     responses:
 *       200:
 *         description: Map streets with geometry and stats
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/MapStreetsResponse" }
 *       400:
 *         description: Invalid lat, lng, or radius
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiErrorResponse" }
 *       401:
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/ApiErrorResponse" }
 */
router.get("/streets", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { user: { id: string } }).user.id;

  const latRaw = req.query.lat;
  const lngRaw = req.query.lng;
  const radiusRaw = req.query.radius;

  const lat = typeof latRaw === "string" ? parseFloat(latRaw) : Number(latRaw);
  const lng = typeof lngRaw === "string" ? parseFloat(lngRaw) : Number(lngRaw);
  const radius =
    radiusRaw !== undefined
      ? typeof radiusRaw === "string"
        ? parseInt(radiusRaw, 10)
        : Number(radiusRaw)
      : MAP.DEFAULT_RADIUS_METERS;

  const minProgressRaw = req.query.minProgress;
  const minProgress =
    minProgressRaw !== undefined
      ? typeof minProgressRaw === "string"
        ? parseFloat(minProgressRaw)
        : Number(minProgressRaw)
      : 45;
  const minPercentage =
    Number.isNaN(minProgress) || minProgress < 0 || minProgress > 100
      ? 45
      : minProgress;

  if (Number.isNaN(lat) || lat < -90 || lat > 90) {
    res.status(400).json({
      success: false,
      error: "Invalid or missing latitude. Must be between -90 and 90.",
      code: ERROR_CODES.MAP_INVALID_COORDINATES,
    });
    return;
  }

  if (Number.isNaN(lng) || lng < -180 || lng > 180) {
    res.status(400).json({
      success: false,
      error: "Invalid or missing longitude. Must be between -180 and 180.",
      code: ERROR_CODES.MAP_INVALID_COORDINATES,
    });
    return;
  }

  if (
    Number.isNaN(radius) ||
    radius < MAP.MIN_RADIUS_METERS ||
    radius > MAP.MAX_RADIUS_METERS
  ) {
    res.status(400).json({
      success: false,
      error: `Invalid radius. Must be between ${MAP.MIN_RADIUS_METERS} and ${MAP.MAX_RADIUS_METERS} meters.`,
      code: ERROR_CODES.MAP_RADIUS_TOO_LARGE,
    });
    return;
  }

  try {
    const result = await getMapStreets(userId, lat, lng, radius, minPercentage);
    res.json(result);
  } catch (error) {
    console.error("[Map] Error fetching map streets:", error);
    res.status(500).json({
      success: false,
      error: "Failed to load map streets",
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
});

export default router;
