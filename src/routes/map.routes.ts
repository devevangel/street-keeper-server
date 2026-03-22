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
import { getMapStreets, getMapTraces } from "../services/map.service.js";
import { ERROR_CODES, MAP } from "../config/constants.js";

const TRACES_DEFAULT_RADIUS = 5000;

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
    console.log(`[Map] GET /streets — user: ${userId.slice(0, 8)}… lat: ${lat.toFixed(4)}, lng: ${lng.toFixed(4)}, radius: ${radius}, minProgress: ${minPercentage}`);
    const result = await getMapStreets(userId, lat, lng, radius, minPercentage);
    const streetCount = result.streets?.length ?? 0;
    const completedCount = result.streets?.filter((s: { status: string }) => s.status === "completed").length ?? 0;
    console.log(`[Map] GET /streets — returned ${streetCount} streets (${completedCount} completed)`);
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

// ============================================
// GET /map/traces
// ============================================

/**
 * @openapi
 * /map/traces:
 *   get:
 *     tags:
 *       - Map
 *     summary: Get simplified GPS traces for the user's activities
 *     description: Returns activity paths as simplified [lat, lng] polylines for map rendering. Optional lat/lng/radius filter.
 *     parameters:
 *       - in: query
 *         name: lat
 *         required: false
 *         schema: { type: number, format: double }
 *         description: Center latitude (optional; when provided with lng, only traces intersecting the area are returned)
 *       - in: query
 *         name: lng
 *         required: false
 *         schema: { type: number, format: double }
 *         description: Center longitude
 *       - in: query
 *         name: radius
 *         required: false
 *         schema: { type: integer, default: 5000 }
 *         description: Radius in meters for area filter
 *     responses:
 *       200:
 *         description: List of GPS traces (activityId, name, startDate, coordinates)
 *       400:
 *         description: Invalid lat/lng when provided
 *       401:
 *         description: Authentication required
 */
router.get("/traces", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { user: { id: string } }).user.id;

  const latRaw = req.query.lat;
  const lngRaw = req.query.lng;
  const radiusRaw = req.query.radius;

  const lat =
    latRaw !== undefined
      ? typeof latRaw === "string"
        ? parseFloat(latRaw)
        : Number(latRaw)
      : undefined;
  const lng =
    lngRaw !== undefined
      ? typeof lngRaw === "string"
        ? parseFloat(lngRaw)
        : Number(lngRaw)
      : undefined;
  const radius =
    radiusRaw !== undefined
      ? typeof radiusRaw === "string"
        ? parseInt(radiusRaw, 10)
        : Number(radiusRaw)
      : TRACES_DEFAULT_RADIUS;

  if (lat !== undefined && (Number.isNaN(lat) || lat < -90 || lat > 90)) {
    res.status(400).json({
      success: false,
      error: "Invalid latitude. Must be between -90 and 90.",
      code: ERROR_CODES.MAP_INVALID_COORDINATES,
    });
    return;
  }
  if (lng !== undefined && (Number.isNaN(lng) || lng < -180 || lng > 180)) {
    res.status(400).json({
      success: false,
      error: "Invalid longitude. Must be between -180 and 180.",
      code: ERROR_CODES.MAP_INVALID_COORDINATES,
    });
    return;
  }

  const radiusClamped = Math.min(
    Math.max(radius, MAP.MIN_RADIUS_METERS),
    MAP.MAX_RADIUS_METERS
  );

  try {
    const result = await getMapTraces(
      userId,
      lat,
      lng,
      radiusClamped
    );
    res.json(result);
  } catch (error) {
    console.error("[Map] Error fetching map traces:", error);
    res.status(500).json({
      success: false,
      error: "Failed to load traces",
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
});

export default router;
