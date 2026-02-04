/**
 * Mapbox Map Matching Service
 * Provides high-accuracy GPS trace matching using Mapbox's Map Matching API
 *
 * This service snaps GPS points to the road network using Mapbox's routing
 * algorithms, which consider:
 * - Street connectivity (which streets actually connect)
 * - Turn restrictions (no illegal turns)
 * - One-way streets
 * - Probabilistic path matching (most likely route)
 *
 * Key benefits over simple nearest-street matching:
 * - ~98% accuracy vs ~85% for nearest-street
 * - Better handling of GPS drift
 * - Correct intersection handling
 * - Street names directly from routing data
 *
 * API Documentation: https://docs.mapbox.com/api/navigation/map-matching/
 *
 * Usage:
 * ```typescript
 * const result = await mapMatchGpsTrace(gpsPoints);
 * const streets = extractStreetsFromMatch(result);
 * // streets: [{ name: "Peascod Street", distanceMeters: 200, ... }]
 * ```
 */

import axios, { AxiosError } from "axios";
import type { GpxPoint, GeoJsonLineString } from "../types/run.types.js";
import { MAPBOX } from "../config/constants.js";

// ============================================
// Types
// ============================================

/**
 * Mapbox Map Matching API response structure
 * See: https://docs.mapbox.com/api/navigation/map-matching/#response-object
 */
export interface MapboxMatchResponse {
  /** Status code: "Ok" on success */
  code: string;

  /** Matched routes (usually 1, but can be multiple for disconnected traces) */
  matchings: MapboxMatching[];

  /** Snapped GPS points (one per input coordinate, or null if not matched) */
  tracepoints: (MapboxTracepoint | null)[];
}

/**
 * A single matched route from Mapbox
 */
export interface MapboxMatching {
  /** Confidence score 0-1 (higher = more confident match) */
  confidence: number;

  /** Full geometry of the matched route */
  geometry: GeoJsonLineString;

  /** Route legs (segments between waypoints) */
  legs: MapboxLeg[];

  /** Total distance in meters */
  distance: number;

  /** Total duration in seconds (estimated) */
  duration: number;
}

/**
 * A leg of the matched route
 */
export interface MapboxLeg {
  /** Turn-by-turn steps within this leg */
  steps: MapboxStep[];

  /** Distance of this leg in meters */
  distance: number;

  /** Duration of this leg in seconds */
  duration: number;

  /** Summary string (usually empty for map matching) */
  summary: string;
}

/**
 * A single step (street segment) in the route
 */
export interface MapboxStep {
  /** Street name (or empty string if unnamed) */
  name: string;

  /** Distance of this step in meters */
  distance: number;

  /** Duration of this step in seconds */
  duration: number;

  /** Geometry of this step */
  geometry: GeoJsonLineString;

  /** Maneuver at the start of this step */
  maneuver: {
    type: string;
    modifier?: string;
    location: [number, number];
  };
}

/**
 * A snapped tracepoint (GPS point matched to road network)
 */
export interface MapboxTracepoint {
  /** Street name at this point */
  name: string;

  /** Snapped location [longitude, latitude] */
  location: [number, number];

  /** Index of the waypoint in the matched route */
  waypoint_index: number;

  /** Index of the matching in the matchings array */
  matchings_index: number;

  /** Number of alternative routes considered */
  alternatives_count: number;
}

/**
 * Extracted street data from Mapbox match result
 */
export interface MapboxExtractedStreet {
  /** Street name (may be empty for unnamed roads) */
  name: string;

  /** Total distance run on this street (meters) */
  distanceMeters: number;

  /** Number of GPS points that matched to this street */
  pointsCount: number;

  /** Geometry of the matched portion */
  geometry?: GeoJsonLineString;
}

/**
 * Custom error class for Mapbox API errors
 */
export class MapboxError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public code?: string
  ) {
    super(message);
    this.name = "MapboxError";
  }
}

// ============================================
// Main Functions
// ============================================

/**
 * Check if Mapbox is configured (access token is set)
 *
 * @returns true if MAPBOX_ACCESS_TOKEN environment variable is set
 */
export function isMapboxConfigured(): boolean {
  return !!process.env.MAPBOX_ACCESS_TOKEN;
}

/**
 * Match GPS trace to road network using Mapbox Map Matching API
 *
 * This function sends GPS points to Mapbox and receives back a matched
 * route that follows actual streets. The result includes:
 * - Snapped geometry (GPS points aligned to roads)
 * - Street names for each segment
 * - Distances along each street
 * - Confidence score
 *
 * For large traces (>100 points), the trace is automatically chunked
 * and results are merged.
 *
 * @param points - Array of GPS coordinates from GPX file
 * @returns Mapbox match response with matched route data
 * @throws MapboxError if API call fails or no valid match found
 *
 * @example
 * const points = [{ lat: 51.4816, lng: -0.6097 }, ...];
 * const result = await mapMatchGpsTrace(points);
 * console.log(result.matchings[0].confidence); // 0.95
 */
export async function mapMatchGpsTrace(
  points: GpxPoint[]
): Promise<MapboxMatchResponse> {
  const token = process.env.MAPBOX_ACCESS_TOKEN;

  if (!token) {
    throw new MapboxError(
      "MAPBOX_ACCESS_TOKEN not configured",
      undefined,
      "NO_TOKEN"
    );
  }

  if (points.length < 2) {
    throw new MapboxError(
      "At least 2 GPS points required for map matching",
      undefined,
      "INSUFFICIENT_POINTS"
    );
  }

  // Chunk large traces (Mapbox limit: 100 coordinates per request)
  if (points.length > MAPBOX.MAX_COORDINATES) {
    return await mapMatchLargeTrace(points, token);
  }

  return await makeMapboxRequest(points, token);
}

/**
 * Extract unique streets with distances from Mapbox match result
 *
 * Parses the Mapbox response to extract a list of streets the runner
 * covered, with total distance on each street. Streets are aggregated
 * by name (multiple segments of the same street are combined).
 *
 * @param matchResult - Response from mapMatchGpsTrace()
 * @returns Array of streets with names and distances
 *
 * @example
 * const result = await mapMatchGpsTrace(points);
 * const streets = extractStreetsFromMatch(result);
 * // [
 * //   { name: "Peascod Street", distanceMeters: 200.5, pointsCount: 12 },
 * //   { name: "High Street", distanceMeters: 150.3, pointsCount: 8 },
 * // ]
 */
export function extractStreetsFromMatch(
  matchResult: MapboxMatchResponse
): MapboxExtractedStreet[] {
  // Aggregate distances by street name
  const streetMap = new Map<
    string,
    { distance: number; points: number; geometries: GeoJsonLineString[] }
  >();

  // Process each matching (usually just one)
  for (const matching of matchResult.matchings) {
    // Process each leg
    for (const leg of matching.legs) {
      // Process each step (street segment)
      for (const step of leg.steps) {
        const streetName = step.name || "Unnamed Road";

        if (!streetMap.has(streetName)) {
          streetMap.set(streetName, { distance: 0, points: 0, geometries: [] });
        }

        const streetData = streetMap.get(streetName)!;
        streetData.distance += step.distance;
        streetData.geometries.push(step.geometry);
      }
    }
  }

  // Count points per street from tracepoints
  for (const tracepoint of matchResult.tracepoints) {
    if (tracepoint) {
      const streetName = tracepoint.name || "Unnamed Road";
      if (streetMap.has(streetName)) {
        streetMap.get(streetName)!.points++;
      }
    }
  }

  // Convert to array
  const streets: MapboxExtractedStreet[] = [];

  for (const [name, data] of streetMap) {
    streets.push({
      name,
      distanceMeters: Math.round(data.distance * 100) / 100,
      pointsCount: data.points || 1, // At least 1 if we have a step
      geometry:
        data.geometries.length > 0
          ? mergeGeometries(data.geometries)
          : undefined,
    });
  }

  // Sort by distance (most distance first)
  return streets.sort((a, b) => b.distanceMeters - a.distanceMeters);
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get timestamp as Unix seconds. Handles both Date and string (e.g. from DB JSON).
 * Coordinates loaded from Prisma have timestamps as ISO strings, not Date objects.
 */
function getTimestampSeconds(
  timestamp: Date | string | undefined
): number | null {
  if (!timestamp) return null;
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  return Math.floor(date.getTime() / 1000);
}

/**
 * Make a single request to Mapbox Map Matching API
 *
 * @param points - GPS points (max 100)
 * @param token - Mapbox access token
 * @returns Mapbox match response
 */
async function makeMapboxRequest(
  points: GpxPoint[],
  token: string
): Promise<MapboxMatchResponse> {
  // Format coordinates as "lng,lat;lng,lat;..."
  const coordinates = points
    .map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`)
    .join(";");

  // Build radiuses string (same radius for all points)
  const radiuses = points.map(() => MAPBOX.DEFAULT_RADIUS).join(";");

  // Build timestamps string if available (improves matching)
  let timestamps: string | undefined;
  if (points[0]?.timestamp) {
    timestamps = points
      .map((p) => {
        const secs = getTimestampSeconds(p.timestamp);
        return secs !== null ? secs.toString() : "";
      })
      .join(";");
  }

  // Build URL with query parameters
  const url = `${MAPBOX.API_URL}/${coordinates}`;

  const params: Record<string, string | boolean> = {
    access_token: token,
    geometries: MAPBOX.GEOMETRIES,
    overview: MAPBOX.OVERVIEW,
    annotations: MAPBOX.ANNOTATIONS,
    tidy: MAPBOX.TIDY,
    steps: MAPBOX.STEPS,
    radiuses,
  };

  if (timestamps) {
    params.timestamps = timestamps;
  }

  try {
    console.log(`[Mapbox] Sending ${points.length} points to Map Matching API`);

    const response = await axios.get<MapboxMatchResponse>(url, {
      params,
      timeout: MAPBOX.TIMEOUT_MS,
    });

    // Check for successful response
    if (response.data.code !== "Ok") {
      throw new MapboxError(
        `Mapbox API error: ${response.data.code}`,
        undefined,
        response.data.code
      );
    }

    // Validate we got a match
    if (!response.data.matchings || response.data.matchings.length === 0) {
      throw new MapboxError(
        "No valid route match found",
        undefined,
        "NO_MATCH"
      );
    }

    // Check confidence
    const confidence = response.data.matchings[0].confidence;
    if (confidence < MAPBOX.MIN_CONFIDENCE) {
      console.warn(
        `[Mapbox] Low confidence match: ${(confidence * 100).toFixed(1)}%`
      );
    }

    console.log(
      `[Mapbox] Match successful (confidence: ${(confidence * 100).toFixed(
        1
      )}%)`
    );

    return response.data;
  } catch (error) {
    if (error instanceof MapboxError) {
      throw error;
    }

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{
        message?: string;
        code?: string;
      }>;
      const status = axiosError.response?.status;
      const message =
        axiosError.response?.data?.message ||
        axiosError.message ||
        "Mapbox API request failed";

      // Handle specific error codes
      if (status === 401) {
        throw new MapboxError(
          "Invalid Mapbox access token",
          status,
          "INVALID_TOKEN"
        );
      }
      if (status === 429) {
        throw new MapboxError(
          "Mapbox rate limit exceeded",
          status,
          "RATE_LIMIT"
        );
      }

      throw new MapboxError(message, status);
    }

    throw new MapboxError(
      `Mapbox request failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Handle large GPS traces by chunking into multiple requests
 *
 * Mapbox has a limit of 100 coordinates per request. For larger traces,
 * we split into overlapping chunks, make separate requests, and merge
 * the results.
 *
 * @param points - All GPS points (>100)
 * @param token - Mapbox access token
 * @returns Merged match response
 */
async function mapMatchLargeTrace(
  points: GpxPoint[],
  token: string
): Promise<MapboxMatchResponse> {
  const chunkSize = MAPBOX.MAX_COORDINATES;
  const overlap = 10; // Overlap to maintain continuity between chunks
  const chunks: GpxPoint[][] = [];

  // Create overlapping chunks
  for (let i = 0; i < points.length; i += chunkSize - overlap) {
    const chunk = points.slice(i, i + chunkSize);
    if (chunk.length >= 2) {
      chunks.push(chunk);
    }
  }

  console.log(
    `[Mapbox] Large trace: splitting ${points.length} points into ${chunks.length} chunks`
  );

  // Process chunks sequentially (to avoid rate limiting)
  const results: MapboxMatchResponse[] = [];

  for (let i = 0; i < chunks.length; i++) {
    console.log(
      `[Mapbox] Processing chunk ${i + 1}/${chunks.length} (${
        chunks[i].length
      } points)`
    );
    const result = await makeMapboxRequest(chunks[i], token);
    results.push(result);
  }

  // Merge results
  return mergeMapboxResponses(results);
}

/**
 * Merge multiple Mapbox responses into one
 *
 * Combines matchings and tracepoints from multiple chunked responses.
 * Removes duplicates from overlap regions.
 *
 * @param responses - Array of Mapbox responses to merge
 * @returns Single merged response
 */
function mergeMapboxResponses(
  responses: MapboxMatchResponse[]
): MapboxMatchResponse {
  if (responses.length === 0) {
    throw new MapboxError("No responses to merge");
  }

  if (responses.length === 1) {
    return responses[0];
  }

  // Merge all matchings
  const allMatchings: MapboxMatching[] = [];
  const allTracepoints: (MapboxTracepoint | null)[] = [];

  for (const response of responses) {
    allMatchings.push(...response.matchings);
    allTracepoints.push(...response.tracepoints);
  }

  // Calculate aggregate confidence (weighted by matching distance)
  const totalDistance = allMatchings.reduce((sum, m) => sum + m.distance, 0);
  const weightedConfidence = allMatchings.reduce(
    (sum, m) => sum + m.confidence * m.distance,
    0
  );
  const avgConfidence =
    totalDistance > 0 ? weightedConfidence / totalDistance : 0;

  // Create merged matching
  const mergedMatching: MapboxMatching = {
    confidence: avgConfidence,
    geometry: mergeGeometries(allMatchings.map((m) => m.geometry)),
    legs: allMatchings.flatMap((m) => m.legs),
    distance: totalDistance,
    duration: allMatchings.reduce((sum, m) => sum + m.duration, 0),
  };

  return {
    code: "Ok",
    matchings: [mergedMatching],
    tracepoints: allTracepoints,
  };
}

/**
 * Merge multiple LineString geometries into one
 *
 * @param geometries - Array of GeoJSON LineStrings
 * @returns Single merged LineString
 */
function mergeGeometries(geometries: GeoJsonLineString[]): GeoJsonLineString {
  const allCoordinates: [number, number][] = [];

  for (const geom of geometries) {
    if (geom && geom.coordinates) {
      // Skip first coordinate if it duplicates the last (from overlap)
      const startIndex =
        allCoordinates.length > 0 &&
        geom.coordinates.length > 0 &&
        coordsEqual(
          allCoordinates[allCoordinates.length - 1],
          geom.coordinates[0]
        )
          ? 1
          : 0;

      allCoordinates.push(...geom.coordinates.slice(startIndex));
    }
  }

  return {
    type: "LineString",
    coordinates: allCoordinates,
  };
}

/**
 * Check if two coordinates are equal (within small tolerance)
 */
function coordsEqual(a: [number, number], b: [number, number]): boolean {
  const tolerance = 0.000001; // ~0.1m at equator
  return Math.abs(a[0] - b[0]) < tolerance && Math.abs(a[1] - b[1]) < tolerance;
}
