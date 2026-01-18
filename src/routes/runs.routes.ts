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
 * 4. Query streets in the area (overpass.service)
 * 5. Match GPS points to streets (street-matching.service)
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
import {
  calculateTotalDistance,
  calculateDuration,
  calculateBoundingBox,
} from "../services/geo.service.js";
import {
  queryStreetsInBoundingBox,
  OverpassError,
} from "../services/overpass.service.js";
import { matchPointsToStreets } from "../services/street-matching.service.js";
import { buildComprehensiveAnalysis } from "../services/gpx-analysis.service.js";
import { aggregateSegmentsIntoLogicalStreets } from "../services/street-aggregation.service.js";
import { ERROR_CODES } from "../config/constants.js";
import type {
  EnhancedAnalyzeGpxResponse,
  GpxErrorResponse,
} from "../types/run.types.js";

const router = Router();

// ============================================
// POST /api/v1/runs/analyze-gpx
// ============================================

/**
 * Upload and analyze a GPX file to identify all streets covered
 *
 * Phase 5 Implementation: Enhanced Analysis with Aggregation
 *
 * This endpoint accepts a GPX file upload and returns a comprehensive
 * analysis including:
 *
 * Basic Analysis:
 * - Run statistics (distance, duration, point count)
 * - Start/end times
 *
 * Phase 3 Enhancements:
 * - Moving vs stopped time breakdown
 * - Track quality metrics (point spacing, GPS jumps)
 *
 * Phase 4 Enhancements:
 * - Aggregated logical streets (groups OSM segments)
 * - Unnamed road bucketing (groups by highway type)
 * - Raw segment-level data (for debugging)
 *
 * Request:
 * - Method: POST
 * - Content-Type: multipart/form-data
 * - Body: gpx file in field named "gpx"
 *
 * Success Response (200): EnhancedAnalyzeGpxResponse
 * - analysis: EnhancedAnalysis with Phase 3 & 4 metrics
 * - segments: Raw segment-level data (MatchedStreet[])
 * - streets: Aggregated logical streets (AggregatedStreet[])
 * - unnamedRoads: Bucketed unnamed roads by highway type
 *
 * Error Responses:
 * - 400: Missing file, invalid format, parse error
 * - 502: OpenStreetMap API error
 * - 500: Internal server error
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
      // ========================================
      // Step 1: Parse GPX file
      // ========================================
      // Extracts GPS points, timestamps, and metadata from the GPX XML

      const gpxData = parseGpxBuffer(req.file.buffer);

      console.log(
        `[GPX] Parsed ${gpxData.points.length} points from "${gpxData.name || "unnamed"}"`
      );

      // ========================================
      // Step 2: Calculate run statistics
      // ========================================
      // Total distance (sum of point-to-point distances)
      // Duration (time from first to last point)

      const totalDistance = calculateTotalDistance(gpxData.points);
      const duration = calculateDuration(gpxData.points);

      console.log(
        `[GPX] Run stats: ${totalDistance.toFixed(0)}m, ${duration}s`
      );

      // ========================================
      // Step 3: Calculate bounding box
      // ========================================
      // Rectangle around all GPS points + 100m buffer
      // Used to query only relevant streets from OpenStreetMap

      const bbox = calculateBoundingBox(gpxData.points);

      console.log(
        `[GPX] Bounding box: ${bbox.south.toFixed(4)},${bbox.west.toFixed(4)} to ${bbox.north.toFixed(4)},${bbox.east.toFixed(4)}`
      );

      // ========================================
      // Step 4: Query streets from OpenStreetMap
      // ========================================
      // Fetches all roads/paths in the bounding box area

      const streets = await queryStreetsInBoundingBox(bbox);

      console.log(`[GPX] Found ${streets.length} streets in area`);

      // ========================================
      // Step 5: Match GPS points to streets
      // ========================================
      // For each point, find nearest street (within 25m)
      // Calculate coverage for each matched street
      // Phase 1: Consecutive-only distance calculation
      // Phase 2: Geometry-based distance projection

      const matchedStreets = matchPointsToStreets(gpxData.points, streets);

      console.log(
        `[GPX] Matched ${matchedStreets.length} streets (${matchedStreets.filter((s) => s.completionStatus === "FULL").length} full, ${matchedStreets.filter((s) => s.completionStatus === "PARTIAL").length} partial)`
      );

      // ========================================
      // Step 6: Aggregate segments into logical streets (Phase 4)
      // ========================================
      // Groups OSM way segments by normalized name + highway type
      // Buckets unnamed roads by highway type
      // Reduces duplicate street entries for better UX

      const aggregationResult = aggregateSegmentsIntoLogicalStreets(
        matchedStreets
      );

      console.log(
        `[GPX] Aggregated into ${aggregationResult.streets.length} logical streets, ${aggregationResult.unnamedBuckets.length} unnamed road buckets`
      );

      // ========================================
      // Step 7: Build enhanced GPX analysis (Phase 3)
      // ========================================
      // Calculates moving vs stopped time, track quality metrics
      // Includes street coverage summary

      const comprehensiveAnalysis = buildComprehensiveAnalysis(gpxData);

      // Calculate street coverage summary for enhanced analysis
      const streetsTotal = aggregationResult.streets.length;
      const streetsFullCount = aggregationResult.streets.filter(
        (s) => s.completionStatus === "FULL"
      ).length;
      const streetsPartialCount =
        streetsTotal - streetsFullCount;
      const percentageFullStreets =
        streetsTotal > 0 ? (streetsFullCount / streetsTotal) * 100 : 0;

      // ========================================
      // Step 8: Build enhanced response
      // ========================================
      // Includes both segment-level and aggregated street-level data
      // Provides comprehensive analysis with Phase 3 & 4 enhancements

      const response: EnhancedAnalyzeGpxResponse = {
        success: true,
        analysis: {
          gpxName: comprehensiveAnalysis.gpxName,
          totalDistanceMeters: comprehensiveAnalysis.totalDistanceMeters,
          durationSeconds: comprehensiveAnalysis.durationSeconds,
          pointsCount: comprehensiveAnalysis.pointsCount,
          startTime: comprehensiveAnalysis.startTime?.toISOString(),
          endTime: comprehensiveAnalysis.endTime?.toISOString(),

          // Phase 3: Time breakdown
          movingTimeSeconds: comprehensiveAnalysis.movingTimeSeconds,
          stoppedTimeSeconds: comprehensiveAnalysis.stoppedTimeSeconds,

          // Phase 3: Track quality metrics
          avgPointSpacingMeters: comprehensiveAnalysis.avgPointSpacingMeters,
          maxSegmentDistanceMeters:
            comprehensiveAnalysis.maxSegmentDistanceMeters,
          gpsJumpCount: comprehensiveAnalysis.gpsJumpCount,

          // Phase 4: Street coverage summary
          streetsTotal,
          streetsFullCount,
          streetsPartialCount,
          percentageFullStreets: Math.round(percentageFullStreets * 100) / 100,
        },

        // Raw segment-level data (for debugging, advanced use)
        segments: {
          total: matchedStreets.length,
          fullCount: matchedStreets.filter(
            (s) => s.completionStatus === "FULL"
          ).length,
          partialCount: matchedStreets.filter(
            (s) => s.completionStatus === "PARTIAL"
          ).length,
          list: matchedStreets,
        },

        // Aggregated street-level data (for UX)
        streets: {
          total: aggregationResult.streets.length,
          fullCount: streetsFullCount,
          partialCount: streetsPartialCount,
          list: aggregationResult.streets,
        },

        // Unnamed roads bucketed by type
        unnamedRoads: {
          totalSegments: aggregationResult.unnamedBuckets.reduce(
            (sum, bucket) => sum + bucket.segmentCount,
            0
          ),
          buckets: aggregationResult.unnamedBuckets,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      // ========================================
      // Error Handling
      // ========================================

      console.error("[GPX] Analysis error:", error);

      // GPX parsing errors (malformed XML, no tracks, etc.)
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
