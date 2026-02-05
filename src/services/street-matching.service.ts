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
 * Phase 3 Enhancement: Trajectory-Aware Point Assignment
 * - Uses direction of movement to resolve ambiguous street assignments at intersections
 * - Scores candidates by distance (40%), trajectory alignment (40%), and continuity (20%)
 * - Improves accuracy when GPS points are equidistant from multiple streets
 * - Example: At intersection, runner moving east → selects eastbound street even if slightly further
 *
 * Hybrid (Mapbox + Overpass) - Geometric Cross-Reference:
 * - When Mapbox is used, we no longer match Mapbox streets to OSM by name.
 * - Instead we project Mapbox's snapped geometry coordinates onto OSM streets by location
 *   (same logic as assignPointsToStreets + calculateStreetCoverage).
 * - This eliminates "missing streets" when Mapbox and OSM use different names, and prevents
 *   false matches from fuzzy name matching.
 *
 * Accuracy considerations:
 * - 25m threshold accounts for GPS drift (typically 5-15m accuracy)
 * - Minimum 3 points per street filters out noise/brief touches
 * - Dynamic completion thresholds based on street length (Phase 2)
 * - Geometry projection (Phase 2) provides most accurate coverage measurement
 * - Trajectory awareness (Phase 3) resolves intersection ambiguity
 */

import type {
  GpxPoint,
  OsmStreet,
  MatchedStreet,
  CompletionStatus,
  GeoJsonLineString,
} from "../types/run.types.js";
import {
  STREET_MATCHING,
  getCompletionThreshold,
} from "../config/constants.js";
import {
  pointToLineDistance,
  calculatePathDistance,
  calculateGeometryDistance,
  calculateLineLength,
  calculateTrajectory,
  calculateStreetBearing,
  normalizeAngle,
  projectPointOntoStreet,
} from "./geo.service.js";
import {
  mapMatchGpsTrace,
  isMapboxConfigured,
  MapboxError,
  type MapboxExtractedStreet,
  type MapboxMatchResponse,
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
  const streetGroups = groupPointsByStreetWithIndices(
    pointStreetAssignments,
    points
  );

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
 * Combines Mapbox Map Matching (GPS snapped to roads) with geometric matching to OSM:
 * - **Mapbox Map Matching**: Snaps raw GPS to road centerlines; returns matched route geometry.
 * - **Geometric cross-reference**: Mapbox snapped coordinates are assigned to OSM streets by
 *   location (point-to-line distance + trajectory), not by street name. This avoids missing
 *   streets when Mapbox and OSM names differ and prevents false matches from name fuzzy matching.
 * - **Overpass Data**: Supplies OSM street geometry and total lengths for coverage calculation.
 *
 * Benefits:
 * - Better handling of GPS drift (Mapbox snaps first)
 * - Streets never dropped due to name mismatch (matching is by coordinates only)
 * - Correct intersection handling via trajectory-aware assignment
 *
 * **Confidence-Aware Processing:**
 * - High (≥70%) / Medium (30-70%): Mapbox snapped geometry → geometric match to OSM.
 * - Low (10-30%): Mapbox for matched points + Overpass for unmatched; both merged by osmId.
 * - Very low (<10%): Full Overpass-only fallback (raw GPS → geometric match).
 *
 * Fallback: If Mapbox is not configured or fails, falls back to Overpass-only matching.
 *
 * @param points - Array of GPS coordinates from the GPX file
 * @param overpassStreets - Array of streets from Overpass (includes geometry and length)
 * @returns Array of matched streets with coverage data
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

    // Step 2: Check confidence and decide on processing strategy
    const confidence =
      mapboxResult.matchings && mapboxResult.matchings.length > 0
        ? mapboxResult.matchings[0].confidence
        : 0;

    console.log(
      `[Hybrid] Mapbox confidence: ${(confidence * 100).toFixed(1)}%`
    );

    const { CONFIDENCE_THRESHOLDS } = STREET_MATCHING;

    // Step 3: Process based on confidence level (all paths use geometric matching to OSM)
    if (confidence >= CONFIDENCE_THRESHOLDS.HIGH) {
      // High confidence (>= 70%): Mapbox snapped geometry → geometric match to OSM
      console.log("[Hybrid] High confidence - using geometric cross-reference");
      const matchedStreets = geometricCrossReferenceStreets(
        mapboxResult,
        overpassStreets
      );
      console.log(
        `[Hybrid] Final result: ${matchedStreets.length} streets matched`
      );
      return matchedStreets;
    } else if (confidence >= CONFIDENCE_THRESHOLDS.MEDIUM) {
      // Medium confidence (30-70%): Same geometric matching, log warning
      console.warn(
        `[Hybrid] Medium confidence (${(confidence * 100).toFixed(
          1
        )}%) - results may be less accurate`
      );
      const matchedStreets = geometricCrossReferenceStreets(
        mapboxResult,
        overpassStreets
      );
      console.log(
        `[Hybrid] Final result: ${matchedStreets.length} streets matched`
      );
      return matchedStreets;
    } else if (confidence >= CONFIDENCE_THRESHOLDS.LOW) {
      // Low confidence (10-30%): Hybrid approach - use Mapbox for matched points, Overpass for gaps
      console.log(
        `[Hybrid] Low confidence (${(confidence * 100).toFixed(
          1
        )}%) - using hybrid fallback`
      );
      return processLowConfidenceHybrid(mapboxResult, points, overpassStreets);
    } else {
      // Very low confidence (< 10%): Full Overpass fallback
      console.log(
        `[Hybrid] Very low confidence (${(confidence * 100).toFixed(
          1
        )}%) - falling back to Overpass-only`
      );
      return matchPointsToStreets(points, overpassStreets);
    }
  } catch (error) {
    // Log error and fall back to Overpass-only matching
    if (error instanceof MapboxError) {
      console.warn(
        `[Hybrid] Mapbox failed (${error.code || "unknown"}): ${error.message}`
      );
    } else {
      console.warn(
        `[Hybrid] Mapbox failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    console.log("[Hybrid] Falling back to Overpass-only matching");
    return matchPointsToStreets(points, overpassStreets);
  }
}

/**
 * Process low-confidence Mapbox result with hybrid fallback
 *
 * When Mapbox confidence is low (10-30%):
 * 1. Mapbox-matched points: geometric cross-reference (snapped coords → OSM by location)
 * 2. Unmatched points: Overpass-only matching (raw GPS → OSM by location)
 * 3. Merge results by osmId (same street from both sources combined)
 *
 * @param mapboxResult - Mapbox match result with low confidence
 * @param points - Original GPS points (used for unmatched-point fallback)
 * @param overpassStreets - Overpass street data for fallback
 * @returns Merged matched streets
 */
function processLowConfidenceHybrid(
  mapboxResult: MapboxMatchResponse,
  points: GpxPoint[],
  overpassStreets: OsmStreet[]
): MatchedStreet[] {
  const matchedIndices = new Set<number>();

  // Track which points Mapbox matched
  if (mapboxResult.tracepoints) {
    mapboxResult.tracepoints.forEach((tp, idx) => {
      if (tp !== null) {
        matchedIndices.add(idx);
      }
    });
  }

  // Find unmatched points (for Overpass fallback)
  const unmatchedPoints = points.filter((_, idx) => !matchedIndices.has(idx));

  // Mapbox-matched points: geometric cross-reference (no name matching)
  const mapboxMatched = geometricCrossReferenceStreets(
    mapboxResult,
    overpassStreets
  );

  if (unmatchedPoints.length > 0) {
    console.log(
      `[Hybrid] Mapbox matched ${matchedIndices.size} points, ${unmatchedPoints.length} unmatched - merging with Overpass fallback`
    );

    const overpassMatches = matchPointsToStreets(
      unmatchedPoints,
      overpassStreets
    );

    return mergeStreetMatches(mapboxMatched, overpassMatches);
  }

  return mapboxMatched;
}

/**
 * Merge matched streets from Mapbox (geometric) and Overpass-only, avoiding duplicates.
 *
 * Deduplication: by osmId first (geometric results have real OSM ids), then by normalized name.
 * When the same street is found by both sources, keeps the higher coverage.
 *
 * @param mapboxMatches - Streets from geometric cross-reference (Mapbox snapped → OSM)
 * @param overpassMatches - Streets from Overpass-only matching (unmatched raw GPS points)
 * @returns Merged array without duplicates, sorted by distance covered
 */
function mergeStreetMatches(
  mapboxMatches: MatchedStreet[],
  overpassMatches: MatchedStreet[]
): MatchedStreet[] {
  const merged: MatchedStreet[] = [...mapboxMatches];
  const byOsmId = new Map<string, MatchedStreet>(
    mapboxMatches.map((s) => [s.osmId, s])
  );
  const existingNames = new Set(
    mapboxMatches.map((s) => normalizeStreetNameForMatching(s.name))
  );

  for (const match of overpassMatches) {
    const existingByOsmId = match.osmId ? byOsmId.get(match.osmId) : undefined;
    const existingByName = merged.find(
      (s) => normalizeStreetNameForMatching(s.name) === normalizeStreetNameForMatching(match.name)
    );
    const existing = existingByOsmId ?? existingByName;

    if (existing) {
      if (match.distanceCoveredMeters > existing.distanceCoveredMeters) {
        existing.distanceCoveredMeters = match.distanceCoveredMeters;
        existing.matchedPointsCount += match.matchedPointsCount;
        if (existing.lengthMeters > 0) {
          existing.coverageRatio = Math.min(
            existing.distanceCoveredMeters / existing.lengthMeters,
            1.0
          );
          if (existing.geometryCoverageRatio !== undefined) {
            existing.geometryCoverageRatio = existing.coverageRatio;
          }
        }
      }
    } else {
      merged.push(match);
      if (match.osmId) byOsmId.set(match.osmId, match);
      existingNames.add(normalizeStreetNameForMatching(match.name));
    }
  }

  return merged.sort(
    (a, b) => b.distanceCoveredMeters - a.distanceCoveredMeters
  );
}

/**
 * Generate a deterministic ID for unmatched Mapbox streets.
 *
 * Creates a consistent identifier based on normalized name and approximate location.
 * This allows the same street to be identified across multiple runs even without
 * an OSM ID match.
 *
 * Format: "estimated-{normalized-name}-{lat-hash}-{lng-hash}"
 * Example: "estimated-elm-grove-50786-6109"
 *
 * @param streetName - Street name from Mapbox
 * @param geometry - Optional street geometry (used for location hash)
 * @returns Deterministic ID string
 */
function generateDeterministicStreetId(
  streetName: string,
  geometry?: GeoJsonLineString
): string {
  const normName = normalizeStreetNameForMatching(streetName).replace(
    /\s/g,
    "-"
  );

  // Calculate approximate center point from geometry if available
  let locationHash = "";
  if (geometry && geometry.coordinates.length > 0) {
    // Use the middle coordinate as approximate center
    const midIndex = Math.floor(geometry.coordinates.length / 2);
    const [lng, lat] = geometry.coordinates[midIndex];
    // Round to 3 decimal places (~100m precision) for hash
    locationHash = `-${Math.round(lat * 1000)}-${Math.round(lng * 1000)}`;
  }

  return `estimated-${normName}${locationHash}`;
}

// ============================================
// Geometric Cross-Reference (Mapbox → OSM by location)
// ============================================

/**
 * Cross-reference Mapbox matched route with OSM streets by geometry only (no name matching).
 *
 * Uses Mapbox's snapped route geometry: each coordinate is assigned to the nearest OSM street
 * via the same logic as the Overpass-only path (assignPointsToStreets + calculateStreetCoverage).
 * This eliminates missing streets when Mapbox and OSM use different names and prevents false
 * matches from fuzzy name matching.
 *
 * Flow:
 * 1. Extract all snapped coordinates from Mapbox matchings[].geometry
 * 2. Assign each coordinate to nearest OSM street (pointToLineDistance + trajectory)
 * 3. Group by street and compute coverage (consecutive segments, geometry projection)
 * 4. Filter by MIN_POINTS_PER_STREET and return
 *
 * @param mapboxResult - Raw Mapbox Map Matching API response (contains matched geometry)
 * @param overpassStreets - OSM streets in area (geometry + length)
 * @returns Matched streets with OSM ids, names, coverage, and completion status
 */
function geometricCrossReferenceStreets(
  mapboxResult: MapboxMatchResponse,
  overpassStreets: OsmStreet[]
): MatchedStreet[] {
  if (overpassStreets.length === 0) return [];

  const allSnappedCoords: GpxPoint[] = [];
  const matchings = mapboxResult.matchings ?? [];
  for (const matching of matchings) {
    const coords = matching.geometry?.coordinates;
    if (!coords?.length) continue;
    for (const [lng, lat] of coords) {
      allSnappedCoords.push({ lat, lng });
    }
  }

  if (allSnappedCoords.length === 0) return [];

  const assignments = assignPointsToStreets(allSnappedCoords, overpassStreets);
  const streetGroups = groupPointsByStreetWithIndices(
    assignments,
    allSnappedCoords
  );
  const matchedStreets = calculateStreetCoverage(streetGroups, overpassStreets);

  const filtered = matchedStreets.filter(
    (s) => s.matchedPointsCount >= STREET_MATCHING.MIN_POINTS_PER_STREET
  );

  return filtered.sort(
    (a, b) => b.distanceCoveredMeters - a.distanceCoveredMeters
  );
}

// ============================================
// Name-based Cross-Reference (legacy, unused in hybrid path)
// ============================================

/**
 * Cross-reference Mapbox streets with Overpass data by street name (legacy).
 *
 * For each street from Mapbox, finds the matching street in Overpass by normalized
 * name with fuzzy matching. Used only when geometric cross-reference is not applicable.
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
    const osmStreet = findMatchingOverpassStreet(
      mbStreet.name,
      overpassStreets,
      overpassByName
    );

    if (osmStreet) {
      // We have total length from Overpass!
      const coverageRatio =
        osmStreet.lengthMeters > 0
          ? mbStreet.distanceMeters / osmStreet.lengthMeters
          : 0;

      // Calculate spatial coverage interval from Mapbox geometry projected onto OSM geometry
      // This tells us WHICH portion of the street was covered, not just how much distance
      let coverageInterval: [number, number] | undefined;
      if (mbStreet.geometry && osmStreet.geometry) {
        coverageInterval = calculateCoverageIntervalFromGeometry(
          mbStreet.geometry,
          osmStreet.geometry,
          osmStreet.lengthMeters
        );
      }

      matchedStreets.push({
        osmId: osmStreet.osmId,
        name: osmStreet.name, // Use OSM name for consistency
        highwayType: osmStreet.highwayType,
        lengthMeters: Math.round(osmStreet.lengthMeters * 100) / 100,
        distanceCoveredMeters: Math.round(mbStreet.distanceMeters * 100) / 100,
        coverageRatio: Math.round(coverageRatio * 1000) / 1000,
        geometryDistanceCoveredMeters:
          Math.round(mbStreet.distanceMeters * 100) / 100,
        geometryCoverageRatio: Math.round(coverageRatio * 1000) / 1000,
        completionStatus: determineCompletionStatus(
          coverageRatio,
          osmStreet.lengthMeters,
          coverageInterval,
          mbStreet.pointsCount
        ),
        matchedPointsCount: mbStreet.pointsCount,
        coverageInterval, // Include in response for debugging/verification
      });
    } else {
      // Mapbox found a street that Overpass didn't return
      // This can happen at bounding box edges or with newer streets
      console.log(
        `[Hybrid] No Overpass match for Mapbox street: "${mbStreet.name}"`
      );

      // Estimate street length from Mapbox geometry if available
      let estimatedLength = 0;
      if (mbStreet.geometry && mbStreet.geometry.coordinates.length > 1) {
        estimatedLength = calculateLineLength(mbStreet.geometry);
      }

      // If we can't estimate, use a reasonable default based on distance covered
      // Assume the run covered at least 50% of the street (conservative estimate)
      if (estimatedLength === 0 && mbStreet.distanceMeters > 0) {
        estimatedLength = mbStreet.distanceMeters / 0.5; // Assume 50% coverage
      }

      // Generate deterministic ID based on normalized name + approximate location
      // This allows consistent identification across runs even without OSM ID
      const deterministicId = generateDeterministicStreetId(
        mbStreet.name,
        mbStreet.geometry
      );

      const coverageRatio =
        estimatedLength > 0
          ? Math.min(mbStreet.distanceMeters / estimatedLength, 1.0)
          : 0.5; // Default to 50% if we can't estimate

      // Without OSM geometry, we can't accurately calculate spatial coverage
      // For Mapbox-only streets, we're more conservative and rely on minimum points check
      // The coverage interval is undefined, which triggers PARTIAL if ratio > 1.0
      const coverageInterval: [number, number] | undefined = undefined;

      matchedStreets.push({
        osmId: deterministicId,
        name: mbStreet.name,
        highwayType: "unknown",
        lengthMeters: Math.round(estimatedLength * 100) / 100,
        distanceCoveredMeters: Math.round(mbStreet.distanceMeters * 100) / 100,
        coverageRatio: Math.round(coverageRatio * 1000) / 1000,
        geometryDistanceCoveredMeters:
          Math.round(mbStreet.distanceMeters * 100) / 100,
        geometryCoverageRatio: Math.round(coverageRatio * 1000) / 1000,
        completionStatus: determineCompletionStatus(
          coverageRatio,
          estimatedLength,
          coverageInterval,
          mbStreet.pointsCount
        ),
        matchedPointsCount: mbStreet.pointsCount,
        coverageInterval,
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
 * Candidate street for trajectory-aware matching
 */
interface CandidateStreet {
  osmId: string;
  distance: number;
  bearing: number; // Direction of street at closest point
}

/**
 * Assign each GPS point to its nearest street using trajectory awareness.
 *
 * Phase 3 Enhancement: Trajectory-Aware Point Assignment
 *
 * For ambiguous points (multiple streets within threshold), uses trajectory
 * (direction of movement) to select the most likely street. This resolves
 * GPS drift issues at intersections where multiple streets are equidistant.
 *
 * Scoring factors:
 * 1. Distance (40 points) - Closer streets score higher
 * 2. Trajectory alignment (40 points) - Streets aligned with movement direction score higher
 * 3. Continuity (20 points) - Same street as previous point scores higher
 *
 * @param points - Array of GPS coordinates
 * @param streets - Array of streets to match against
 * @returns Array of street IDs (or null) for each point
 *
 * @example
 * // Point at intersection near "High Street" (10m, bearing 90°) and "Park Lane" (12m, bearing 180°)
 * // Runner moving east (trajectory 85°)
 * // Result: "way/123" (High Street, because trajectory aligns better despite slightly further)
 */
function assignPointsToStreets(
  points: GpxPoint[],
  streets: OsmStreet[]
): (string | null)[] {
  const assignments: (string | null)[] = [];

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const candidates = findCandidateStreets(point, streets);

    if (candidates.length === 0) {
      assignments.push(null);
      continue;
    }

    if (candidates.length === 1) {
      // Single candidate - use it directly
      assignments.push(candidates[0].osmId);
      continue;
    }

    // Multiple candidates - use trajectory to decide
    const trajectory = calculateTrajectory(points, i);
    const bestMatch = selectBestCandidate(
      candidates,
      trajectory,
      assignments,
      i
    );

    assignments.push(bestMatch?.osmId ?? null);
  }

  return assignments;
}

/**
 * Find all streets within threshold distance of a GPS point.
 *
 * @param point - GPS point
 * @param streets - Array of streets to check
 * @param threshold - Maximum distance in meters (default: MAX_DISTANCE_METERS)
 * @returns Array of candidate streets sorted by distance (closest first)
 */
function findCandidateStreets(
  point: GpxPoint,
  streets: OsmStreet[],
  threshold: number = STREET_MATCHING.MAX_DISTANCE_METERS
): CandidateStreet[] {
  const candidates: CandidateStreet[] = [];

  for (const street of streets) {
    const distance = pointToLineDistance(point, street.geometry.coordinates);

    if (distance <= threshold) {
      candidates.push({
        osmId: street.osmId,
        distance,
        bearing: calculateStreetBearing(street.geometry, point),
      });
    }
  }

  return candidates.sort((a, b) => a.distance - b.distance);
}

/**
 * Select the best candidate street based on trajectory alignment.
 *
 * Scores candidates using:
 * - Distance (40 points): Closer streets score higher
 * - Trajectory alignment (40 points): Streets aligned with movement direction score higher
 * - Continuity (20 points): Same street as previous point scores higher
 *
 * @param candidates - Array of candidate streets
 * @param trajectory - Direction of movement in degrees (0-360)
 * @param previousAssignments - Previous street assignments
 * @param currentIndex - Current point index
 * @returns Best candidate street, or null if no candidates
 */
function selectBestCandidate(
  candidates: CandidateStreet[],
  trajectory: number,
  previousAssignments: (string | null)[],
  currentIndex: number
): CandidateStreet | null {
  let bestScore = -Infinity;
  let bestCandidate: CandidateStreet | null = null;

  const previousStreet =
    currentIndex > 0 ? previousAssignments[currentIndex - 1] : null;

  for (const candidate of candidates) {
    let score = 0;

    // Factor 1: Distance score (0-40 points, closer = higher)
    score += 40 * (1 - candidate.distance / STREET_MATCHING.MAX_DISTANCE_METERS);

    // Factor 2: Trajectory alignment score (0-40 points)
    const bearingDiff = Math.abs(
      normalizeAngle(trajectory - candidate.bearing)
    );
    // Normalize difference to 0-90° range (accounting for circular nature)
    const normalizedDiff = Math.min(bearingDiff, 180 - bearingDiff);
    // Score decreases as difference increases (perfect alignment = 1.0, 90° difference = 0.0)
    const alignmentScore = 1 - normalizedDiff / 90;
    score += 40 * Math.max(0, alignmentScore);

    // Factor 3: Continuity score (0-20 points)
    if (candidate.osmId === previousStreet) {
      score += 20;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
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
    const distanceCovered = calculateConsecutiveDistance(
      matchedPointsWithIndices
    );

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

    // Phase 3: Calculate actual coverage interval from GPS projections
    // Projects each matched point onto street geometry to find actual covered portion
    const coverageInterval = calculateCoverageIntervalFromPoints(
      matchedPointsWithIndices.map((mp) => mp.point),
      street.geometry,
      street.lengthMeters
    );

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
      geometryDistanceCoveredMeters:
        Math.round(geometryDistanceCovered * 100) / 100,
      geometryCoverageRatio: Math.round(geometryCoverageRatio * 1000) / 1000,

      // Determine if FULL or PARTIAL completion
      // Use geometry-based ratio for more accurate status
      // Pass street length for length-based threshold
      // Now also passes coverage interval and matched points count for spatial verification
      completionStatus: determineCompletionStatus(
        geometryCoverageRatio,
        street.lengthMeters,
        coverageInterval,
        matchedPointsWithIndices.length
      ),

      // Number of GPS points on this street
      matchedPointsCount: matchedPointsWithIndices.length,

      // Phase 3: Actual coverage interval for cumulative tracking
      coverageInterval,

      // Include geometry for future processing
      geometry: street.geometry,
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
  const lastSegmentPoints = sorted.slice(segmentStart).map((pwi) => pwi.point);
  totalDistance += calculatePathDistance(lastSegmentPoints);

  return totalDistance;
}

// ============================================
// Completion Status
// ============================================

/**
 * Determine if a street was fully or partially completed
 *
 * IMPORTANT: This function now requires SPATIAL COVERAGE VERIFICATION when
 * coverage ratio exceeds 1.0 (which can happen due to GPS drift, multiple passes,
 * or Mapbox routing interpolation).
 *
 * Validation rules:
 * 1. Minimum points required (MIN_POINTS_PER_STREET = 3) for accurate determination
 * 2. Coverage ratio is capped at 1.0 for threshold comparison
 * 3. When ratio > 1.0, REQUIRES spatial coverage interval verification
 * 4. Coverage interval must span from near 0% to near 100% (5% tolerance)
 *
 * Length-based thresholds:
 * - Very short streets (< 50m): 85% threshold
 * - Short streets (50-100m): 90% threshold
 * - Medium streets (100-300m): 95% threshold
 * - Long streets (> 300m): 98% threshold
 *
 * @param coverageRatio - Ratio of distance covered to street length (0.0 to 1.0+)
 * @param streetLengthMeters - Total length of the street in meters (for threshold selection)
 * @param coverageInterval - Optional: Actual spatial coverage [start%, end%] from GPS projections
 * @param matchedPointsCount - Optional: Number of GPS points matched to this street
 * @returns "FULL" or "PARTIAL"
 *
 * @example
 * determineCompletionStatus(0.95, 200)  // "FULL" (95% >= 95% threshold)
 * determineCompletionStatus(1.5, 200, undefined, 1)  // "PARTIAL" (only 1 point)
 * determineCompletionStatus(1.5, 200, [0, 60], 10)  // "PARTIAL" (ratio > 1 but only 60% spatial coverage)
 * determineCompletionStatus(1.5, 200, [0, 98], 10)  // "FULL" (ratio > 1 AND spatial coverage verified)
 */
function determineCompletionStatus(
  coverageRatio: number,
  streetLengthMeters: number,
  coverageInterval?: [number, number],
  matchedPointsCount?: number
): CompletionStatus {
  const threshold = getCompletionThreshold(streetLengthMeters);

  // Rule 1: Require minimum points for accurate determination
  // Streets with only 1-2 points cannot be reliably marked as complete
  if (
    matchedPointsCount !== undefined &&
    matchedPointsCount < STREET_MATCHING.MIN_POINTS_PER_STREET
  ) {
    return "PARTIAL";
  }

  // Rule 2: Cap ratio at 1.0 for threshold comparison
  // A ratio > 1.0 doesn't mean "more than complete" - it means measurement issues
  const cappedRatio = Math.min(coverageRatio, 1.0);

  // Rule 3: If capped ratio is below threshold, definitely not complete
  if (cappedRatio < threshold) {
    return "PARTIAL";
  }

  // Rule 4: If ratio > 1.0, REQUIRE spatial coverage verification
  // A ratio > 1.0 can occur due to:
  // - GPS drift causing zigzagging (inflates distance but doesn't cover full street)
  // - Multiple passes on same section (inflates distance but same coverage)
  // - Mapbox routing interpolation (creates long route segments through streets)
  if (coverageRatio > 1.0) {
    if (!coverageInterval) {
      // Can't verify spatial coverage - be conservative and mark as PARTIAL
      console.warn(
        `[Completion] Ratio ${coverageRatio.toFixed(2)} > 1.0 but no coverage interval for verification. Marking PARTIAL.`
      );
      return "PARTIAL";
    }

    const spatialSpan = coverageInterval[1] - coverageInterval[0];
    const startGap = coverageInterval[0];
    const endGap = 100 - coverageInterval[1];
    const maxAllowedGap = 5; // 5% tolerance at start/end

    // Check for gaps at start or end of street
    if (startGap > maxAllowedGap) {
      console.warn(
        `[Completion] Ratio ${coverageRatio.toFixed(2)} > 1.0 but ${startGap.toFixed(1)}% gap at start. Marking PARTIAL.`
      );
      return "PARTIAL";
    }

    if (endGap > maxAllowedGap) {
      console.warn(
        `[Completion] Ratio ${coverageRatio.toFixed(2)} > 1.0 but ${endGap.toFixed(1)}% gap at end. Marking PARTIAL.`
      );
      return "PARTIAL";
    }

    // Check if spatial span meets threshold
    const thresholdPercent = threshold * 100;
    if (spatialSpan < thresholdPercent) {
      console.warn(
        `[Completion] Ratio ${coverageRatio.toFixed(2)} > 1.0 but spatial span ${spatialSpan.toFixed(1)}% < threshold ${thresholdPercent.toFixed(1)}%. Marking PARTIAL.`
      );
      return "PARTIAL";
    }

    // Ratio > 1.0 AND spatial coverage verified - mark as FULL
    console.log(
      `[Completion] Ratio ${coverageRatio.toFixed(2)} > 1.0 verified with spatial coverage [${coverageInterval[0]}, ${coverageInterval[1]}]. Marking FULL.`
    );
  }

  return "FULL";
}

/**
 * Calculate actual coverage interval from GPS points projected onto street geometry
 *
 * Phase 3 Implementation: True Spatial Coverage
 *
 * Projects each GPS point onto the street centerline and calculates which
 * portion of the street was actually covered. This is more accurate than
 * simply using the coverage ratio, because it tells us WHICH parts were covered.
 *
 * Algorithm:
 * 1. Project each GPS point onto the street geometry
 * 2. Calculate position along street as percentage (0-100%)
 * 3. Find min and max positions to determine interval
 *
 * Note: This returns a single interval [start, end] representing the
 * continuous portion covered. For more complex coverage (multiple disjoint
 * sections), additional logic would be needed to detect gaps.
 *
 * @param points - GPS points matched to this street
 * @param streetGeometry - GeoJSON LineString of the street
 * @param streetLengthMeters - Total street length for ratio calculation
 * @returns Coverage interval [start%, end%] or undefined if no valid coverage
 *
 * @example
 * // Runner covered middle section of street
 * calculateCoverageIntervalFromPoints(points, geom, 500)
 * // Returns: [20, 75] (20% to 75% of street was covered)
 */
function calculateCoverageIntervalFromPoints(
  points: GpxPoint[],
  streetGeometry: GeoJsonLineString,
  streetLengthMeters: number
): [number, number] | undefined {
  if (points.length === 0 || streetLengthMeters === 0) {
    return undefined;
  }

  // Project each point onto street and get position along street
  const positions: number[] = [];

  for (const point of points) {
    const projected = projectPointOntoStreet(point, streetGeometry);
    if (projected.distanceAlongStreet >= 0) {
      // Convert to percentage (0-100)
      const positionPercent =
        (projected.distanceAlongStreet / streetLengthMeters) * 100;
      positions.push(Math.max(0, Math.min(100, positionPercent)));
    }
  }

  if (positions.length === 0) {
    return undefined;
  }

  // Find min and max positions
  const minPos = Math.min(...positions);
  const maxPos = Math.max(...positions);

  // Round to integers for cleaner intervals
  const start = Math.floor(minPos);
  const end = Math.ceil(maxPos);

  // Ensure valid interval
  if (start >= end) {
    return undefined;
  }

  return [start, end];
}

/**
 * Calculate coverage interval from Mapbox matched geometry projected onto OSM street
 *
 * This function takes the geometry of a matched route segment (from Mapbox) and projects
 * it onto the OSM street geometry to determine which portion of the street was covered.
 *
 * Why is this needed?
 * - Mapbox returns interpolated route segments that may not exactly match OSM geometry
 * - We need to know WHICH portion of the street was covered, not just how much distance
 * - A single GPS point can produce a long route segment - we need to verify actual coverage
 *
 * Algorithm:
 * 1. Extract coordinates from Mapbox matched geometry
 * 2. Project start and end points onto OSM street geometry
 * 3. Calculate positions along street as percentages
 * 4. Return interval [start%, end%]
 *
 * @param matchedGeometry - GeoJSON LineString from Mapbox (the matched route segment)
 * @param streetGeometry - GeoJSON LineString from OSM (the actual street geometry)
 * @param streetLengthMeters - Total length of the OSM street
 * @returns Coverage interval [start%, end%] or undefined if calculation fails
 */
function calculateCoverageIntervalFromGeometry(
  matchedGeometry: GeoJsonLineString,
  streetGeometry: GeoJsonLineString,
  streetLengthMeters: number
): [number, number] | undefined {
  if (
    !matchedGeometry ||
    !matchedGeometry.coordinates ||
    matchedGeometry.coordinates.length < 2
  ) {
    return undefined;
  }

  if (
    !streetGeometry ||
    !streetGeometry.coordinates ||
    streetGeometry.coordinates.length < 2
  ) {
    return undefined;
  }

  if (streetLengthMeters <= 0) {
    return undefined;
  }

  // Convert Mapbox geometry coordinates to GpxPoints for projection
  const matchedPoints: GpxPoint[] = matchedGeometry.coordinates.map(
    (coord) => ({
      lat: coord[1],
      lng: coord[0],
    })
  );

  // Project multiple points along the matched geometry (not just start/end)
  // This handles curved streets better
  const sampleIndices: number[] = [];
  const numSamples = Math.min(matchedPoints.length, 10); // Sample up to 10 points

  for (let i = 0; i < numSamples; i++) {
    const idx = Math.floor((i / (numSamples - 1)) * (matchedPoints.length - 1));
    sampleIndices.push(idx);
  }

  // Ensure we include first and last points
  if (!sampleIndices.includes(0)) sampleIndices.unshift(0);
  if (!sampleIndices.includes(matchedPoints.length - 1))
    sampleIndices.push(matchedPoints.length - 1);

  // Project each sample point and get positions along street
  const positions: number[] = [];

  for (const idx of sampleIndices) {
    const point = matchedPoints[idx];
    const projected = projectPointOntoStreet(point, streetGeometry);

    if (projected.distanceAlongStreet >= 0) {
      const positionPercent =
        (projected.distanceAlongStreet / streetLengthMeters) * 100;
      positions.push(Math.max(0, Math.min(100, positionPercent)));
    }
  }

  if (positions.length < 2) {
    // Need at least 2 valid projections to determine interval
    return undefined;
  }

  // Find min and max positions
  const minPos = Math.min(...positions);
  const maxPos = Math.max(...positions);

  // Round to integers for cleaner intervals
  const start = Math.floor(minPos);
  const end = Math.ceil(maxPos);

  // Ensure valid interval
  if (start >= end) {
    return undefined;
  }

  return [start, end];
}
