/**
 * Homepage API – single aggregated payload
 *
 * GET /homepage – returns hero, streak, primarySuggestion, alternates, nextMilestone, mapContext, recentHighlights
 */
import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getHomepageData } from "../services/homepage.service.js";

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /homepage:
 *   get:
 *     summary: Get homepage payload (hero, streak, suggestion, milestone, mapContext)
 *     parameters:
 *       - in: query
 *         name: lat
 *         schema: { type: number }
 *       - in: query
 *         name: lng
 *         schema: { type: number }
 *       - in: query
 *         name: radius
 *         schema: { type: number }
 *       - in: query
 *         name: projectId
 *         schema: { type: string }
 */
router.get("/", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { user: { id: string } }).user.id;
  const query = {
    lat: req.query.lat as string | undefined,
    lng: req.query.lng as string | undefined,
    radius: req.query.radius as string | undefined,
    projectId: req.query.projectId as string | undefined,
    userLat: req.query.userLat as string | undefined,
    userLng: req.query.userLng as string | undefined,
  };
  const data = await getHomepageData(userId, query);
  res.json({ success: true, data });
});

export default router;
