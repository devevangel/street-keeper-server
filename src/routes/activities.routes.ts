/**
 * Activities API Endpoints
 * CRUD operations for user activities (runs/walks synced from Strava)
 * 
 * ENDPOINTS OVERVIEW:
 * -------------------
 * 
 * | Method | Path               | Description                    | Auth |
 * |--------|--------------------|--------------------------------|------|
 * | GET    | /activities        | List user's activities         | Yes  |
 * | GET    | /activities/:id    | Get activity detail            | Yes  |
 * | DELETE | /activities/:id    | Delete activity                | Yes  |
 * 
 * ACTIVITY LIFECYCLE:
 * -------------------
 * 
 * Activities are created automatically when:
 * 1. User completes a run/walk on Strava
 * 2. Strava sends webhook notification to our server
 * 3. Worker fetches activity data and saves it
 * 4. Worker processes activity against user's routes
 * 
 * Users can:
 * - View their activity history
 * - See how each activity contributed to route progress
 * - Delete activities (which recalculates route progress)
 * 
 * AUTHENTICATION:
 * ---------------
 * All endpoints require authentication via the `requireAuth` middleware.
 * The authenticated user is available via `req.user`.
 */

import { Router, Request, Response } from "express";
import {
  listActivities,
  getActivityById,
  deleteActivity,
  ActivityNotFoundError,
} from "../services/activity.service.js";
import { ERROR_CODES } from "../config/constants.js";
import { requireAuth } from "../middleware/auth.middleware.js";

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
// List Activities
// ============================================

/**
 * @openapi
 * /activities:
 *   get:
 *     summary: List user's activities
 *     description: Returns paginated list of activities for the authenticated user, most recent first.
 *     tags: [Activities]
 *     security:
 *       - DevAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Items per page
 *     responses:
 *       200:
 *         description: Paginated activity list
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ActivitiesListResponse'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.get("/", async (req: Request, res: Response) => {
  const userId = req.user!.id;

  // Parse pagination parameters
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(req.query.pageSize as string, 10) || 20)
  );

  try {
    const result = await listActivities(userId, { page, pageSize });

    res.status(200).json({
      success: true,
      activities: result.activities,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  } catch (error) {
    console.error("[Activities] List error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
});

// ============================================
// Get Activity Detail
// ============================================

/**
 * @openapi
 * /activities/{id}:
 *   get:
 *     summary: Get activity detail
 *     description: Returns full activity detail including GPS coordinates and route impact breakdown.
 *     tags: [Activities]
 *     security:
 *       - DevAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Activity ID
 *     responses:
 *       200:
 *         description: Activity detail with coordinates and route impacts
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ActivityDetailResponse'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Activity not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.get("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const activityId = req.params.id;

  try {
    const activity = await getActivityById(activityId, userId);

    res.status(200).json({
      success: true,
      activity,
    });
  } catch (error) {
    if (error instanceof ActivityNotFoundError) {
      res.status(404).json({
        success: false,
        error: "Activity not found",
        code: ERROR_CODES.ACTIVITY_NOT_FOUND,
      });
      return;
    }

    console.error("[Activities] Get detail error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
});

// ============================================
// Delete Activity
// ============================================

/**
 * @openapi
 * /activities/{id}:
 *   delete:
 *     summary: Delete an activity
 *     description: |
 *       Delete an activity and recalculate affected routes.
 *       
 *       **Warning:** This operation may decrease route progress as the activity's
 *       contribution is removed. Route recalculation happens in the background.
 *     tags: [Activities]
 *     security:
 *       - DevAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Activity ID
 *     responses:
 *       200:
 *         description: Activity deleted successfully
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
 *                 routesAffected:
 *                   type: integer
 *                   description: Number of routes that will be recalculated
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Activity not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.delete("/:id", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const activityId = req.params.id;

  try {
    const result = await deleteActivity(activityId, userId);

    res.status(200).json({
      success: true,
      message: "Activity deleted successfully",
      routesAffected: result.routesAffected,
    });
  } catch (error) {
    if (error instanceof ActivityNotFoundError) {
      res.status(404).json({
        success: false,
        error: "Activity not found",
        code: ERROR_CODES.ACTIVITY_NOT_FOUND,
      });
      return;
    }

    console.error("[Activities] Delete error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
});

export default router;
