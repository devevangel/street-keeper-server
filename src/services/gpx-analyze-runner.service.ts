/**
 * Shared GPX analysis pipeline (sync HTTP + deferred queue worker).
 */

import { parseGpxBuffer, GpxParseError } from "./gpx.service.js";
import {
  calculateTotalDistance,
  calculateDuration,
  calculateBoundingBox,
} from "./geo.service.js";
import { getLocalStreetsInBBox } from "./local-streets.service.js";
import {
  matchPointsToStreets,
  matchPointsToStreetsHybrid,
} from "../engines/v1/street-matching.js";
import { buildComprehensiveAnalysis } from "../engines/v1/gpx-analysis.js";
import { isMapboxConfigured, MapboxError } from "../engines/v1/mapbox.js";
import { aggregateSegmentsIntoLogicalStreets } from "../engines/v1/street-aggregation.js";
import { STREET_MATCHING } from "../config/constants.js";
import type { EnhancedAnalyzeGpxResponse } from "../types/run.types.js";

/**
 * Full enhanced GPX analysis using local PostGIS streets (bbox query).
 */
export async function runEnhancedGpxAnalysis(
  buffer: Buffer,
): Promise<EnhancedAnalyzeGpxResponse> {
  const gpxData = parseGpxBuffer(buffer);
  const totalDistance = calculateTotalDistance(gpxData.points);
  const duration = calculateDuration(gpxData.points);
  const bbox = calculateBoundingBox(gpxData.points);

  const streets = await getLocalStreetsInBBox(bbox);

  const useHybrid = isMapboxConfigured();
  const matchedStreets = useHybrid
    ? await matchPointsToStreetsHybrid(gpxData.points, streets)
    : matchPointsToStreets(gpxData.points, streets);

  const filteredMatchedStreets = matchedStreets.filter(
    (s) => s.matchedPointsCount >= STREET_MATCHING.MIN_POINTS_PER_STREET,
  );

  const aggregationResult = aggregateSegmentsIntoLogicalStreets(
    filteredMatchedStreets,
  );

  const comprehensiveAnalysis = buildComprehensiveAnalysis(gpxData);

  const streetsTotal = aggregationResult.streets.length;
  const streetsFullCount = aggregationResult.streets.filter(
    (s) => s.completionStatus === "FULL",
  ).length;
  const streetsPartialCount = streetsTotal - streetsFullCount;
  const percentageFullStreets =
    streetsTotal > 0 ? (streetsFullCount / streetsTotal) * 100 : 0;

  return {
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
      partialCount: matchedStreets.filter((s) => s.completionStatus === "PARTIAL")
        .length,
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
        0,
      ),
      buckets: aggregationResult.unnamedBuckets,
    },
  };
}

export { MapboxError };
