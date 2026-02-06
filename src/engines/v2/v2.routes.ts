/**
 * V2 engine routes
 * Mounted at /api/v1/engine-v2
 */

import { Router } from "express";
import { getInfo, getStreets, getMapStreets, analyzeGpx } from "./handlers.js";
import { uploadGpx, handleMulterError } from "../../middleware/upload.middleware.js";
import { requireAuth } from "../../middleware/auth.middleware.js";

const router = Router();

router.get("/", getInfo);

// GET /api/v1/engine-v2/streets – user's street list from UserEdge (auth required)
router.get("/streets", requireAuth, getStreets);

// GET /api/v1/engine-v2/map/streets – map with geometry + V2 progress (auth required)
router.get("/map/streets", requireAuth, getMapStreets);

// POST /api/v1/engine-v2/analyze
// Accepts GPX file upload and returns street coverage analysis
router.post(
  "/analyze",
  uploadGpx.single("gpxFile"),
  handleMulterError,
  analyzeGpx
);

export default router;
