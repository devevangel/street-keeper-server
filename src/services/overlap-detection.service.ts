/**
 * Overlap Detection Service
 * Detects which routes an activity overlaps with using optimized algorithms
 *
 * PROBLEM:
 * --------
 * When a user completes a run, we need to determine which of their routes
 * were affected. A naive approach would check every GPS point against every
 * route's radius - this is O(n × m) where n = routes, m = GPS points.
 * For a user with 50 routes and a 5km run (~3000 GPS points), this could
 * mean 150,000 distance calculations.
 *
 * SOLUTION: Two-Phase Detection
 * -----------------------------
 *
 * Phase 1: Bounding Box Check (Fast Filter)
 *   - Calculate activity bounding box (min/max lat/lng of all GPS points)
 *   - Expand route circle to axis-aligned bounding box
 *   - If boxes don't intersect → route can't overlap (skip it)
 *   - Time complexity: O(n) where n = routes
 *   - Typically filters out 80-95% of routes
 *
 * Phase 2: Point-in-Circle Check (Precise)
 *   - For routes that passed Phase 1
 *   - Check if ANY GPS point falls within route's radius
 *   - Uses Haversine distance (accurate on Earth's curved surface)
 *   - Early exit: stop checking once ONE point is found inside
 *
 * PERFORMANCE:
 * ------------
 * - Without bbox: O(n × m) = 150,000 operations for 50 routes, 3000 points
 * - With bbox: O(n) + O(k × m) where k = overlapping routes (typically 1-3)
 * - Typical speedup: 10-100x depending on route distribution
 *
 * @example
 * // Find all routes that overlap with an activity
 * const overlappingRoutes = await detectOverlappingRoutes(
 *   "user-123",
 *   activityCoordinates
 * );
 *
 * for (const route of overlappingRoutes) {
 *   console.log(`Activity overlaps with route: ${route.name}`);
 * }
 */

import prisma from "../lib/prisma.js";
import type { GpxPoint } from "../types/run.types.js";

// ============================================
// Type Definitions
// ============================================

/**
 * Axis-aligned bounding box
 *
 * Represents a rectangular region defined by min/max coordinates.
 * Used for fast overlap checks before expensive distance calculations.
 */
export interface BoundingBox {
  /** Minimum latitude (south edge) */
  minLat: number;
  /** Maximum latitude (north edge) */
  maxLat: number;
  /** Minimum longitude (west edge) */
  minLng: number;
  /** Maximum longitude (east edge) */
  maxLng: number;
}

/**
 * Project data needed for overlap detection
 *
 * Minimal project info fetched from database for efficiency.
 */
export interface ProjectForOverlap {
  /** Project ID (UUID) */
  id: string;
  /** Project name (for logging) */
  name: string;
  /** Center latitude of project circle */
  centerLat: number;
  /** Center longitude of project circle */
  centerLng: number;
  /** Radius in meters */
  radiusMeters: number;
}

/**
 * Result of overlap detection for a single project
 */
export interface OverlapResult {
  /** The overlapping project */
  project: ProjectForOverlap;
  /** Sample of GPS points that fell within the project (for debugging) */
  samplePointsInside: GpxPoint[];
  /** Total number of GPS points inside the project */
  pointsInsideCount: number;
}

// ============================================
// Main Detection Function
// ============================================

/**
 * Detect which projects an activity overlaps with
 *
 * Uses two-phase algorithm for efficiency:
 * 1. Fast bounding box filter (eliminates most non-overlapping projects)
 * 2. Precise point-in-circle check (for remaining candidates)
 *
 * @param userId - User whose projects to check
 * @param coordinates - GPS coordinates from the activity
 * @param options - Detection options
 * @returns Array of projects that overlap with the activity
 *
 * @example
 * const overlapping = await detectOverlappingProjects("user-123", gpsPoints);
 * console.log(`Activity overlaps with ${overlapping.length} projects`);
 */
export async function detectOverlappingProjects(
  userId: string,
  coordinates: GpxPoint[],
  options: {
    /** Include archived projects? Default: false */
    includeArchived?: boolean;
    /** Max sample points to return per project. Default: 5 */
    maxSamplePoints?: number;
  } = {}
): Promise<OverlapResult[]> {
  const { includeArchived = false, maxSamplePoints = 5 } = options;

  if (coordinates.length === 0) {
    console.log("[Overlap] No coordinates provided, returning empty result");
    return [];
  }

  const activityBbox = calculateBoundingBox(coordinates);
  console.log(
    `[Overlap] Activity bbox: lat[${activityBbox.minLat.toFixed(
      4
    )}, ${activityBbox.maxLat.toFixed(4)}], ` +
      `lng[${activityBbox.minLng.toFixed(4)}, ${activityBbox.maxLng.toFixed(
        4
      )}]`
  );

  const projects = await prisma.project.findMany({
    where: {
      userId,
      ...(includeArchived ? {} : { isArchived: false }),
    },
    select: {
      id: true,
      name: true,
      centerLat: true,
      centerLng: true,
      radiusMeters: true,
    },
  });

  console.log(`[Overlap] Checking ${projects.length} projects for overlap`);

  if (projects.length === 0) {
    return [];
  }

  const candidateProjects = projects.filter((project) => {
    const projectBbox = projectToBoundingBox(project);
    return bboxIntersects(activityBbox, projectBbox);
  });

  console.log(
    `[Overlap] Phase 1 (bbox): ${projects.length} projects → ${candidateProjects.length} candidates`
  );

  const overlappingProjects: OverlapResult[] = [];

  for (const project of candidateProjects) {
    const result = checkProjectOverlap(project, coordinates, maxSamplePoints);

    if (result.overlaps) {
      overlappingProjects.push({
        project,
        samplePointsInside: result.samplePoints,
        pointsInsideCount: result.pointsInsideCount,
      });
    }
  }

  console.log(
    `[Overlap] Phase 2 (precise): ${candidateProjects.length} candidates → ${overlappingProjects.length} overlapping`
  );

  return overlappingProjects;
}

// ============================================
// Phase 1: Bounding Box Operations
// ============================================

/**
 * Calculate bounding box for a set of GPS coordinates
 *
 * Finds the minimum and maximum lat/lng values to create
 * an axis-aligned rectangle containing all points.
 *
 * @param coordinates - Array of GPS points
 * @returns Bounding box containing all points
 *
 * @example
 * const bbox = calculateBoundingBox([
 *   { lat: 50.78, lng: -1.09 },
 *   { lat: 50.79, lng: -1.08 },
 *   { lat: 50.785, lng: -1.085 },
 * ]);
 * // Returns: { minLat: 50.78, maxLat: 50.79, minLng: -1.09, maxLng: -1.08 }
 */
export function calculateBoundingBox(coordinates: GpxPoint[]): BoundingBox {
  // Initialize with first point
  let minLat = coordinates[0].lat;
  let maxLat = coordinates[0].lat;
  let minLng = coordinates[0].lng;
  let maxLng = coordinates[0].lng;

  // Iterate through all points to find min/max
  for (let i = 1; i < coordinates.length; i++) {
    const point = coordinates[i];

    if (point.lat < minLat) minLat = point.lat;
    if (point.lat > maxLat) maxLat = point.lat;
    if (point.lng < minLng) minLng = point.lng;
    if (point.lng > maxLng) maxLng = point.lng;
  }

  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Convert a circular project to a bounding box
 *
 * Expands the project's center point by its radius in all directions
 * to create an axis-aligned bounding box that fully contains the circle.
 *
 * @param project - Project with center and radius
 * @returns Bounding box containing the entire project circle
 */
export function projectToBoundingBox(project: ProjectForOverlap): BoundingBox {
  const METERS_PER_DEGREE_LAT = 110574;
  const latDelta = project.radiusMeters / METERS_PER_DEGREE_LAT;
  const metersPerDegreeLng =
    METERS_PER_DEGREE_LAT * Math.cos(toRadians(project.centerLat));
  const lngDelta = project.radiusMeters / metersPerDegreeLng;

  return {
    minLat: project.centerLat - latDelta,
    maxLat: project.centerLat + latDelta,
    minLng: project.centerLng - lngDelta,
    maxLng: project.centerLng + lngDelta,
  };
}

/**
 * Check if two bounding boxes intersect
 *
 * Two boxes intersect if they overlap on BOTH axes.
 * They DON'T intersect if separated on ANY axis.
 *
 * VISUAL:
 * ```
 * Case 1: Intersecting       Case 2: Not intersecting (separated on X)
 *
 *   +-------+                     +-------+
 *   |   +---|---+                 |       |      +-------+
 *   |   |   |   |                 |       |      |       |
 *   +---|---+   |                 +-------+      |       |
 *       +-------+                                +-------+
 * ```
 *
 * @param a - First bounding box
 * @param b - Second bounding box
 * @returns True if boxes intersect (overlap)
 */
export function bboxIntersects(a: BoundingBox, b: BoundingBox): boolean {
  // Check if separated on latitude axis (vertical)
  // If a's north edge is south of b's south edge, or vice versa
  if (a.maxLat < b.minLat || b.maxLat < a.minLat) {
    return false;
  }

  // Check if separated on longitude axis (horizontal)
  // If a's east edge is west of b's west edge, or vice versa
  if (a.maxLng < b.minLng || b.maxLng < a.minLng) {
    return false;
  }

  // Not separated on either axis = they intersect
  return true;
}

// ============================================
// Phase 2: Point-in-Circle Check
// ============================================

/**
 * Check if a project overlaps with coordinates (precise check)
 */
function checkProjectOverlap(
  project: ProjectForOverlap,
  coordinates: GpxPoint[],
  maxSamplePoints: number
): { overlaps: boolean; samplePoints: GpxPoint[]; pointsInsideCount: number } {
  const samplePoints: GpxPoint[] = [];
  let pointsInsideCount = 0;

  for (const point of coordinates) {
    const distance = haversineDistance(
      project.centerLat,
      project.centerLng,
      point.lat,
      point.lng
    );

    if (distance <= project.radiusMeters) {
      pointsInsideCount++;
      if (samplePoints.length < maxSamplePoints) {
        samplePoints.push(point);
      }
    }
  }

  return {
    overlaps: pointsInsideCount > 0,
    samplePoints,
    pointsInsideCount,
  };
}

/**
 * Check if a single point is inside a project's radius
 */
export function isPointInProject(
  point: GpxPoint,
  project: ProjectForOverlap
): boolean {
  const distance = haversineDistance(
    project.centerLat,
    project.centerLng,
    point.lat,
    point.lng
  );
  return distance <= project.radiusMeters;
}

// ============================================
// Distance Calculation
// ============================================

/**
 * Calculate distance between two points using Haversine formula
 *
 * The Haversine formula calculates the great-circle distance between
 * two points on a sphere. This is the shortest distance over the
 * Earth's surface (as the crow flies).
 *
 * FORMULA EXPLANATION:
 * -------------------
 * The formula accounts for Earth's curvature:
 *
 * a = sin²(Δlat/2) + cos(lat1) × cos(lat2) × sin²(Δlng/2)
 * c = 2 × atan2(√a, √(1-a))
 * d = R × c
 *
 * Where:
 * - Δlat, Δlng = differences in latitude/longitude
 * - R = Earth's radius (6,371,000 meters)
 * - d = distance in meters
 *
 * ACCURACY:
 * - Very accurate for distances up to several hundred km
 * - Error < 0.3% for most use cases
 * - Slightly less accurate near poles
 *
 * @param lat1 - Latitude of first point (degrees)
 * @param lng1 - Longitude of first point (degrees)
 * @param lat2 - Latitude of second point (degrees)
 * @param lng2 - Longitude of second point (degrees)
 * @returns Distance in meters
 *
 * @example
 * // Distance between two points in Portsmouth
 * const distance = haversineDistance(50.788, -1.089, 50.792, -1.095);
 * console.log(`${distance.toFixed(0)}m`); // ~600m
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth's radius in meters

  // Convert latitude and longitude differences to radians
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  // Haversine formula components
  // a = sin²(Δlat/2) + cos(lat1) × cos(lat2) × sin²(Δlng/2)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  // c = 2 × atan2(√a, √(1-a))
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  // d = R × c
  return R * c;
}

/**
 * Convert degrees to radians
 *
 * @param degrees - Angle in degrees
 * @returns Angle in radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

// ============================================
// Utility Functions
// ============================================

/**
 * Get projects that potentially overlap with a bounding box
 *
 * @param userId - User ID
 * @param bbox - Bounding box to check against
 * @returns Projects that might overlap (needs Phase 2 verification)
 */
export async function getProjectsInBbox(
  userId: string,
  bbox: BoundingBox
): Promise<ProjectForOverlap[]> {
  const projects = await prisma.project.findMany({
    where: {
      userId,
      isArchived: false,
    },
    select: {
      id: true,
      name: true,
      centerLat: true,
      centerLng: true,
      radiusMeters: true,
    },
  });

  return projects.filter((project) => {
    const projectBbox = projectToBoundingBox(project);
    return bboxIntersects(bbox, projectBbox);
  });
}

/**
 * Calculate approximate area of a bounding box in square meters
 *
 * Useful for logging and debugging overlap detection.
 *
 * @param bbox - Bounding box
 * @returns Approximate area in square meters
 */
export function bboxArea(bbox: BoundingBox): number {
  const METERS_PER_DEGREE_LAT = 110574;
  const avgLat = (bbox.minLat + bbox.maxLat) / 2;
  const metersPerDegreeLng =
    METERS_PER_DEGREE_LAT * Math.cos(toRadians(avgLat));

  const heightMeters = (bbox.maxLat - bbox.minLat) * METERS_PER_DEGREE_LAT;
  const widthMeters = (bbox.maxLng - bbox.minLng) * metersPerDegreeLng;

  return heightMeters * widthMeters;
}
