/**
 * User preferences API
 * GET /preferences – get current user preferences
 * PATCH /preferences – update preferences
 */
import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getPreferences, updatePreferences, type UpdatePreferencesInput } from "../services/preferences.service.js";

const router = Router();

router.use(requireAuth);

router.get("/", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { user: { id: string } }).user.id;
  try {
    const preferences = await getPreferences(userId);
    res.json({ success: true, preferences });
  } catch (err) {
    console.error("[Preferences] GET error:", err);
    res.status(500).json({ success: false, error: "Failed to load preferences" });
  }
});

router.patch("/", async (req: Request, res: Response): Promise<void> => {
  const userId = (req as Request & { user: { id: string } }).user.id;
  const body = req.body as UpdatePreferencesInput;
  try {
    const preferences = await updatePreferences(userId, body);
    res.json({ success: true, preferences });
  } catch (err) {
    console.error("[Preferences] PATCH error:", err);
    res.status(500).json({ success: false, error: "Failed to update preferences" });
  }
});

export default router;
