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
 * | POST   | /activities/sync   | Sync recent activities from Strava | Yes  |
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
import prisma from "../lib/prisma.js";
import {
  listActivities,
  getActivityById,
  deleteActivity,
  ActivityNotFoundError,
} from "../services/activity.service.js";
import {
  syncRecentActivities,
  startBackgroundSync,
  SyncError,
} from "../services/sync.service.js";
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
// Sync status (must be before /sync to match /sync/status)
// ============================================

/**
 * @openapi
 * /activities/sync/status:
 *   get:
 *     summary: Get current background sync status
 *     description: Returns the latest SyncJob for the user (queued, running, completed, or failed). Used for polling to show progress. Returns idle status if no job exists.
 *     tags: [Activities]
 *     security:
 *       - DevAuth: []
 *     responses:
 *       200:
 *         description: Sync job status (active job) or idle status (no job)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 syncId:
 *                   type: string
 *                   format: uuid
 *                   nullable: true
 *                   description: Job ID if active, null if idle
 *                 status:
 *                   type: string
 *                   enum: [queued, running, completed, failed, idle]
 *                 type:
 *                   type: string
 *                   enum: [initial, incremental]
 *                   nullable: true
 *                 total:
 *                   type: integer
 *                 processed:
 *                   type: integer
 *                 skipped:
 *                   type: integer
 *                 errors:
 *                   type: integer
 *                 lastErrorMessage:
 *                   type: string
 *                   nullable: true
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 */
router.get("/sync/status", async (req: Request, res: Response) => {
  const userId = req.user!.id;

  try {
    const job = await prisma.syncJob.findFirst({
      where: { userId },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        status: true,
        type: true,
        total: true,
        processed: true,
        skipped: true,
        errors: true,
        lastErrorMessage: true,
        updatedAt: true,
      },
    });

    if (!job) {
      res.status(200).json({
        syncId: null,
        status: "idle",
        type: null,
        total: 0,
        processed: 0,
        skipped: 0,
        errors: 0,
        lastErrorMessage: null,
        updatedAt: null,
      });
      return;
    }

    res.status(200).json({
      syncId: job.id,
      status: job.status,
      type: job.type,
      total: job.total,
      processed: job.processed,
      skipped: job.skipped,
      errors: job.errors,
      lastErrorMessage: job.lastErrorMessage,
      updatedAt: job.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error("[Activities] GET /sync/status error:", err);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
});

// ============================================
// Sync from Strava (must be before /:id to avoid "sync" as id)
// ============================================

/**
 * @openapi
 * /activities/sync:
 *   post:
 *     summary: Sync recent activities from Strava
 *     description: |
 *       Fetches recent activities from Strava and imports them into Street Keeper.
 *       New activities are saved and processed for route/street progress.
 *       Already-imported activities are skipped; unprocessed ones are processed.
 *     tags: [Activities]
 *     security:
 *       - DevAuth: []
 *     parameters:
 *       - in: query
 *         name: after
 *         schema:
 *           type: integer
 *           description: Unix timestamp (seconds); only activities after this time
 *       - in: query
 *         name: before
 *         schema:
 *           type: integer
 *           description: Unix timestamp (seconds); only activities before this time
 *       - in: query
 *         name: perPage
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 200
 *           default: 30
 *         description: Max activities to fetch from Strava per request
 *     responses:
 *       200:
 *         description: Sync completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   enum: [true]
 *                 synced:
 *                   type: integer
 *                   description: New activities saved and processed
 *                 processed:
 *                   type: integer
 *                   description: Existing activities that were processed
 *                 skipped:
 *                   type: integer
 *                   description: Activities skipped (e.g. unsupported type, no GPS)
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       stravaId:
 *                         type: string
 *                       reason:
 *                         type: string
 *       400:
 *         description: No Strava connection or invalid request
 *       401:
 *         description: Unauthorized or Strava token invalid
 */
router.post("/sync", async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const background = req.query.background === "true";
  const force = req.query.force === "true";

  if (force) {
    const resetResult = await prisma.activity.updateMany({
      where: { userId, isProcessed: true },
      data: { isProcessed: false },
    });
    console.log(`[Sync] Force reprocess: reset ${resetResult.count} activities for user ${userId.slice(0, 8)}`);
  }

  const after = req.query.after
    ? parseInt(req.query.after as string, 10)
    : undefined;
  const before = req.query.before
    ? parseInt(req.query.before as string, 10)
    : undefined;
  const perPage = req.query.perPage
    ? parseInt(req.query.perPage as string, 10)
    : undefined;

  if (after !== undefined && Number.isNaN(after)) {
    res.status(400).json({
      success: false,
      error: "Invalid 'after' parameter",
      code: ERROR_CODES.VALIDATION_ERROR,
    });
    return;
  }
  if (before !== undefined && Number.isNaN(before)) {
    res.status(400).json({
      success: false,
      error: "Invalid 'before' parameter",
      code: ERROR_CODES.VALIDATION_ERROR,
    });
    return;
  }
  if (
    perPage !== undefined &&
    (Number.isNaN(perPage) || perPage < 1 || perPage > 200)
  ) {
    res.status(400).json({
      success: false,
      error: "Invalid 'perPage' (must be 1–200)",
      code: ERROR_CODES.VALIDATION_ERROR,
    });
    return;
  }

  try {
    if (background) {
      const result = await startBackgroundSync(userId, {
        after: after ?? undefined,
        before: before ?? undefined,
      });
      res.status(200).json({
        success: true,
        syncId: result.syncId,
        total: result.total,
        status: result.status,
      });
      return;
    }

    const result = await syncRecentActivities(userId, {
      after: after ? after : undefined,
      before: before ? before : undefined,
      perPage,
    });
    res.status(200).json({
      success: true,
      synced: result.synced,
      processed: result.processed,
      skipped: result.skipped,
      errors: result.errors,
    });
  } catch (err) {
    if (err instanceof SyncError) {
      if (err.code === "USER_NOT_FOUND") {
        res.status(404).json({
          success: false,
          error: err.message,
          code: ERROR_CODES.NOT_FOUND,
        });
        return;
      }
      if (err.code === "NO_STRAVA") {
        res.status(400).json({
          success: false,
          error: err.message,
          code: ERROR_CODES.VALIDATION_ERROR,
        });
        return;
      }
      if (err.code === "TOKEN_INVALID") {
        res.status(401).json({
          success: false,
          error: err.message,
          code: ERROR_CODES.AUTH_TOKEN_EXPIRED,
        });
        return;
      }
      if (err.code === "SYNC_RATE_LIMITED") {
        res.status(429).json({
          success: false,
          error: err.message,
          code: ERROR_CODES.SYNC_RATE_LIMITED,
          nextSyncAt: err.nextSyncAt?.toISOString(),
        });
        return;
      }
    }
    console.error("[Activities] Sync error:", err);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
});

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
      projectsRecalculated: result.projectsAffected,
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
