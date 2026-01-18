/**
 * Street Matching Service
 * Matches GPS points to streets with high accuracy
 *
 * This is the CORE service for determining which streets a runner covered.
 *
 * How it works:
 * 1. For each GPS point, find the nearest street (within 25m threshold)
 * 2. Group all points by which street they belong to (preserving original indices)
 * 3. Calculate distance covered using two methods:
 *    a. Phase 1: Consecutive GPS point distance (prevents jump inflation)
 *    b. Phase 2: Geometry-based distance (projects points onto street, more accurate)
 * 4. Determine if each street was FULL (≥90%) or PARTIAL (<90%) completion
 *
 * Algorithm visualization:
 *
 *   GPS Points:     •  •  •  •  •  •  •  •  •
 *                    \  |  /     \  |  /
 *   Streets:      ════════════  ════════════
 *                  Main Street   Oak Avenue
 *
 *   Result: Main Street (5 points), Oak Avenue (4 points)
 *
 * Phase 1: Consecutive-Only Distance Calculation
 * - Only counts distance between consecutive GPS points on the same street
 * - Ignores "jumps" when runner leaves and returns to a street
 * - Prevents inflated coverage ratios (>100%) from non-consecutive point grouping
 * - Example: Points at indices [5,6,7,20,21] → segments [5,6,7] and [20,21]
 *            Only measures distance within each segment, not between segments
 *
 * Phase 2: Street Geometry Coverage Projection
 * - Projects each GPS point onto the nearest point on the street centerline
 * - Measures distance along the actual street geometry (not straight-line GPS distance)
 * - Accounts for GPS drift (typically 5-15m accuracy)
 * - More accurate coverage ratios, especially on curved streets
 * - Example: GPS point 10m off street → projected onto centerline → distance measured along curve
 *
 * Accuracy considerations:
 * - 25m threshold accounts for GPS drift (typically 5-15m accuracy)
 * - Minimum 3 points per street filters out noise/brief touches
 * - 90% completion threshold accounts for GPS inaccuracy at street ends
 * - Geometry projection (Phase 2) provides most accurate coverage measurement
 */

import type {
  GpxPoint,
  OsmStreet,
  MatchedStreet,
  CompletionStatus,
} from "../types/run.types.js";
import { STREET_MATCHING } from "../config/constants.js";
import {
  pointToLineDistance,
  calculatePathDistance,
  calculateGeometryDistance,
} from "./geo.service.js";
import {
  mapMatchGpsTrace,
  extractStreetsFromMatch,
  isMapboxConfigured,
  MapboxError,
  type MapboxExtractedStreet,
} from "./mapbox.service.js";
import {
  normalizeStreetNameForMatching,
  streetNamesMatch,
} from "./street-aggregation.service.js";

// ============================================
// Main Matching Function
// ============================================

/**
 * Match GPS points to streets and calculate coverage
 *
 * This is the main entry point. Takes GPS points and available streets,
 * returns a list of all streets the runner covered with coverage data.
 *
 * The function uses a two-phase approach for accurate coverage calculation:
 * - Phase 1: Consecutive-only distance (prevents jump inflation)
 * - Phase 2: Geometry-based distance (projects points onto street, most accurate)
 *
 * The returned MatchedStreet objects include both distance measurements:
 * - distanceCoveredMeters: Phase 1 measurement (GPS point-to-point)
 * - geometryDistanceCoveredMeters: Phase 2 measurement (along street geometry)
 * - coverageRatio: Phase 1 coverage ratio
 * - geometryCoverageRatio: Phase 2 coverage ratio (used for completion status)
 *
 * @param points - Array of GPS coordinates from the GPX file
 * @param streets - Array of streets from OpenStreetMap (via Overpass, includes geometry)
 * @returns Array of matched streets with coverage data, sorted by distance covered
 *
 * @example
 * const points = [{ lat: 50.79, lng: -1.09 }, ...];
 * const streets = await queryStreetsInBoundingBox(bbox);
 * const matched = matchPointsToStreets(points, streets);
 * // Returns: [
 * //   {
 * //     name: "High Street",
 * //     distanceCoveredMeters: 450.25,        // Phase 1: GPS distance
 * //     geometryDistanceCoveredMeters: 445.18, // Phase 2: Geometry distance (more accurate)
 * //     coverageRatio: 0.95,                  // Phase 1 ratio
 * //     geometryCoverageRatio: 0.94,          // Phase 2 ratio (used for status)
 * //     completionStatus: "FULL",              // Based on geometry ratio
 * //     ...
 * //   },
 * //   ...
 * // ]
 */
export function matchPointsToStreets(
  points: GpxPoint[],
  streets: OsmStreet[]
): MatchedStreet[] {
  // No streets in area = no matches
  if (streets.length === 0) return [];

  // Step 1: Assign each GPS point to its nearest street
  // Returns array like [null, "way/123", "way/123", "way/456", null, ...]
  const pointStreetAssignments = assignPointsToStreets(points, streets);

  // Step 2: Group points by street with original indices
  // Returns Map: "way/123" => [{point, index}, {point, index}, ...]
  const streetGroups = groupPointsByStreetWithIndices(pointStreetAssignments, points);

  // Step 3: Calculate coverage metrics for each street (consecutive segments only)
  const matchedStreets = calculateStreetCoverage(streetGroups, streets);

  // Step 4: Filter out streets with too few points (likely GPS noise)
  // A runner briefly passing near a street shouldn't count as "running on it"
  const filteredStreets = matchedStreets.filter(
    (s) => s.matchedPointsCount >= STREET_MATCHING.MIN_POINTS_PER_STREET
  );

  // Step 5: Sort by distance covered (most covered first)
  // This puts the "main" streets of the run at the top
  return filteredStreets.sort(
    (a, b) => b.distanceCoveredMeters - a.distanceCoveredMeters
  );
}

// ============================================
// Hybrid Matching (Mapbox + Overpass)
// ============================================

/**
 * Match GPS points to streets using hybrid Mapbox + Overpass approach
 *
 * This function provides the most accurate street matching by combining:
 * - **Mapbox Map Matching**: For accurate GPS-to-street assignment (~98% accuracy)
 * - **Overpass Data**: For total street lengths (to calculate coverage percentage)
 *
 * Benefits over Overpass-only matching:
 * - Better handling of GPS drift
 * - Correct intersection handling (uses turn restrictions)
 * - Probabilistic path matching (most likely route)
 * - Street names directly from routing data
 *
 * Fallback: If Mapbox is not configured or fails, falls back to Overpass-only matching.
 *
 * @param points - Array of GPS coordinates from the GPX file
 * @param overpassStreets - Array of streets from Overpass (includes geometry and length)
 * @returns Array of matched streets with coverage data
 *
 * @example
 * const points = [{ lat: 51.48, lng: -0.61 }, ...];
 * const streets = await queryStreetsInBoundingBox(bbox);
 * const matched = await matchPointsToStreetsHybrid(points, streets);
 * // Returns: [
 * //   {
 * //     name: "Peascod Street",
 * //     lengthMeters: 444.28,           // From Overpass (total street length)
 * //     distanceCoveredMeters: 200.00,  // From Mapbox (accurate distance run)
 * //     coverageRatio: 0.45,            // Calculated
 * //     completionStatus: "PARTIAL",
 * //     ...
 * //   }
 * // ]
 */
export async function matchPointsToStreetsHybrid(
  points: GpxPoint[],
  overpassStreets: OsmStreet[]
): Promise<MatchedStreet[]> {
  // Check if Mapbox is configured
  if (!isMapboxConfigured()) {
    console.log("[Hybrid] Mapbox not configured, using Overpass-only matching");
    return matchPointsToStreets(points, overpassStreets);
  }

  try {
    // Step 1: Call Mapbox Map Matching API
    console.log("[Hybrid] Calling Mapbox Map Matching API...");
    const mapboxResult = await mapMatchGpsTrace(points);

    // Step 2: Extract streets from Mapbox response
    const mapboxStreets = extractStreetsFromMatch(mapboxResult);
    console.log(
      `[Hybrid] Mapbox matched ${mapboxStreets.length} streets`
    );

    // Step 3: Cross-reference with Overpass data to get street lengths
    const matchedStreets = crossReferenceStreets(mapboxStreets, overpassStreets);

    console.log(
      `[Hybrid] Final result: ${matchedStreets.length} streets matched`
    );

    return matchedStreets;
  } catch (error) {
    // Log error and fall back to Overpass-only matching
    if (error instanceof MapboxError) {
      console.warn(
        `[Hybrid] Mapbox failed (${error.code || "unknown"}): ${error.message}`
      );
    } else {
      console.warn(
        `[Hybrid] Mapbox failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    console.log("[Hybrid] Falling back to Overpass-only matching");
    return matchPointsToStreets(points, overpassStreets);
  }
}

/**
 * Cross-reference Mapbox streets with Overpass data
 *
 * For each street from Mapbox, finds the matching street in Overpass data
 * to get the total street length. This enables coverage percentage calculation.
 *
 * Matching is done by normalized street name with fuzzy matching to handle
 * differences between Mapbox and OSM naming conventions.
 *
 * @param mapboxStreets - Streets extracted from Mapbox response
 * @param overpassStreets - Streets from Overpass with full geometry
 * @returns Array of matched streets with coverage data
 */
function crossReferenceStreets(
  mapboxStreets: MapboxExtractedStreet[],
  overpassStreets: OsmStreet[]
): MatchedStreet[] {
  const matchedStreets: MatchedStreet[] = [];

  // Group Overpass streets by normalized name for faster lookup
  const overpassByName = new Map<string, OsmStreet[]>();
  for (const street of overpassStreets) {
    const normalized = normalizeStreetNameForMatching(street.name);
    if (!overpassByName.has(normalized)) {
      overpassByName.set(normalized, []);
    }
    overpassByName.get(normalized)!.push(street);
  }

  // Process each Mapbox street
  for (const mbStreet of mapboxStreets) {
    // Skip unnamed roads for now (they're handled separately)
    if (
      !mbStreet.name ||
      mbStreet.name.toLowerCase() === "unnamed road" ||
      mbStreet.name === ""
    ) {
      // Still include unnamed roads but without coverage ratio
      matchedStreets.push({
        osmId: `mapbox-unnamed-${matchedStreets.length}`,
        name: mbStreet.name || "Unnamed Road",
        highwayType: "unknown",
        lengthMeters: 0, // Unknown total length
        distanceCoveredMeters: mbStreet.distanceMeters,
        coverageRatio: 0, // Can't calculate without total length
        completionStatus: "PARTIAL",
        matchedPointsCount: mbStreet.pointsCount,
      });
      continue;
    }

    // Find matching Overpass street by normalized name
    const osmStreet = findMatchingOverpassStreet(mbStreet.name, overpassStreets, overpassByName);

    if (osmStreet) {
      // We have total length from Overpass!
      const coverageRatio =
        osmStreet.lengthMeters > 0
          ? mbStreet.distanceMeters / osmStreet.lengthMeters
          : 0;

      matchedStreets.push({
        osmId: osmStreet.osmId,
        name: osmStreet.name, // Use OSM name for consistency
        highwayType: osmStreet.highwayType,
        lengthMeters: Math.round(osmStreet.lengthMeters * 100) / 100,
        distanceCoveredMeters: Math.round(mbStreet.distanceMeters * 100) / 100,
        coverageRatio: Math.round(coverageRatio * 1000) / 1000,
        geometryDistanceCoveredMeters: Math.round(mbStreet.distanceMeters * 100) / 100,
        geometryCoverageRatio: Math.round(coverageRatio * 1000) / 1000,
        completionStatus: determineCompletionStatus(coverageRatio),
        matchedPointsCount: mbStreet.pointsCount,
      });
    } else {
      // Mapbox found a street that Overpass didn't return
      // This can happen at bounding box edges or with newer streets
      console.log(
        `[Hybrid] No Overpass match for Mapbox street: "${mbStreet.name}"`
      );

      matchedStreets.push({
        osmId: `mapbox-${normalizeStreetNameForMatching(mbStreet.name).replace(/\s/g, "-")}`,
        name: mbStreet.name,
        highwayType: "unknown",
        lengthMeters: 0, // Unknown total length
        distanceCoveredMeters: Math.round(mbStreet.distanceMeters * 100) / 100,
        coverageRatio: 0, // Can't calculate without total length
        completionStatus: "PARTIAL", // Assume partial since we don't know total
        matchedPointsCount: mbStreet.pointsCount,
      });
    }
  }

  // Sort by distance covered (most covered first)
  return matchedStreets.sort(
    (a, b) => b.distanceCoveredMeters - a.distanceCoveredMeters
  );
}

/**
 * Find matching Overpass street by name using fuzzy matching
 *
 * Uses normalized names and fuzzy matching to handle differences between
 * Mapbox and OSM naming conventions (e.g., "St." vs "Saint").
 *
 * If multiple Overpass streets match the name, returns the one with the
 * longest total length (assumes the runner ran on the main portion).
 *
 * @param mapboxName - Street name from Mapbox
 * @param overpassStreets - All Overpass streets
 * @param overpassByName - Precomputed map of normalized names to streets
 * @returns Matching Overpass street, or undefined if not found
 */
function findMatchingOverpassStreet(
  mapboxName: string,
  overpassStreets: OsmStreet[],
  overpassByName: Map<string, OsmStreet[]>
): OsmStreet | undefined {
  const normalizedMapbox = normalizeStreetNameForMatching(mapboxName);

  // First, try exact match on normalized name
  const exactMatches = overpassByName.get(normalizedMapbox);
  if (exactMatches && exactMatches.length > 0) {
    // Return the longest street (assumes main portion)
    return exactMatches.reduce((longest, s) =>
      s.lengthMeters > longest.lengthMeters ? s : longest
    );
  }

  // Second, try fuzzy matching
  for (const [normalizedOsm, streets] of overpassByName) {
    if (streetNamesMatch(normalizedMapbox, normalizedOsm)) {
      // Return the longest street
      return streets.reduce((longest, s) =>
        s.lengthMeters > longest.lengthMeters ? s : longest
      );
    }
  }

  // Third, try matching against all streets (slower, but more thorough)
  const fuzzyMatches = overpassStreets.filter((s) =>
    streetNamesMatch(mapboxName, s.name)
  );

  if (fuzzyMatches.length > 0) {
    // Return the longest match
    return fuzzyMatches.reduce((longest, s) =>
      s.lengthMeters > longest.lengthMeters ? s : longest
    );
  }

  return undefined;
}

// ============================================
// Step 1: Point-to-Street Assignment
// ============================================

/**
 * Assign each GPS point to its nearest street
 *
 * For each point, finds the closest street within MAX_DISTANCE_METERS (25m).
 * If no street is within range, assigns null (point not on any street).
 *
 * @param points - Array of GPS coordinates
 * @param streets - Array of streets to match against
 * @returns Array of street IDs (or null) for each point
 *
 * @example
 * // Point near "High Street" and "Park Lane"
 * // High Street is 10m away, Park Lane is 50m away
 * // Result: "way/123" (High Street, because it's closer and within 25m)
 */
function assignPointsToStreets(
  points: GpxPoint[],
  streets: OsmStreet[]
): (string | null)[] {
  return points.map((point) => {
    let nearestStreetId: string | null = null;
    let nearestDistance = Infinity;

    // Check distance to each street
    for (const street of streets) {
      const distance = pointToLineDistance(point, street.geometry.coordinates);

      // Is this street closer than previous best AND within threshold?
      if (
        distance < nearestDistance &&
        distance <= STREET_MATCHING.MAX_DISTANCE_METERS
      ) {
        nearestDistance = distance;
        nearestStreetId = street.osmId;
      }
    }

    return nearestStreetId;
  });
}

// ============================================
// Step 2: Group Points by Street (with indices)
// ============================================

/**
 * Point with its original index in the GPS track
 */
interface PointWithIndex {
  point: GpxPoint;
  index: number;
}

/**
 * Group GPS points by which street they belong to, preserving original indices
 *
 * Creates a Map where keys are street IDs and values are arrays
 * of points with their original indices. This allows us to identify
 * consecutive segments when calculating distance.
 *
 * @param assignments - Array of street IDs (from assignPointsToStreets)
 * @param points - Original GPS points array
 * @returns Map of streetId => PointWithIndex[]
 *
 * @example
 * // assignments: [null, "way/123", "way/123", "way/456", "way/123"]
 * // points: [p0, p1, p2, p3, p4]
 * // Result: Map {
 * //   "way/123" => [{point: p1, index: 1}, {point: p2, index: 2}, {point: p4, index: 4}],
 * //   "way/456" => [{point: p3, index: 3}]
 * // }
 */
function groupPointsByStreetWithIndices(
  assignments: (string | null)[],
  points: GpxPoint[]
): Map<string, PointWithIndex[]> {
  const streetPoints = new Map<string, PointWithIndex[]>();

  for (let i = 0; i < assignments.length; i++) {
    const streetId = assignments[i];

    // Skip points not assigned to any street
    if (!streetId) continue;

    // Initialize array for this street if first point
    if (!streetPoints.has(streetId)) {
      streetPoints.set(streetId, []);
    }

    // Add point with its original index
    streetPoints.get(streetId)!.push({
      point: points[i],
      index: i,
    });
  }

  return streetPoints;
}

// ============================================
// Step 3: Calculate Coverage (Consecutive Segments Only)
// ============================================

/**
 * Calculate coverage metrics for each matched street
 *
 * For each street with matched points:
 * - Find consecutive segments (points with consecutive indices)
 * - Calculate distance covered ONLY within consecutive segments (Phase 1)
 * - Calculate geometry-based distance along street (Phase 2, more accurate)
 * - Calculate coverage ratio (distance covered / street length)
 * - Determine completion status (FULL if ≥90%, PARTIAL otherwise)
 *
 * Phase 1 Fix: Only counts distance between consecutive GPS points.
 * This prevents inflated coverage ratios when a runner leaves a street
 * and returns to it later (e.g., running down Main St, turning onto Oak Ave,
 * then returning to Main St).
 *
 * Phase 2 Enhancement: Projects GPS points onto street geometry and measures
 * distance along the actual street centerline. This accounts for GPS drift
 * and gives more accurate coverage ratios, especially on curved streets.
 *
 * @param streetGroups - Map of streetId => PointWithIndex[] from groupPointsByStreetWithIndices
 * @param streets - Original street data from Overpass (includes geometry)
 * @returns Array of MatchedStreet objects with coverage data
 */
function calculateStreetCoverage(
  streetGroups: Map<string, PointWithIndex[]>,
  streets: OsmStreet[]
): MatchedStreet[] {
  // Create lookup map for street data by ID
  const streetMap = new Map(streets.map((s) => [s.osmId, s]));
  const results: MatchedStreet[] = [];

  // Process each street that has matched points
  for (const [osmId, matchedPointsWithIndices] of streetGroups) {
    const street = streetMap.get(osmId);
    if (!street) continue; // Safety check

    // Phase 1: Calculate distance only for consecutive segments
    // This prevents counting "jump" distances when runner leaves and returns
    const distanceCovered = calculateConsecutiveDistance(matchedPointsWithIndices);

    // Phase 2: Calculate geometry-based distance (more accurate)
    // Projects GPS points onto street centerline and measures along geometry
    const geometryDistanceCovered = calculateGeometryDistance(
      matchedPointsWithIndices,
      street.geometry
    );

    // Calculate coverage ratios
    // Primary ratio uses GPS point distance (Phase 1)
    const coverageRatio =
      street.lengthMeters > 0 ? distanceCovered / street.lengthMeters : 0;

    // Geometry-based ratio (Phase 2, more accurate)
    const geometryCoverageRatio =
      street.lengthMeters > 0
        ? geometryDistanceCovered / street.lengthMeters
        : 0;

    // Build the matched street result
    results.push({
      osmId: street.osmId,
      name: street.name,
      highwayType: street.highwayType,

      // Round to 2 decimal places for cleaner output
      lengthMeters: Math.round(street.lengthMeters * 100) / 100,
      distanceCoveredMeters: Math.round(distanceCovered * 100) / 100,

      // Round to 3 decimal places (e.g., 0.947 = 94.7%)
      coverageRatio: Math.round(coverageRatio * 1000) / 1000,

      // Phase 2: Geometry-based coverage (more accurate)
      geometryDistanceCoveredMeters: Math.round(geometryDistanceCovered * 100) / 100,
      geometryCoverageRatio: Math.round(geometryCoverageRatio * 1000) / 1000,

      // Determine if FULL or PARTIAL completion
      // Use geometry-based ratio for more accurate status
      completionStatus: determineCompletionStatus(geometryCoverageRatio),

      // Number of GPS points on this street
      matchedPointsCount: matchedPointsWithIndices.length,
    });
  }

  return results;
}

/**
 * Calculate distance covered only for consecutive segments
 *
 * Phase 1 Implementation: Consecutive-Only Distance Calculation
 *
 * This function solves the problem of inflated coverage ratios caused by
 * non-consecutive GPS point grouping. When a runner leaves a street and
 * returns to it later, the old algorithm would sum distances between all
 * points on that street, including the "jump" distance between segments.
 *
 * Algorithm:
 * 1. Sort points by their original GPS track index
 * 2. Identify consecutive segments (where indices are sequential)
 * 3. Calculate distance within each consecutive segment separately
 * 4. Sum only the segment distances (ignore gaps between segments)
 *
 * Example Scenario:
 * - GPS track has 25 points total
 * - Points on Street A: indices [5, 6, 7, 20, 21]
 * - This means: runner was on Street A at points 5-7, then left,
 *   ran on other streets (points 8-19), then returned to Street A (points 20-21)
 *
 * Old Algorithm (WRONG):
 * - Would sum: distance(5→6) + distance(6→7) + distance(7→20) + distance(20→21)
 * - Problem: distance(7→20) is a huge jump (runner wasn't on Street A!)
 * - Result: Inflated coverage ratio (e.g., 1.8x = 180% coverage)
 *
 * New Algorithm (CORRECT):
 * - Identifies segments: [5,6,7] and [20,21]
 * - Sums only: distance(5→6) + distance(6→7) + distance(20→21)
 * - Ignores: distance(7→20) because indices are not consecutive
 * - Result: Accurate coverage ratio (e.g., 0.65 = 65% coverage)
 *
 * Edge Cases Handled:
 * - Single point segments: Returns 0 (need at least 2 points for distance)
 * - All points consecutive: Works normally (one continuous segment)
 * - No consecutive points: Returns 0 (each point is its own segment)
 *
 * @param pointsWithIndices - Array of points with their original GPS track indices
 * @returns Total distance in meters (consecutive segments only)
 *
 * @example
 * // Runner on Main St: points at indices [10, 11, 12, 15, 16]
 * // Segments: [10,11,12] and [15,16]
 * const points = [
 *   { point: { lat: 50.79, lng: -1.09 }, index: 10 },
 *   { point: { lat: 50.80, lng: -1.10 }, index: 11 },
 *   { point: { lat: 50.81, lng: -1.11 }, index: 12 },
 *   { point: { lat: 50.82, lng: -1.12 }, index: 15 },
 *   { point: { lat: 50.83, lng: -1.13 }, index: 16 },
 * ];
 * const distance = calculateConsecutiveDistance(points);
 * // Returns: distance(10→11) + distance(11→12) + distance(15→16)
 * // Does NOT include distance(12→15) because indices jump from 12 to 15
 */
function calculateConsecutiveDistance(
  pointsWithIndices: PointWithIndex[]
): number {
  // Need at least 2 points to calculate distance
  if (pointsWithIndices.length < 2) return 0;

  // Sort by original index to process in order
  const sorted = [...pointsWithIndices].sort((a, b) => a.index - b.index);

  let totalDistance = 0;

  // Find consecutive segments and calculate distance within each
  let segmentStart = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prevIndex = sorted[i - 1].index;
    const currIndex = sorted[i].index;

    // Check if this point is consecutive to the previous one
    const isConsecutive = currIndex === prevIndex + 1;

    if (!isConsecutive) {
      // End of current segment, calculate distance for this segment
      const segmentPoints = sorted
        .slice(segmentStart, i)
        .map((pwi) => pwi.point);
      totalDistance += calculatePathDistance(segmentPoints);

      // Start new segment
      segmentStart = i;
    }
  }

  // Don't forget the last segment
  const lastSegmentPoints = sorted
    .slice(segmentStart)
    .map((pwi) => pwi.point);
  totalDistance += calculatePathDistance(lastSegmentPoints);

  return totalDistance;
}

// ============================================
// Completion Status
// ============================================

/**
 * Determine if a street was fully or partially completed
 *
 * FULL: Coverage ratio ≥ 90% (COMPLETION_THRESHOLD)
 * PARTIAL: Coverage ratio < 90%
 *
 * Why 90%?
 * - GPS accuracy is typically 5-15 meters
 * - Runner might cut corners slightly
 * - Street start/end points may not align perfectly with GPS
 * - 90% ensures the runner covered "most" of the street
 *
 * @param coverageRatio - Ratio of distance covered to street length (0.0 to 1.0+)
 * @returns "FULL" or "PARTIAL"
 *
 * @example
 * determineCompletionStatus(0.95)  // "FULL" (95% > 90%)
 * determineCompletionStatus(0.45)  // "PARTIAL" (45% < 90%)
 * determineCompletionStatus(1.20)  // "FULL" (120% > 90%, runner went back and forth)
 */
function determineCompletionStatus(coverageRatio: number): CompletionStatus {
  return coverageRatio >= STREET_MATCHING.COMPLETION_THRESHOLD
    ? "FULL"
    : "PARTIAL";
}
