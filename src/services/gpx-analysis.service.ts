/**
 * GPX Analysis Service
 * Enhanced GPX track analysis with quality metrics and time breakdown
 *
 * Phase 3 Implementation: GPS Filtering and Quality Metrics
 *
 * This service provides advanced analysis of GPX tracks beyond basic distance
 * and duration calculations. It includes:
 *
 * 1. Moving vs Stopped Time Analysis
 *    - Identifies when the runner was moving vs stopped
 *    - Uses speed threshold to distinguish movement
 *    - Helps identify breaks, traffic lights, or GPS issues
 *
 * 2. Track Quality Metrics
 *    - Average point spacing (GPS recording frequency)
 *    - Maximum segment distance (largest gap between points)
 *    - GPS jump count (suspicious large jumps indicating errors)
 *
 * 3. GPS Jump Detection
 *    - Identifies consecutive points with unrealistic distances
 *    - Helps flag low-quality GPX files
 *    - Useful for debugging and data validation
 *
 * Use Cases:
 * - Quality assessment: Is this GPX file reliable?
 * - Performance analysis: How much time was spent moving vs stopped?
 * - Data validation: Are there GPS errors that might affect street matching?
 *
 * Dependencies:
 * - @turf/turf: For distance calculations
 * - geo.service.ts: For basic distance calculations
 */

import * as turf from "@turf/turf";
import type { GpxPoint, ParsedGpxData } from "../types/run.types.js";
import { GPS_QUALITY } from "../config/constants.js";
import { calculateTotalDistance } from "./geo.service.js";

// ============================================
// Moving vs Stopped Time Analysis
// ============================================

/**
 * Calculate moving time vs stopped time from GPS track
 *
 * Phase 3 Implementation: Time Breakdown Analysis
 *
 * Analyzes the GPS track to determine how much time was spent moving
 * versus stopped. This helps identify:
 * - Actual running time (moving)
 * - Breaks, stops, or pauses (stopped)
 * - GPS recording issues (unrealistic speeds)
 *
 * Algorithm:
 * 1. For each consecutive pair of points with timestamps:
 *    a. Calculate distance between points
 *    b. Calculate time difference
 *    c. Calculate speed (distance / time)
 * 2. If speed >= threshold: Count as moving time
 * 3. If speed < threshold: Count as stopped time
 * 4. If no timestamp: Skip (can't calculate speed)
 *
 * Speed Threshold:
 * - Default: 0.5 m/s (1.8 km/h, walking speed)
 * - Below threshold = stopped (standing, waiting, GPS drift)
 * - Above threshold = moving (running, walking, jogging)
 *
 * @param points - Array of GPS coordinates with timestamps
 * @param stoppedSpeedThreshold - Speed threshold in m/s (default: 0.5 m/s)
 * @returns Object with movingSeconds and stoppedSeconds
 *
 * @example
 * const points = [
 *   { lat: 50.79, lng: -1.09, timestamp: new Date("2026-01-17T08:00:00Z") },
 *   { lat: 50.80, lng: -1.10, timestamp: new Date("2026-01-17T08:00:30Z") }, // Moving
 *   { lat: 50.80, lng: -1.10, timestamp: new Date("2026-01-17T08:01:00Z") }, // Stopped
 *   { lat: 50.81, lng: -1.11, timestamp: new Date("2026-01-17T08:01:30Z") }, // Moving
 * ];
 * const { movingSeconds, stoppedSeconds } = calculateMovingStoppedTime(points);
 * // Returns: { movingSeconds: 60, stoppedSeconds: 30 }
 */
export function calculateMovingStoppedTime(
  points: GpxPoint[],
  stoppedSpeedThreshold: number = GPS_QUALITY.STOPPED_SPEED_THRESHOLD_MS
): { movingSeconds: number; stoppedSeconds: number } {
  if (points.length < 2) {
    return { movingSeconds: 0, stoppedSeconds: 0 };
  }

  let movingSeconds = 0;
  let stoppedSeconds = 0;

  // Analyze each consecutive pair of points
  for (let i = 1; i < points.length; i++) {
    const prevPoint = points[i - 1];
    const currPoint = points[i];

    // Skip if either point lacks a timestamp
    if (!prevPoint.timestamp || !currPoint.timestamp) {
      continue;
    }

    // Calculate time difference in seconds
    const timeDiffSeconds =
      (currPoint.timestamp.getTime() - prevPoint.timestamp.getTime()) / 1000;

    // Skip if time difference is too small or negative
    if (
      timeDiffSeconds < GPS_QUALITY.MIN_TIME_DIFF_SECONDS ||
      timeDiffSeconds <= 0
    ) {
      continue;
    }

    // Calculate distance between points in meters
    const prevTurfPoint = turf.point([prevPoint.lng, prevPoint.lat]);
    const currTurfPoint = turf.point([currPoint.lng, currPoint.lat]);
    const distanceMeters = turf.distance(prevTurfPoint, currTurfPoint, {
      units: "meters",
    });

    // Calculate speed (meters per second)
    const speedMs = distanceMeters / timeDiffSeconds;

    // Categorize as moving or stopped based on speed threshold
    if (speedMs >= stoppedSpeedThreshold) {
      movingSeconds += timeDiffSeconds;
    } else {
      stoppedSeconds += timeDiffSeconds;
    }
  }

  return {
    movingSeconds: Math.round(movingSeconds),
    stoppedSeconds: Math.round(stoppedSeconds),
  };
}

// ============================================
// Track Quality Metrics
// ============================================

/**
 * Calculate track quality metrics for a GPS track
 *
 * Phase 3 Implementation: GPS Quality Assessment
 *
 * Analyzes the GPS track to assess its quality and identify potential issues.
 * Returns metrics that help determine if the GPX file is reliable for analysis.
 *
 * Metrics Calculated:
 * 1. Average Point Spacing (meters)
 *    - Average distance between consecutive GPS points
 *    - Indicates GPS recording frequency
 *    - Low spacing (< 5m) = frequent recording (good)
 *    - High spacing (> 50m) = infrequent recording (may miss details)
 *
 * 2. Maximum Segment Distance (meters)
 *    - Largest distance between any two consecutive points
 *    - Helps identify GPS gaps or recording issues
 *    - Very large values (> 200m) may indicate GPS errors
 *
 * 3. GPS Jump Count
 *    - Number of consecutive points with unrealistic distances
 *    - Jumps = distance > JUMP_THRESHOLD (default: 100m)
 *    - High jump count = low-quality GPS data
 *    - Zero jumps = good quality GPS data
 *
 * Use Cases:
 * - Data validation: Flag low-quality GPX files
 * - Debugging: Identify GPS recording issues
 * - Quality scoring: Rate GPX file reliability
 *
 * @param points - Array of GPS coordinates
 * @returns Object with quality metrics
 *
 * @example
 * const points = [
 *   { lat: 50.79, lng: -1.09 },
 *   { lat: 50.80, lng: -1.10 }, // Normal spacing
 *   { lat: 50.90, lng: -1.20 }, // GPS jump (> 100m)
 *   { lat: 50.91, lng: -1.21 }, // Normal spacing
 * ];
 * const quality = calculateTrackQuality(points);
 * // Returns: {
 * //   avgPointSpacingMeters: 45.2,
 * //   maxSegmentDistanceMeters: 1250.8, // The jump
 * //   gpsJumpCount: 1
 * // }
 */
export function calculateTrackQuality(points: GpxPoint[]): {
  avgPointSpacingMeters: number;
  maxSegmentDistanceMeters: number;
  gpsJumpCount: number;
} {
  if (points.length < 2) {
    return {
      avgPointSpacingMeters: 0,
      maxSegmentDistanceMeters: 0,
      gpsJumpCount: 0,
    };
  }

  const segmentDistances: number[] = [];
  let gpsJumpCount = 0;

  // Calculate distance between each consecutive pair of points
  for (let i = 1; i < points.length; i++) {
    const prevPoint = turf.point([points[i - 1].lng, points[i - 1].lat]);
    const currPoint = turf.point([points[i].lng, points[i].lat]);
    const distanceMeters = turf.distance(prevPoint, currPoint, {
      units: "meters",
    });

    segmentDistances.push(distanceMeters);

    // Check if this is a GPS jump (unrealistic distance)
    if (distanceMeters > GPS_QUALITY.JUMP_THRESHOLD_METERS) {
      gpsJumpCount++;
    }
  }

  // Calculate average point spacing
  const avgPointSpacingMeters =
    segmentDistances.length > 0
      ? segmentDistances.reduce((sum, dist) => sum + dist, 0) /
        segmentDistances.length
      : 0;

  // Find maximum segment distance
  const maxSegmentDistanceMeters =
    segmentDistances.length > 0
      ? Math.max(...segmentDistances)
      : 0;

  return {
    avgPointSpacingMeters: Math.round(avgPointSpacingMeters * 100) / 100,
    maxSegmentDistanceMeters: Math.round(maxSegmentDistanceMeters * 100) / 100,
    gpsJumpCount,
  };
}

// ============================================
// GPS Jump Detection Helper
// ============================================

/**
 * Detect GPS jumps in a track (points with unrealistic distances)
 *
 * Helper function that identifies specific GPS jumps in the track.
 * Returns an array of jump indices and distances for detailed analysis.
 *
 * A GPS jump is defined as:
 * - Distance between consecutive points > JUMP_THRESHOLD_METERS (default: 100m)
 * - Indicates potential GPS errors, signal loss, or recording issues
 *
 * @param points - Array of GPS coordinates
 * @returns Array of jump information: { index, distance, prevPoint, currPoint }
 *
 * @example
 * const points = [
 *   { lat: 50.79, lng: -1.09 },
 *   { lat: 50.80, lng: -1.10 }, // Normal
 *   { lat: 50.90, lng: -1.20 }, // Jump at index 2
 * ];
 * const jumps = detectGpsJumps(points);
 * // Returns: [{ index: 2, distance: 1250.8, ... }]
 */
export function detectGpsJumps(points: GpxPoint[]): Array<{
  index: number;
  distance: number;
  prevPoint: GpxPoint;
  currPoint: GpxPoint;
}> {
  const jumps: Array<{
    index: number;
    distance: number;
    prevPoint: GpxPoint;
    currPoint: GpxPoint;
  }> = [];

  for (let i = 1; i < points.length; i++) {
    const prevPoint = turf.point([points[i - 1].lng, points[i - 1].lat]);
    const currPoint = turf.point([points[i].lng, points[i].lat]);
    const distanceMeters = turf.distance(prevPoint, currPoint, {
      units: "meters",
    });

    if (distanceMeters > GPS_QUALITY.JUMP_THRESHOLD_METERS) {
      jumps.push({
        index: i,
        distance: Math.round(distanceMeters * 100) / 100,
        prevPoint: points[i - 1],
        currPoint: points[i],
      });
    }
  }

  return jumps;
}

// ============================================
// Combined Analysis Builder
// ============================================

/**
 * Build comprehensive GPX analysis with all quality metrics
 *
 * Combines basic GPX analysis (distance, duration) with Phase 3 enhancements
 * (moving/stopped time, quality metrics). This provides a complete picture
 * of the GPX track quality and performance.
 *
 * @param gpxData - Parsed GPX data from gpx.service.ts
 * @returns Enhanced analysis object with all metrics
 *
 * @example
 * const gpxData = parseGpxBuffer(buffer);
 * const analysis = buildComprehensiveAnalysis(gpxData);
 * // Returns: {
 * //   totalDistanceMeters: 3617.26,
 * //   durationSeconds: 1845,
 * //   movingTimeSeconds: 1720,
 * //   stoppedTimeSeconds: 125,
 * //   avgPointSpacingMeters: 33.5,
 * //   maxSegmentDistanceMeters: 89.2,
 * //   gpsJumpCount: 0,
 * //   ...
 * // }
 */
export function buildComprehensiveAnalysis(gpxData: ParsedGpxData): {
  // Basic metrics
  totalDistanceMeters: number;
  durationSeconds: number;
  pointsCount: number;
  gpxName?: string;
  startTime?: Date;
  endTime?: Date;

  // Phase 3: Time breakdown
  movingTimeSeconds: number;
  stoppedTimeSeconds: number;

  // Phase 3: Quality metrics
  avgPointSpacingMeters: number;
  maxSegmentDistanceMeters: number;
  gpsJumpCount: number;
} {
  const { points } = gpxData;

  // Basic calculations
  const totalDistanceMeters = calculateTotalDistance(points);
  const durationSeconds = calculateDuration(points);

  // Phase 3: Moving vs stopped time
  const { movingSeconds, stoppedSeconds } =
    calculateMovingStoppedTime(points);

  // Phase 3: Track quality metrics
  const qualityMetrics = calculateTrackQuality(points);

  return {
    // Basic metrics
    totalDistanceMeters: Math.round(totalDistanceMeters * 100) / 100,
    durationSeconds,
    pointsCount: points.length,
    gpxName: gpxData.name,
    startTime: gpxData.startTime,
    endTime: gpxData.endTime,

    // Phase 3: Time breakdown
    movingTimeSeconds: movingSeconds,
    stoppedTimeSeconds: stoppedSeconds,

    // Phase 3: Quality metrics
    avgPointSpacingMeters: qualityMetrics.avgPointSpacingMeters,
    maxSegmentDistanceMeters: qualityMetrics.maxSegmentDistanceMeters,
    gpsJumpCount: qualityMetrics.gpsJumpCount,
  };
}

/**
 * Calculate duration in seconds from GPS timestamps
 *
 * Helper function extracted from geo.service.ts for use in analysis.
 * Finds the first and last points with timestamps and calculates the difference.
 *
 * @param points - Array of GPS coordinates (may include timestamps)
 * @returns Duration in seconds, or 0 if timestamps unavailable
 */
function calculateDuration(points: GpxPoint[]): number {
  // Find first point with a timestamp
  const firstTime = points.find((p) => p.timestamp)?.timestamp;

  // Find last point with a timestamp (search from end)
  const lastTime = [...points].reverse().find((p) => p.timestamp)?.timestamp;

  // If either timestamp is missing, can't calculate duration
  if (!firstTime || !lastTime) return 0;

  // Calculate difference in seconds
  return Math.floor((lastTime.getTime() - firstTime.getTime()) / 1000);
}
