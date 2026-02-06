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

/**
 * @openapi
 * /engine-v1:
 *   get:
 *     tags: [Engine V1]
 *     summary: V1 engine info
 *     description: Returns engine metadata and available endpoints (Overpass + Mapbox hybrid).
 *     responses:
 *       200:
 *         description: Engine info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *                 version: { type: string }
 *                 endpoints:
 *                   type: object
 *                   properties:
 *                     analyze: { type: string }
 *                 description: { type: string }
 */
router.get("/", getInfo);

/**
 * @openapi
 * /engine-v1/analyze:
 *   post:
 *     tags: [Engine V1]
 *     summary: Analyze GPX (V1)
 *     description: Upload a GPX file and receive street coverage analysis (same pipeline as /runs/analyze-gpx). Multipart field `gpx`.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [gpx]
 *             properties:
 *               gpx:
 *                 type: string
 *                 format: binary
 *                 description: GPX file (max 10MB)
 *     responses:
 *       200:
 *         description: GPX analysis complete
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GpxAnalysisResponse'
 *       400:
 *         description: Missing file or invalid format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       502:
 *         description: External API error (Overpass or Mapbox)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.post(
  "/analyze",
  uploadGpx.single("gpx"),
  handleMulterError,
  analyzeGpx
);

export default router;
