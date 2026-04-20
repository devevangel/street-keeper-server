/**
 * Runs Routes
 * API endpoints for GPX file analysis and street identification
 *
 * This module provides the endpoint for uploading and analyzing GPX files.
 * It orchestrates the entire flow:
 *
 * 1. Receive GPX file upload (Multer middleware)
 * 2. Parse GPX to extract GPS points (gpx.service)
 * 3. Calculate run statistics (geo.service)
 * 4. Query streets in the area (PostGIS / local sync)
 * 5. Match GPS points to streets (engine v1: street-matching)
 * 6. Return complete analysis with all streets covered
 *
 * Endpoints:
 * - POST /api/v1/runs/analyze-gpx - Upload and analyze a GPX file
 */

import { Router, Request, Response } from "express";
import {
  uploadGpx,
  handleMulterError,
} from "../middleware/upload.middleware.js";
import { parseGpxBuffer, GpxParseError } from "../services/gpx.service.js";
import { OverpassError } from "../services/overpass.service.js";
import { MapboxError } from "../engines/v1/mapbox.js";
import { ERROR_CODES } from "../config/constants.js";
import type { GpxErrorResponse } from "../types/run.types.js";
import prisma from "../lib/prisma.js";
import { detectCity } from "../services/city-sync.service.js";
import {
  enqueueCitySyncJob,
  enqueueGpxAnalyzeJob,
} from "../queues/activity.queue.js";
import { runEnhancedGpxAnalysis } from "../services/gpx-analyze-runner.service.js";

const router = Router();

// ============================================
// POST /api/v1/runs/analyze-gpx
// ============================================

/**
 * @openapi
 * /runs/analyze-gpx:
 *   post:
 *     summary: Upload and analyze a GPX file
 *     description: |
 *       Upload a GPX file and receive detailed street coverage analysis.
 *       
 *       **Features:**
 *       - Run statistics (distance, duration, point count)
 *       - Moving vs stopped time breakdown
 *       - Track quality metrics (GPS jump detection)
 *       - Aggregated logical streets (combines OSM segments)
 *       - Unnamed roads grouped by highway type
 *       
 *       **Accuracy:**
 *       - With Mapbox configured: ~98% accuracy
 *       - Without Mapbox (fallback): ~85% accuracy
 *       
 *       **Note:** This endpoint does NOT require authentication.
 *     tags: [GPX]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - gpx
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
 *         description: Missing file, invalid format, or parse error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *             examples:
 *               missingFile:
 *                 summary: No file uploaded
 *                 value:
 *                   success: false
 *                   error: "No GPX file provided. Upload a file in the 'gpx' field."
 *                   code: "GPX_FILE_REQUIRED"
 *               parseError:
 *                 summary: Invalid GPX format
 *                 value:
 *                   success: false
 *                   error: "Invalid GPX file format"
 *                   code: "GPX_PARSE_ERROR"
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
  "/analyze-gpx",
  // Middleware 1: Handle file upload (stores in req.file.buffer)
  uploadGpx.single("gpx"),
  // Middleware 2: Handle upload errors (file too large, wrong type)
  handleMulterError,
  // Main handler
  async (req: Request, res: Response) => {
    // ========================================
    // Validate file upload
    // ========================================

    if (!req.file) {
      const error: GpxErrorResponse = {
        success: false,
        error: "No GPX file provided. Upload a file in the 'gpx' field.",
        code: ERROR_CODES.GPX_FILE_REQUIRED,
      };
      return res.status(400).json(error);
    }

    try {
      const gpxData = parseGpxBuffer(req.file.buffer);

      const lats = gpxData.points.map((p) => p.lat);
      const lngs = gpxData.points.map((p) => p.lng);
      const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
      const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

      const city = await detectCity(centerLat, centerLng);
      if (!city) {
        const err: GpxErrorResponse = {
          success: false,
          error:
            "Could not determine city for this GPX area. Try a longer track or different location.",
          code: ERROR_CODES.VALIDATION_ERROR,
        };
        return res.status(400).json(err);
      }

      const existing = await prisma.citySync.findUnique({
        where: { relationId: city.relationId },
      });
      const synced =
        existing != null && existing.expiresAt > new Date();

      if (!synced) {
        await enqueueCitySyncJob({
          relationId: city.relationId.toString(),
          name: city.name,
          adminLevel: city.adminLevel,
        });
        await enqueueGpxAnalyzeJob({
          gpxBase64: req.file.buffer.toString("base64"),
          centerLat,
          centerLng,
          deferCount: 0,
        });
        return res.status(202).json({
          success: true,
          status: "processing",
          message:
            "Street data is being loaded for this area. Your run will be processed shortly.",
        });
      }

      const response = await runEnhancedGpxAnalysis(req.file.buffer);
      res.status(200).json(response);
    } catch (error) {
      // ========================================
      // Error Handling
      // ========================================

      console.error("[GPX] Analysis error:", error);

      if (error instanceof GpxParseError) {
        const response: GpxErrorResponse = {
          success: false,
          error: error.message,
          code: ERROR_CODES.GPX_PARSE_ERROR,
        };
        return res.status(400).json(response);
      }

      // Overpass API errors (timeout, rate limit, server error)
      if (error instanceof OverpassError) {
        const response: GpxErrorResponse = {
          success: false,
          error: error.message,
          code: ERROR_CODES.OVERPASS_API_ERROR,
        };
        // 502 Bad Gateway - upstream service error
        return res.status(502).json(response);
      }

      // Mapbox API errors (handled internally with fallback, but log if bubbles up)
      if (error instanceof MapboxError) {
        console.warn(`[GPX] Mapbox error (should have fallen back): ${error.message}`);
        const response: GpxErrorResponse = {
          success: false,
          error: error.message,
          code: ERROR_CODES.MAPBOX_API_ERROR,
        };
        return res.status(502).json(response);
      }

      // Unexpected errors
      const response: GpxErrorResponse = {
        success: false,
        error: "Failed to analyze GPX file. Please try again.",
        code: ERROR_CODES.INTERNAL_ERROR,
      };
      res.status(500).json(response);
    }
  }
);

export default router;
