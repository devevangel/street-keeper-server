/**
 * Geo Service
 * Geospatial calculations for GPS data using Turf.js
 *
 * This service provides utility functions for:
 * - Calculating distances between GPS points (Haversine formula)
 * - Computing bounding boxes around GPS tracks
 * - Measuring point-to-line distances (for street matching)
 * - Calculating line/street lengths
 * - Projecting GPS points onto street geometry (Phase 2)
 * - Measuring distance along street geometry (Phase 2)
 *
 * All distance calculations return values in METERS.
 *
 * Dependencies:
 * - @turf/turf: Industry-standard geospatial library
 *
 * Phase 2 Enhancement: Street Geometry Coverage Projection
 * - Projects GPS points onto the nearest point on street centerline
 * - Measures distance along the street geometry itself
 * - More accurate than measuring distance between GPS points
 * - Accounts for GPS drift (typically 5-15m accuracy)
 */

import * as turf from "@turf/turf";
import type { GpxPoint, BoundingBox, GeoJsonLineString } from "../types/run.types.js";
import { STREET_MATCHING } from "../config/constants.js";

// ============================================
// Distance Calculations
// ============================================

/**
 * Calculate total distance of a GPS track in meters
 *
 * Sums the distance between each consecutive pair of points
 * using the Haversine formula (accounts for Earth's curvature).
 *
 * @param points - Array of GPS coordinates in order
 * @returns Total distance in meters, rounded to 2 decimal places
 *
 * @example
 * const points = [
 *   { lat: 50.7989, lng: -1.0912 },
 *   { lat: 50.7991, lng: -1.0915 },
 *   { lat: 50.7995, lng: -1.0920 },
 * ];
 * const distance = calculateTotalDistance(points);
 * // Returns: 52.34 (meters)
 */
export function calculateTotalDistance(points: GpxPoint[]): number {
  // Need at least 2 points to calculate distance
  if (points.length < 2) return 0;

  let totalDistance = 0;

  // Sum distance between each consecutive pair of points
  for (let i = 1; i < points.length; i++) {
    const from = turf.point([points[i - 1].lng, points[i - 1].lat]);
    const to = turf.point([points[i].lng, points[i].lat]);

    // turf.distance returns kilometers by default, we want meters
    totalDistance += turf.distance(from, to, { units: "meters" });
  }

  // Round to 2 decimal places for cleaner output
  return Math.round(totalDistance * 100) / 100;
}

/**
 * Calculate the distance covered along a path (alias for calculateTotalDistance)
 *
 * Used when calculating how much of a street was covered.
 *
 * @param points - Array of GPS coordinates
 * @returns Distance in meters
 */
export function calculatePathDistance(points: GpxPoint[]): number {
  return calculateTotalDistance(points);
}

// ============================================
// Duration Calculation
// ============================================

/**
 * Calculate duration in seconds from GPS timestamps
 *
 * Finds the first and last points with timestamps and
 * calculates the time difference.
 *
 * @param points - Array of GPS coordinates (may include timestamps)
 * @returns Duration in seconds, or 0 if timestamps unavailable
 *
 * @example
 * const points = [
 *   { lat: 50.79, lng: -1.09, timestamp: new Date("2026-01-17T08:00:00Z") },
 *   { lat: 50.80, lng: -1.10, timestamp: new Date("2026-01-17T08:30:45Z") },
 * ];
 * const duration = calculateDuration(points);
 * // Returns: 1845 (30 minutes 45 seconds)
 */
export function calculateDuration(points: GpxPoint[]): number {
  // Find first point with a timestamp
  const firstTime = points.find((p) => p.timestamp)?.timestamp;

  // Find last point with a timestamp (search from end)
  const lastTime = [...points].reverse().find((p) => p.timestamp)?.timestamp;

  // If either timestamp is missing, can't calculate duration
  if (!firstTime || !lastTime) return 0;

  // Calculate difference in seconds
  return Math.floor((lastTime.getTime() - firstTime.getTime()) / 1000);
}

// ============================================
// Bounding Box Calculation
// ============================================

/**
 * Calculate bounding box around GPS points with buffer
 *
 * Creates a rectangular region that contains all GPS points,
 * plus a buffer zone around them. Used to query streets from
 * OpenStreetMap in the relevant area only.
 *
 * Buffer is added to ensure we capture streets at the edges
 * of the GPS track.
 *
 * @param points - Array of GPS coordinates
 * @returns Bounding box with south, north, west, east coordinates
 *
 * @example
 * const points = [
 *   { lat: 50.7989, lng: -1.0912 },
 *   { lat: 50.8010, lng: -1.0950 },
 * ];
 * const bbox = calculateBoundingBox(points);
 * // Returns: { south: 50.798, north: 50.802, west: -1.096, east: -1.090 }
 */
export function calculateBoundingBox(points: GpxPoint[]): BoundingBox {
  // Extract all latitudes and longitudes
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);

  // Find min/max values
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  // Add buffer around the bounding box
  // Convert meters to degrees: 1 degree ≈ 111,000 meters at equator
  // This is approximate but sufficient for our purposes
  const bufferDeg = STREET_MATCHING.BBOX_BUFFER_METERS / 111000;

  return {
    south: minLat - bufferDeg, // Bottom edge
    north: maxLat + bufferDeg, // Top edge
    west: minLng - bufferDeg, // Left edge
    east: maxLng + bufferDeg, // Right edge
  };
}

// ============================================
// Point-to-Line Distance
// ============================================

/**
 * Calculate distance from a GPS point to a street line in meters
 *
 * Used to determine if a GPS point is "on" a street.
 * If the distance is less than MAX_DISTANCE_METERS (25m),
 * we consider the point to be on that street.
 *
 * @param point - Single GPS coordinate
 * @param lineCoords - Array of [lng, lat] pairs forming the street line
 * @returns Distance in meters from point to nearest point on line
 *
 * @example
 * const point = { lat: 50.7989, lng: -1.0912 };
 * const streetCoords = [[-1.0910, 50.7985], [-1.0915, 50.7995]];
 * const distance = pointToLineDistance(point, streetCoords);
 * // Returns: 12.5 (meters from point to street)
 */
export function pointToLineDistance(
  point: GpxPoint,
  lineCoords: [number, number][]
): number {
  // Create Turf.js point (GeoJSON uses [lng, lat] order)
  const pt = turf.point([point.lng, point.lat]);

  // Create Turf.js line from coordinates
  const line = turf.lineString(lineCoords);

  // Calculate perpendicular distance from point to line
  return turf.pointToLineDistance(pt, line, { units: "meters" });
}

// ============================================
// Line Length Calculation
// ============================================

/**
 * Calculate length of a line geometry (street) in meters
 *
 * Used to determine the total length of a street from OpenStreetMap.
 *
 * @param geometry - GeoJSON LineString with coordinates
 * @returns Length in meters
 *
 * @example
 * const geometry = {
 *   type: "LineString",
 *   coordinates: [[-1.0910, 50.7985], [-1.0915, 50.7995], [-1.0920, 50.8005]]
 * };
 * const length = calculateLineLength(geometry);
 * // Returns: 245.67 (meters)
 */
export function calculateLineLength(geometry: GeoJsonLineString): number {
  // Create Turf.js line from GeoJSON geometry
  const line = turf.lineString(geometry.coordinates);

  // Calculate total length along the line
  return turf.length(line, { units: "meters" });
}

// ============================================
// Phase 2: Street Geometry Coverage Projection
// ============================================

/**
 * Project a GPS point onto the nearest point on a street line
 *
 * Phase 2 Implementation: Street Geometry Coverage Projection
 *
 * GPS devices have inherent inaccuracy (typically 5-15 meters). When a runner
 * is on a street, their GPS points may appear slightly off the street centerline
 * due to this drift. This function projects each GPS point onto the nearest
 * point on the actual street geometry, giving us the "true" position along
 * the street.
 *
 * How it works:
 * 1. Find the nearest point on the street line to the GPS point
 * 2. Return the projected coordinate (on the street centerline)
 * 3. Also return the distance along the street from the start (for measuring coverage)
 *
 * Why this matters:
 * - Old approach: Measure distance between GPS points (which may be off-street)
 * - New approach: Project GPS points onto street, measure distance along street geometry
 * - Result: More accurate coverage ratios that reflect actual street usage
 *
 * @param point - GPS coordinate (may be slightly off the street)
 * @param streetGeometry - GeoJSON LineString representing the street centerline
 * @returns Projected point on street and distance along street from start
 *
 * @example
 * const gpsPoint = { lat: 50.7989, lng: -1.0912 };
 * const street = {
 *   type: "LineString",
 *   coordinates: [[-1.0910, 50.7985], [-1.0915, 50.7995], [-1.0920, 50.8005]]
 * };
 * const projected = projectPointOntoStreet(gpsPoint, street);
 * // Returns: {
 * //   projectedPoint: { lat: 50.7987, lng: -1.0911 }, // On street centerline
 * //   distanceAlongStreet: 45.2 // Meters from street start
 * // }
 */
export function projectPointOntoStreet(
  point: GpxPoint,
  streetGeometry: GeoJsonLineString
): { projectedPoint: GpxPoint; distanceAlongStreet: number } {
  // Create Turf.js point from GPS coordinate
  const gpsTurfPoint = turf.point([point.lng, point.lat]);

  // Create Turf.js line from street geometry
  const streetLine = turf.lineString(streetGeometry.coordinates);

  // Find nearest point on the line to our GPS point
  // This returns the projected point AND properties including location along line
  const nearestPoint = turf.nearestPointOnLine(streetLine, gpsTurfPoint, {
    units: "meters",
  });

  // Extract projected coordinates (GeoJSON uses [lng, lat])
  const [projectedLng, projectedLat] = nearestPoint.geometry.coordinates;

  // Calculate distance along the street from the start to the projected point
  // We'll measure cumulative distance along each segment
  let distanceAlongStreet = 0;
  const coords = streetGeometry.coordinates;
  const projectedTurfPoint = turf.point([projectedLng, projectedLat]);

  // Find which segment contains the projected point by checking distance to each segment
  let minDistToSegment = Infinity;
  let closestSegmentIndex = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const segmentLine = turf.lineString([coords[i], coords[i + 1]]);
    const distToSegment = turf.pointToLineDistance(
      projectedTurfPoint,
      segmentLine,
      { units: "meters" }
    );

    if (distToSegment < minDistToSegment) {
      minDistToSegment = distToSegment;
      closestSegmentIndex = i;
    }
  }

  // Calculate distance along street to start of closest segment
  for (let i = 0; i < closestSegmentIndex; i++) {
    distanceAlongStreet += turf.distance(
      turf.point(coords[i]),
      turf.point(coords[i + 1]),
      { units: "meters" }
    );
  }

  // Add distance along the closest segment to the projected point
  const segmentStart = turf.point(coords[closestSegmentIndex]);
  const segmentLine = turf.lineString([
    coords[closestSegmentIndex],
    coords[closestSegmentIndex + 1],
  ]);
  const segmentNearest = turf.nearestPointOnLine(
    segmentLine,
    projectedTurfPoint,
    { units: "meters" }
  );
  distanceAlongStreet += turf.distance(segmentStart, segmentNearest, {
    units: "meters",
  });

  return {
    projectedPoint: {
      lat: projectedLat,
      lng: projectedLng,
      elevation: point.elevation,
      timestamp: point.timestamp,
    },
    distanceAlongStreet: Math.round(distanceAlongStreet * 100) / 100,
  };
}

/**
 * Calculate distance covered along street geometry for consecutive segments
 *
 * Phase 2 Implementation: Geometry-Based Distance Calculation
 *
 * This function improves upon Phase 1 by measuring distance along the actual
 * street geometry rather than between GPS points. It:
 * 1. Projects each GPS point onto the street centerline
 * 2. Finds consecutive segments (same as Phase 1)
 * 3. Measures distance along the street geometry between projected points
 *
 * Benefits over Phase 1:
 * - Accounts for GPS drift (points projected onto street)
 * - Measures actual distance traveled along street (not straight-line GPS distance)
 * - More accurate coverage ratios, especially on curved streets
 *
 * Algorithm:
 * 1. Project all GPS points onto street geometry
 * 2. Sort by original GPS track index
 * 3. Identify consecutive segments (indices are sequential)
 * 4. For each segment, measure distance along street geometry between projected points
 * 5. Sum segment distances
 *
 * @param pointsWithIndices - Array of GPS points with their original track indices
 * @param streetGeometry - GeoJSON LineString representing the street centerline
 * @returns Total distance in meters measured along street geometry (consecutive segments only)
 *
 * @example
 * // Runner on Main St: points at indices [10, 11, 12]
 * // Street geometry: curved road with 3 segments
 * const points = [
 *   { point: { lat: 50.79, lng: -1.09 }, index: 10 },
 *   { point: { lat: 50.80, lng: -1.10 }, index: 11 },
 *   { point: { lat: 50.81, lng: -1.11 }, index: 12 },
 * ];
 * const streetGeometry = {
 *   type: "LineString",
 *   coordinates: [[-1.09, 50.79], [-1.10, 50.80], [-1.11, 50.81]]
 * };
 * const distance = calculateGeometryDistance(points, streetGeometry);
 * // Returns: Distance along street geometry from projected(10) → projected(11) → projected(12)
 * // This is more accurate than straight-line GPS distance, especially on curves
 */
export function calculateGeometryDistance(
  pointsWithIndices: Array<{ point: GpxPoint; index: number }>,
  streetGeometry: GeoJsonLineString
): number {
  // Need at least 2 points to calculate distance
  if (pointsWithIndices.length < 2) return 0;

  // Project all points onto street geometry
  const projectedPoints = pointsWithIndices.map((pwi) => ({
    ...projectPointOntoStreet(pwi.point, streetGeometry),
    originalIndex: pwi.index,
  }));

  // Sort by original index to process in order
  const sorted = projectedPoints.sort(
    (a, b) => a.originalIndex - b.originalIndex
  );

  let totalDistance = 0;
  let segmentStart = 0;

  // Find consecutive segments and calculate distance along geometry within each
  for (let i = 1; i < sorted.length; i++) {
    const prevIndex = sorted[i - 1].originalIndex;
    const currIndex = sorted[i].originalIndex;

    // Check if this point is consecutive to the previous one
    const isConsecutive = currIndex === prevIndex + 1;

    if (!isConsecutive) {
      // End of current segment, calculate distance along geometry for this segment
      const segmentDistance = calculateSegmentGeometryDistance(
        sorted.slice(segmentStart, i),
        streetGeometry
      );
      totalDistance += segmentDistance;

      // Start new segment
      segmentStart = i;
    }
  }

  // Don't forget the last segment
  const lastSegmentDistance = calculateSegmentGeometryDistance(
    sorted.slice(segmentStart),
    streetGeometry
  );
  totalDistance += lastSegmentDistance;

  return Math.round(totalDistance * 100) / 100;
}

/**
 * Calculate distance along street geometry for a consecutive segment
 *
 * Helper function for calculateGeometryDistance. Measures the distance along
 * the street geometry between projected points in a consecutive segment.
 *
 * @param projectedPoints - Array of projected points with distances along street
 * @param streetGeometry - GeoJSON LineString representing the street
 * @returns Distance in meters along street geometry
 */
function calculateSegmentGeometryDistance(
  projectedPoints: Array<{
    projectedPoint: GpxPoint;
    distanceAlongStreet: number;
    originalIndex: number;
  }>,
  streetGeometry: GeoJsonLineString
): number {
  if (projectedPoints.length < 2) return 0;

  // For consecutive points, measure distance along street geometry
  // by taking the difference in distanceAlongStreet values
  let segmentDistance = 0;

  for (let i = 1; i < projectedPoints.length; i++) {
    const prevDist = projectedPoints[i - 1].distanceAlongStreet;
    const currDist = projectedPoints[i].distanceAlongStreet;

    // Distance along street = difference in positions along the line
    // Use absolute value to handle direction (forward or backward)
    const segmentDist = Math.abs(currDist - prevDist);
    segmentDistance += segmentDist;
  }

  return segmentDistance;
}
