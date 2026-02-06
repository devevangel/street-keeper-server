/**
 * V2 engine routes
 * Mounted at /api/v1/engine-v2
 */

import { Router } from "express";
import { getInfo, getStreets, getMapStreets, analyzeGpx } from "./handlers.js";
import { uploadGpx, handleMulterError } from "../../middleware/upload.middleware.js";
import { requireAuth } from "../../middleware/auth.middleware.js";

const router = Router();

/**
 * @openapi
 * /engine-v2:
 *   get:
 *     tags: [Engine V2]
 *     summary: V2 engine info
 *     description: Returns engine metadata and available endpoints (OSRM edge-based, UserEdge persistence).
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
 *                 endpoints: { type: object }
 *                 description: { type: string }
 */
router.get("/", getInfo);

/**
 * @openapi
 * /engine-v2/streets:
 *   get:
 *     tags: [Engine V2]
 *     summary: User street list from UserEdge
 *     description: Returns the user's street list (cumulative from UserEdge). Requires authentication.
 *     security:
 *       - DevAuth: []
 *     responses:
 *       200:
 *         description: Street list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, streets]
 *               properties:
 *                 success: { type: boolean, enum: [true] }
 *                 streets:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/V2GroupedStreet'
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
router.get("/streets", requireAuth, getStreets);

/**
 * @openapi
 * /engine-v2/map/streets:
 *   get:
 *     tags: [Engine V2]
 *     summary: Map streets with V2 progress
 *     description: Returns streets with geometry and V2 (UserEdge) progress for map rendering. Same shape as GET /map/streets.
 *     security:
 *       - DevAuth: []
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
 *         schema: { type: integer, default: 5000 }
 *         description: Radius in meters
 *     responses:
 *       200:
 *         description: Map streets with geometry and progress
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MapStreetsResponse'
 *       400:
 *         description: Invalid lat/lng
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
 */
router.get("/map/streets", requireAuth, getMapStreets);

/**
 * @openapi
 * /engine-v2/analyze:
 *   post:
 *     tags: [Engine V2]
 *     summary: Analyze GPX and persist edges
 *     description: Upload a GPX file for analysis. Persists edges to UserEdge for the given userId. Query param userId required.
 *     parameters:
 *       - in: query
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: User ID for persisting edges
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [gpxFile]
 *             properties:
 *               gpxFile:
 *                 type: string
 *                 format: binary
 *                 description: GPX file (max 10MB)
 *     responses:
 *       200:
 *         description: GPX analysis complete
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/V2AnalyzeGpxResponse'
 *       400:
 *         description: Missing file, missing userId, or invalid format
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
  uploadGpx.single("gpxFile"),
  handleMulterError,
  analyzeGpx
);

export default router;
