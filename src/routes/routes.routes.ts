/**
 * Routes API Endpoints
 * CRUD operations for user routes (geographic areas for street tracking)
 * 
 * ENDPOINTS OVERVIEW:
 * -------------------
 * 
 * | Method | Path                    | Description                    | Auth |
 * |--------|-------------------------|--------------------------------|------|
 * | GET    | /routes/preview         | Preview streets before create  | Yes  |
 * | GET    | /routes                 | List user's routes             | Yes  |
 * | POST   | /routes                 | Create a new route             | Yes  |
 * | GET    | /routes/:id             | Get route detail               | Yes  |
 * | DELETE | /routes/:id             | Archive (soft delete) route    | Yes  |
 * | POST   | /routes/:id/refresh     | Refresh street snapshot        | Yes  |
 * | GET    | /routes/:id/activities  | Get activities for a route     | Yes  |
 * 
 * ROUTE LIFECYCLE:
 * ----------------
 * 
 * 1. **Preview** (optional): User previews area to see street count
 *    GET /routes/preview?lat=50.788&lng=-1.089&radius=2000
 * 
 * 2. **Create**: User creates route with name and location
 *    POST /routes { name, centerLat, centerLng, radiusMeters, cacheKey? }
 * 
 * 3. **View**: User views route detail with street progress
 *    GET /routes/:id
 * 
 * 4. **Refresh**: System suggests refresh after 30 days
 *    POST /routes/:id/refresh
 * 
 * 5. **Archive**: User removes route (soft delete)
 *    DELETE /routes/:id
 * 
 * AUTHENTICATION:
 * ---------------
 * All endpoints require authentication via the `requireAuth` middleware.
 * The authenticated user is available via `req.user`.
 */

import { Router, Request, Response } from "express";
import {
  previewRoute,
  createRoute,
  listRoutes,
  getRouteById,
  archiveRoute,
  refreshRouteSnapshot,
  RouteNotFoundError,
  RouteAccessDeniedError,
} from "../services/route.service.js";
import { listActivitiesForRoute } from "../services/activity.service.js";
import { ERROR_CODES, ROUTES } from "../config/constants.js";
import { OverpassError } from "../services/overpass.service.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import type { CreateRouteInput } from "../types/route.types.js";

const router = Router();

// ============================================
// Apply authentication to all routes
// ============================================

/**
 * All routes in this router require authentication.
 * The user object is attached to req.user by the middleware.
 */
router.use(requireAuth);

// ============================================
// Route Preview
// ============================================

/**
 * @openapi
 * /routes/preview:
 *   get:
 *     summary: Preview streets before creating a route
 *     description: |
 *       Preview the streets in an area before committing to create a route.
 *       Returns street count, total length, and warnings about the area.
 *       
 *       Uses smart caching:
 *       - First request for an area queries Overpass and caches result
 *       - Subsequent requests (same or smaller radius) use cache
 *       - Pass the returned `cacheKey` to the create endpoint to skip re-query
 *     tags: [Routes]
 *     security:
 *       - DevAuth: []
 *     parameters:
 *       - in: query
 *         name: lat
 *         required: true
 *         schema:
 *           type: number
 *           minimum: -90
 *           maximum: 90
 *         description: Center latitude
 *         example: 50.788
 *       - in: query
 *         name: lng
 *         required: true
 *         schema:
 *           type: number
 *           minimum: -180
 *           maximum: 180
 *         description: Center longitude
 *         example: -1.089
 *       - in: query
 *         name: radius
 *         required: true
 *         schema:
 *           type: integer
 *           enum: [500, 1000, 2000, 5000, 10000]
 *         description: Radius in meters
 *         example: 2000
 *     responses:
 *       200:
 *         description: Preview data with street counts
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RoutePreviewResponse'
 *       400:
 *         description: Invalid parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       502:
 *         description: Overpass API error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.get("/preview", async (req: Request, res: Response) => {
  // Parse and validate query parameters
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const radius = parseInt(req.query.radius as string, 10);

  // Validate lat/lng
  if (isNaN(lat) || lat < -90 || lat > 90) {
    res.status(400).json({
      success: false,
      error: "Invalid latitude. Must be between -90 and 90.",
      code: ERROR_CODES.VALIDATION_ERROR,
    });
    return;
  }

  if (isNaN(lng) || lng < -180 || lng > 180) {
    res.status(400).json({
      success: false,
      error: "Invalid longitude. Must be between -180 and 180.",
      code: ERROR_CODES.VALIDATION_ERROR,
    });
    return;
  }

  // Validate radius
  if (isNaN(radius) || !ROUTES.ALLOWED_RADII.includes(radius as typeof ROUTES.ALLOWED_RADII[number])) {
    res.status(400).json({
      success: false,
      error: `Invalid radius. Must be one of: ${ROUTES.ALLOWED_RADII.join(", ")} meters.`,
      code: ERROR_CODES.ROUTE_INVALID_RADIUS,
    });
    return;
  }

  try {
    const preview = await previewRoute(lat, lng, radius);

    res.status(200).json({
      success: true,
      preview,
    });
  } catch (error) {
    if (error instanceof OverpassError) {
      res.status(502).json({
        success: false,
        error: "Failed to query street data. Please try again.",
        code: ERROR_CODES.OVERPASS_ERROR,
      });
      return;
    }

    console.error("[Routes] Preview error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
});

// ============================================
// List Routes
// ============================================

/**
 * @openapi
 * /routes:
 *   get:
 *     summary: List user's routes
 *     description: Returns all routes for the authenticated user with summary data (without full street arrays).
 *     tags: [Routes]
 *     security:
 *       - DevAuth: []
 *     parameters:
 *       - in: query
 *         name: includeArchived
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include archived routes
 *     responses:
 *       200:
 *         description: Array of route summaries
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RouteListResponse'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.get("/", async (req: Request, res: Response) => {
  // User is guaranteed to exist due to requireAuth middleware
  const userId = req.user!.id;
  const includeArchived = req.query.includeArchived === "true";

  try {
    const routes = await listRoutes(userId, includeArchived);

    res.status(200).json({
      success: true,
      routes,
      total: routes.length,
    });
  } catch (error) {
    console.error("[Routes] List error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
});

// ============================================
// Create Route
// ============================================

/**
 * @openapi
 * /routes:
 *   post:
 *     summary: Create a new route
 *     description: |
 *       Create a new route for the authenticated user. Queries OpenStreetMap for streets
 *       in the specified area and creates a snapshot for progress tracking.
 *       
 *       **Tip:** Call `/routes/preview` first and pass the returned `cacheKey` to skip
 *       the Overpass query and speed up route creation.
 *     tags: [Routes]
 *     security:
 *       - DevAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateRouteRequest'
 *     responses:
 *       201:
 *         description: Route created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   enum: [true]
 *                 route:
 *                   $ref: '#/components/schemas/RouteListItem'
 *                 message:
 *                   type: string
 *       400:
 *         description: Invalid input or no streets found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       502:
 *         description: Overpass API error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.post("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;

  // Validate request body
  const { name, centerLat, centerLng, radiusMeters, deadline, cacheKey } = req.body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({
      success: false,
      error: "Route name is required",
      code: ERROR_CODES.VALIDATION_ERROR,
    });
    return;
  }

  if (typeof centerLat !== "number" || centerLat < -90 || centerLat > 90) {
    res.status(400).json({
      success: false,
      error: "Invalid center latitude",
      code: ERROR_CODES.VALIDATION_ERROR,
    });
    return;
  }

  if (typeof centerLng !== "number" || centerLng < -180 || centerLng > 180) {
    res.status(400).json({
      success: false,
      error: "Invalid center longitude",
      code: ERROR_CODES.VALIDATION_ERROR,
    });
    return;
  }

  if (!ROUTES.ALLOWED_RADII.includes(radiusMeters)) {
    res.status(400).json({
      success: false,
      error: `Invalid radius. Must be one of: ${ROUTES.ALLOWED_RADII.join(", ")} meters.`,
      code: ERROR_CODES.ROUTE_INVALID_RADIUS,
    });
    return;
  }

  try {
    const input: CreateRouteInput = {
      name: name.trim(),
      centerLat,
      centerLng,
      radiusMeters,
      deadline,
    };

    const route = await createRoute(userId, input, cacheKey);

    res.status(201).json({
      success: true,
      route,
      message: `Route "${route.name}" created with ${route.totalStreets} streets`,
    });
  } catch (error) {
    if (error instanceof OverpassError) {
      res.status(502).json({
        success: false,
        error: "Failed to query street data. Please try again.",
        code: ERROR_CODES.OVERPASS_ERROR,
      });
      return;
    }

    if (error instanceof Error && error.message.includes("No streets found")) {
      res.status(400).json({
        success: false,
        error: error.message,
        code: ERROR_CODES.ROUTE_NO_STREETS,
      });
      return;
    }

    console.error("[Routes] Create error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
});

// ============================================
// Get Route Detail
// ============================================

/**
 * @openapi
 * /routes/{id}:
 *   get:
 *     summary: Get route detail
 *     description: |
 *       Get full route detail including all streets and their progress.
 *       May include a warning if the street data is stale (>30 days old).
 *     tags: [Routes]
 *     security:
 *       - DevAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Route ID
 *     responses:
 *       200:
 *         description: Route detail with streets
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RouteDetailResponse'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Access denied (not route owner)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Route not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.get("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const routeId = req.params.id;

  try {
    const { route, warning } = await getRouteById(routeId, userId);

    res.status(200).json({
      success: true,
      route,
      ...(warning && { warning }),
    });
  } catch (error) {
    if (error instanceof RouteNotFoundError) {
      res.status(404).json({
        success: false,
        error: "Route not found",
        code: ERROR_CODES.ROUTE_NOT_FOUND,
      });
      return;
    }

    if (error instanceof RouteAccessDeniedError) {
      res.status(403).json({
        success: false,
        error: "Access denied to this route",
        code: ERROR_CODES.ROUTE_ACCESS_DENIED,
      });
      return;
    }

    console.error("[Routes] Get detail error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
});

// ============================================
// Archive Route (Soft Delete)
// ============================================

/**
 * @openapi
 * /routes/{id}:
 *   delete:
 *     summary: Archive a route
 *     description: |
 *       Soft-delete a route. The route data is preserved but hidden from the list view.
 *       Can be restored by querying with `includeArchived=true`.
 *     tags: [Routes]
 *     security:
 *       - DevAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Route ID
 *     responses:
 *       200:
 *         description: Route archived successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   enum: [true]
 *                 message:
 *                   type: string
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Access denied
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Route not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.delete("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const routeId = req.params.id;

  try {
    await archiveRoute(routeId, userId);

    res.status(200).json({
      success: true,
      message: "Route archived successfully",
    });
  } catch (error) {
    if (error instanceof RouteNotFoundError) {
      res.status(404).json({
        success: false,
        error: "Route not found",
        code: ERROR_CODES.ROUTE_NOT_FOUND,
      });
      return;
    }

    if (error instanceof RouteAccessDeniedError) {
      res.status(403).json({
        success: false,
        error: "Access denied to this route",
        code: ERROR_CODES.ROUTE_ACCESS_DENIED,
      });
      return;
    }

    console.error("[Routes] Archive error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
});

// ============================================
// Refresh Route Snapshot
// ============================================

/**
 * @openapi
 * /routes/{id}/refresh:
 *   post:
 *     summary: Refresh route street data
 *     description: |
 *       Re-query OpenStreetMap for current streets and merge with existing progress.
 *       Use this when streets have been added or removed in the area, or when the
 *       route warning indicates stale data.
 *       
 *       **Progress is preserved:** Existing street progress is maintained. New streets
 *       start at 0%, and removed streets are marked but not deleted immediately.
 *     tags: [Routes]
 *     security:
 *       - DevAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Route ID
 *     responses:
 *       200:
 *         description: Route refreshed with change summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   enum: [true]
 *                 route:
 *                   $ref: '#/components/schemas/RouteDetail'
 *                 changes:
 *                   type: object
 *                   properties:
 *                     added:
 *                       type: integer
 *                     removed:
 *                       type: integer
 *                 message:
 *                   type: string
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       403:
 *         description: Access denied
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Route not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       502:
 *         description: Overpass API error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.post("/:id/refresh", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const routeId = req.params.id;

  try {
    const { route, changes } = await refreshRouteSnapshot(routeId, userId);

    res.status(200).json({
      success: true,
      route,
      changes: {
        added: changes.added.length,
        removed: changes.removed.length,
      },
      message: `Refresh complete: ${changes.added.length} streets added, ${changes.removed.length} removed`,
    });
  } catch (error) {
    if (error instanceof RouteNotFoundError) {
      res.status(404).json({
        success: false,
        error: "Route not found",
        code: ERROR_CODES.ROUTE_NOT_FOUND,
      });
      return;
    }

    if (error instanceof RouteAccessDeniedError) {
      res.status(403).json({
        success: false,
        error: "Access denied to this route",
        code: ERROR_CODES.ROUTE_ACCESS_DENIED,
      });
      return;
    }

    if (error instanceof OverpassError) {
      res.status(502).json({
        success: false,
        error: "Failed to refresh street data. Please try again.",
        code: ERROR_CODES.OVERPASS_ERROR,
      });
      return;
    }

    console.error("[Routes] Refresh error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
});

// ============================================
// Get Route Activities
// ============================================

/**
 * @openapi
 * /routes/{id}/activities:
 *   get:
 *     summary: Get activities for a route
 *     description: Returns all activities that contributed to this route's progress, with their impact details.
 *     tags: [Routes]
 *     security:
 *       - DevAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Route ID
 *     responses:
 *       200:
 *         description: List of activities with route impact
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   enum: [true]
 *                 activities:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       activityId:
 *                         type: string
 *                       activityName:
 *                         type: string
 *                       date:
 *                         type: string
 *                         format: date-time
 *                       distanceMeters:
 *                         type: number
 *                       streetsCompleted:
 *                         type: integer
 *                       streetsImproved:
 *                         type: integer
 *                 total:
 *                   type: integer
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Route not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.get("/:id/activities", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const routeId = req.params.id;

  try {
    const activities = await listActivitiesForRoute(routeId, userId);

    res.status(200).json({
      success: true,
      activities,
      total: activities.length,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      res.status(404).json({
        success: false,
        error: "Route not found",
        code: ERROR_CODES.ROUTE_NOT_FOUND,
      });
      return;
    }

    console.error("[Routes] Get activities error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
});

export default router;
