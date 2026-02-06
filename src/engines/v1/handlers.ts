/**
 * V1 engine handlers
 *
 * Legacy GPX analysis: Overpass + Mapbox hybrid, street aggregation.
 * Same pipeline as POST /api/v1/runs/analyze-gpx (mounted here as /engine-v1/analyze).
 */

import type { Request, Response } from "express";
import { parseGpxBuffer, GpxParseError } from "../../services/gpx.service.js";
import {
  calculateTotalDistance,
  calculateDuration,
  calculateBoundingBox,
} from "../../services/geo.service.js";
import {
  queryStreetsInBoundingBox,
  OverpassError,
} from "../../services/overpass.service.js";
import {
  matchPointsToStreets,
  matchPointsToStreetsHybrid,
} from "../../services/street-matching.service.js";
import { buildComprehensiveAnalysis } from "../../services/gpx-analysis.service.js";
import { isMapboxConfigured, MapboxError } from "../../services/mapbox.service.js";
import { aggregateSegmentsIntoLogicalStreets } from "../../services/street-aggregation.service.js";
import { ERROR_CODES, STREET_MATCHING } from "../../config/constants.js";
import type {
  EnhancedAnalyzeGpxResponse,
  GpxErrorResponse,
} from "../../types/run.types.js";

/**
 * GET /api/v1/engine-v1
 */
export function getInfo(_req: Request, res: Response): void {
  res.json({
    message: "V1 Engine - Overpass + Mapbox hybrid",
    version: "1.0.0",
    endpoints: {
      analyze: "POST /api/v1/engine-v1/analyze",
    },
    description:
      "Legacy GPX analysis: bounding box + Overpass streets, Mapbox (or Overpass-only) point-to-street matching, logical street aggregation.",
  });
}

/**
 * POST /api/v1/engine-v1/analyze
 * Same logic as /runs/analyze-gpx; expects multipart field "gpx".
 */
export async function analyzeGpx(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    const error: GpxErrorResponse = {
      success: false,
      error: "No GPX file provided. Upload a file in the 'gpx' field.",
      code: ERROR_CODES.GPX_FILE_REQUIRED,
    };
    res.status(400).json(error);
    return;
  }

  try {
    const gpxData = parseGpxBuffer(req.file.buffer);
    console.log(
      `[GPX][v1] Parsed ${gpxData.points.length} points from "${gpxData.name || "unnamed"}"`
    );

    const totalDistance = calculateTotalDistance(gpxData.points);
    const duration = calculateDuration(gpxData.points);
    console.log(`[GPX][v1] Run stats: ${totalDistance.toFixed(0)}m, ${duration}s`);

    const bbox = calculateBoundingBox(gpxData.points);
    const streets = await queryStreetsInBoundingBox(bbox);
    console.log(`[GPX][v1] Found ${streets.length} streets in area`);

    const useHybrid = isMapboxConfigured();
    let matchedStreets;
    if (useHybrid) {
      console.log("[GPX][v1] Using hybrid Mapbox + Overpass matching");
      matchedStreets = await matchPointsToStreetsHybrid(gpxData.points, streets);
    } else {
      console.log("[GPX][v1] Using Overpass-only matching");
      matchedStreets = matchPointsToStreets(gpxData.points, streets);
    }

    const filteredMatchedStreets = matchedStreets.filter(
      (s) => s.matchedPointsCount >= STREET_MATCHING.MIN_POINTS_PER_STREET
    );

    const aggregationResult = aggregateSegmentsIntoLogicalStreets(
      filteredMatchedStreets
    );
    const comprehensiveAnalysis = buildComprehensiveAnalysis(gpxData);

    const streetsTotal = aggregationResult.streets.length;
    const streetsFullCount = aggregationResult.streets.filter(
      (s) => s.completionStatus === "FULL"
    ).length;
    const streetsPartialCount = streetsTotal - streetsFullCount;
    const percentageFullStreets =
      streetsTotal > 0 ? (streetsFullCount / streetsTotal) * 100 : 0;

    const response: EnhancedAnalyzeGpxResponse = {
      success: true,
      analysis: {
        gpxName: comprehensiveAnalysis.gpxName,
        totalDistanceMeters: comprehensiveAnalysis.totalDistanceMeters,
        durationSeconds: comprehensiveAnalysis.durationSeconds,
        pointsCount: comprehensiveAnalysis.pointsCount,
        startTime: comprehensiveAnalysis.startTime?.toISOString(),
        endTime: comprehensiveAnalysis.endTime?.toISOString(),
        movingTimeSeconds: comprehensiveAnalysis.movingTimeSeconds,
        stoppedTimeSeconds: comprehensiveAnalysis.stoppedTimeSeconds,
        avgPointSpacingMeters: comprehensiveAnalysis.avgPointSpacingMeters,
        maxSegmentDistanceMeters:
          comprehensiveAnalysis.maxSegmentDistanceMeters,
        gpsJumpCount: comprehensiveAnalysis.gpsJumpCount,
        streetsTotal,
        streetsFullCount,
        streetsPartialCount,
        percentageFullStreets: Math.round(percentageFullStreets * 100) / 100,
      },
      segments: {
        total: matchedStreets.length,
        fullCount: matchedStreets.filter((s) => s.completionStatus === "FULL")
          .length,
        partialCount: matchedStreets.filter(
          (s) => s.completionStatus === "PARTIAL"
        ).length,
        list: matchedStreets,
      },
      streets: {
        total: aggregationResult.streets.length,
        fullCount: streetsFullCount,
        partialCount: streetsPartialCount,
        list: aggregationResult.streets,
      },
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
    console.error("[GPX][v1] Analysis error:", error);

    if (error instanceof GpxParseError) {
      res.status(400).json({
        success: false,
        error: error.message,
        code: ERROR_CODES.GPX_PARSE_ERROR,
      } as GpxErrorResponse);
      return;
    }
    if (error instanceof OverpassError) {
      res.status(502).json({
        success: false,
        error: error.message,
        code: ERROR_CODES.OVERPASS_API_ERROR,
      } as GpxErrorResponse);
      return;
    }
    if (error instanceof MapboxError) {
      res.status(502).json({
        success: false,
        error: error.message,
        code: ERROR_CODES.MAPBOX_API_ERROR,
      } as GpxErrorResponse);
      return;
    }

    res.status(500).json({
      success: false,
      error: "Failed to analyze GPX file. Please try again.",
      code: ERROR_CODES.INTERNAL_ERROR,
    } as GpxErrorResponse);
  }
}
