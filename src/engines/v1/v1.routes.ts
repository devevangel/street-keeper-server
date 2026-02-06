/**
 * V1 engine routes
 * Mounted at /api/v1/engine-v1
 *
 * Same behavior as /runs/analyze-gpx; field name for GPX is "gpx".
 */

import { Router } from "express";
import { getInfo, analyzeGpx } from "./handlers.js";
import { uploadGpx, handleMulterError } from "../../middleware/upload.middleware.js";

const router = Router();

router.get("/", getInfo);

// POST /api/v1/engine-v1/analyze - same as /runs/analyze-gpx
router.post(
  "/analyze",
  uploadGpx.single("gpx"),
  handleMulterError,
  analyzeGpx
);

export default router;
