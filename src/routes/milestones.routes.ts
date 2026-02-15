/**
 * Milestones API – user milestones and progress
 *
 * GET /milestones – list user milestones (with progress)
 * GET /milestones/next – get next milestone for homepage
 * GET /milestone-types – list available (enabled) milestone types
 * POST /milestones – create custom milestone
 * PATCH /milestones/:id/pin – pin/unpin milestone
 */
import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  getMilestonesForUser,
  getNextMilestone,
  createMilestone,
  pinMilestone,
} from "../services/milestone.service.js";
import prisma from "../lib/prisma.js";

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /milestone-types:
 *   get:
 *     summary: List available milestone types (enabled only)
 */
router.get("/milestone-types", async (_req: Request, res: Response): Promise<void> => {
  const types = await prisma.milestoneType.findMany({
    where: { isEnabled: true },
    orderBy: { order: "asc" },
    select: {
      id: true,
      slug: true,
      scope: true,
      name: true,
      description: true,
      configSchema: true,
      order: true,
    },
  });
  res.json({ success: true, data: types });
});

/**
 * @openapi
 * /milestones:
 *   get:
 *     summary: List user milestones with progress
 *     parameters:
 *       - in: query
 *         name: projectId
 *         schema: { type: string }
 */
router.get("/", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { user: { id: string } }).user.id;
  const projectId = req.query.projectId as string | undefined;
  const data = await getMilestonesForUser(userId, projectId);
  res.json({ success: true, data });
});

/**
 * @openapi
 * /milestones/next:
 *   get:
 *     summary: Get next milestone for homepage
 *     parameters:
 *       - in: query
 *         name: projectId
 *         schema: { type: string }
 */
router.get("/next", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { user: { id: string } }).user.id;
  const projectId = req.query.projectId as string | undefined;
  const data = await getNextMilestone(userId, projectId);
  res.json({ success: true, data });
});

/**
 * @openapi
 * /milestones:
 *   post:
 *     summary: Create custom milestone
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [typeSlug, config]
 *             properties:
 *               typeSlug: { type: string }
 *               projectId: { type: string }
 *               config: { type: object }
 *               name: { type: string }
 */
router.post("/", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { user: { id: string } }).user.id;
  const body = req.body as { typeSlug: string; projectId?: string; config: Record<string, unknown>; name?: string };
  if (!body.typeSlug || typeof body.config !== "object") {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_PAYLOAD", message: "typeSlug and config required" },
    });
    return;
  }
  try {
    const created = await createMilestone(userId, {
      typeSlug: body.typeSlug,
      projectId: body.projectId,
      config: body.config,
      name: body.name,
    });
    res.status(201).json({ success: true, data: created });
  } catch (e) {
    res.status(400).json({
      success: false,
      error: { code: "CREATE_FAILED", message: (e as Error).message },
    });
  }
});

/**
 * @openapi
 * /milestones/:id/pin:
 *   patch:
 *     summary: Pin or unpin milestone
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isPinned]
 *             properties:
 *               isPinned: { type: boolean }
 */
router.patch("/:id/pin", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { user: { id: string } }).user.id;
  const milestoneId = req.params.id;
  const body = req.body as { isPinned?: boolean };
  const isPinned = Boolean(body.isPinned);

  const milestone = await prisma.userMilestone.findFirst({
    where: { id: milestoneId, userId },
  });
  if (!milestone) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Milestone not found" },
    });
    return;
  }

  await pinMilestone(milestoneId, isPinned);
  res.json({ success: true, data: { isPinned } });
});

export default router;
