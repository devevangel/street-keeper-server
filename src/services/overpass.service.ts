/**
 * Overpass Service
 * Queries OpenStreetMap via Overpass API for street data
 *
 * Overpass API is a read-only API for querying OpenStreetMap data.
 * It's free to use, no API key required, but be respectful of rate limits.
 *
 * What this service does:
 * 1. Takes a bounding box (rectangle area from GPS track)
 * 2. Queries Overpass API for all streets/roads in that area
 * 3. Returns street data with names, lengths, and geometries
 *
 * Overpass Query Language (Overpass QL):
 * We use Overpass QL to query for "ways" (lines) with "highway" tags.
 * Highway tags indicate roads, paths, footways, etc.
 *
 * API Endpoint: https://overpass-api.de/api/interpreter
 * Rate Limits: Be respectful (~1 request/second for heavy queries)
 *
 * @see https://wiki.openstreetmap.org/wiki/Overpass_API
 */

import axios from "axios";
import type {
  BoundingBox,
  OsmStreet,
  OverpassResponse,
  GeoJsonLineString,
} from "../types/run.types.js";
import { OVERPASS } from "../config/constants.js";
import { calculateLineLength } from "./geo.service.js";

// ============================================
// Main Query Function
// ============================================

/**
 * Query streets within a bounding box from OpenStreetMap
 *
 * Sends an Overpass QL query to fetch all streets/roads/paths
 * within the specified geographic area.
 *
 * Features:
 * - Automatic retry with exponential backoff
 * - Fallback to alternative servers if primary fails
 * - Increased timeout for better reliability
 *
 * @param bbox - Bounding box defining the query area
 * @returns Array of OsmStreet objects with name, length, and geometry
 * @throws OverpassError if all API requests fail after retries
 *
 * @example
 * const bbox = { south: 50.79, north: 50.81, west: -1.10, east: -1.08 };
 * const streets = await queryStreetsInBoundingBox(bbox);
 * // Returns: [
 * //   { osmId: "way/123", name: "High Street", lengthMeters: 450, ... },
 * //   { osmId: "way/456", name: "Park Lane", lengthMeters: 320, ... },
 * // ]
 */
export async function queryStreetsInBoundingBox(
  bbox: BoundingBox
): Promise<OsmStreet[]> {
  // Build the highway type filter (residential|primary|secondary|...)
  const highwayFilter = OVERPASS.HIGHWAY_TYPES.join("|");

  // Construct Overpass QL query
  // This query:
  // - Sets output format to JSON
  // - Sets timeout to 60 seconds (increased for reliability)
  // - Finds all "ways" with highway tag matching our types
  // - Filters by bounding box (south, west, north, east)
  // - Returns body (tags) and geometry (coordinates)
  const query = `
    [out:json][timeout:${OVERPASS.QUERY_TIMEOUT_SECONDS}];
    way["highway"~"^(${highwayFilter})$"]
      (${bbox.south},${bbox.west},${bbox.north},${bbox.east});
    out body geom;
  `;

  // List of servers to try (primary + fallbacks)
  const servers = [OVERPASS.API_URL, ...OVERPASS.FALLBACK_URLS];
  const errors: string[] = [];

  // Try each server with retries
  for (let serverIndex = 0; serverIndex < servers.length; serverIndex++) {
    const serverUrl = servers[serverIndex];
    const isLastServer = serverIndex === servers.length - 1;

    // Retry up to MAX_RETRIES times per server
    for (let attempt = 0; attempt < OVERPASS.MAX_RETRIES; attempt++) {
      try {
        // Exponential backoff: wait before retry (except first attempt)
        if (attempt > 0) {
          const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Max 5s
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        // Send POST request to Overpass API
        const response = await axios.post<OverpassResponse>(
          serverUrl,
          query,
          {
            headers: { "Content-Type": "text/plain" },
            timeout: OVERPASS.TIMEOUT_MS,
          }
        );

        // Success! Parse and return results
        console.log(
          `[Overpass] Successfully queried ${serverUrl} (attempt ${attempt + 1})`
        );
        return parseOverpassResponse(response.data);
      } catch (error) {
        const errorMessage = getErrorMessage(error, serverUrl, attempt);
        errors.push(errorMessage);

        // Check if this is a retryable error
        const isRetryable = isRetryableError(error);

        // If not retryable (e.g., 400 Bad Request), don't retry
        if (!isRetryable) {
          throw new OverpassError(errorMessage);
        }

        // If last attempt on last server, throw error
        if (attempt === OVERPASS.MAX_RETRIES - 1 && isLastServer) {
          throw new OverpassError(
            `All Overpass API servers failed after ${OVERPASS.MAX_RETRIES} attempts each. Last error: ${errorMessage}`
          );
        }

        // Log retry attempt
        console.warn(
          `[Overpass] ${serverUrl} failed (attempt ${attempt + 1}/${OVERPASS.MAX_RETRIES}): ${errorMessage}`
        );
      }
    }

    // If we get here, this server failed all retries
    // Try next server (if available)
    if (!isLastServer) {
      console.log(
        `[Overpass] Switching to fallback server after ${OVERPASS.MAX_RETRIES} failed attempts`
      );
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new OverpassError(
    `All Overpass API servers failed. Errors: ${errors.join("; ")}`
  );
}

/**
 * Check if an error is retryable (should we try again?)
 *
 * Retryable errors:
 * - 504 Gateway Timeout (server busy)
 * - 503 Service Unavailable (temporary)
 * - ECONNABORTED (client timeout)
 * - Network errors
 *
 * Non-retryable errors:
 * - 400 Bad Request (query syntax error)
 * - 429 Too Many Requests (rate limit - wait longer)
 */
function isRetryableError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;

  // Client timeout - retryable
  if (error.code === "ECONNABORTED") return true;

  const status = error.response?.status;

  // Server errors - retryable
  if (status === 504 || status === 503 || status === 502) return true;

  // Rate limit - don't retry immediately (would hit limit again)
  if (status === 429) return false;

  // Bad request - don't retry (query is wrong)
  if (status === 400) return false;

  // Network errors - retryable
  if (!status && error.message.includes("Network")) return true;

  return false;
}

/**
 * Extract user-friendly error message from error
 */
function getErrorMessage(
  error: unknown,
  serverUrl: string,
  attempt: number
): string {
  if (!axios.isAxiosError(error)) {
    return `Unknown error: ${String(error)}`;
  }

  // Client timeout
  if (error.code === "ECONNABORTED") {
    return `Request timeout after ${OVERPASS.TIMEOUT_MS}ms`;
  }

  const status = error.response?.status;

  // Rate limit
  if (status === 429) {
    return "Rate limit exceeded - too many requests";
  }

  // Gateway timeout
  if (status === 504) {
    return "Gateway timeout - server is busy";
  }

  // Service unavailable
  if (status === 503) {
    return "Service unavailable - server is temporarily down";
  }

  // Bad gateway
  if (status === 502) {
    return "Bad gateway - upstream server error";
  }

  // Generic error
  return `HTTP ${status || "unknown"}: ${error.message}`;
}

// ============================================
// Response Parsing
// ============================================

/**
 * Parse Overpass API response into OsmStreet objects
 *
 * Overpass returns data in a specific format. This function
 * transforms it into our OsmStreet interface.
 *
 * Overpass response structure:
 * {
 *   elements: [
 *     {
 *       type: "way",
 *       id: 123456789,
 *       geometry: [{ lat: 50.79, lon: -1.09 }, ...],
 *       tags: { name: "High Street", highway: "residential" }
 *     },
 *     ...
 *   ]
 * }
 *
 * @param data - Raw Overpass API response
 * @returns Array of OsmStreet objects
 */
function parseOverpassResponse(data: OverpassResponse): OsmStreet[] {
  const streets: OsmStreet[] = [];

  for (const element of data.elements) {
    // Skip non-way elements (shouldn't happen with our query, but safety first)
    if (element.type !== "way") continue;

    // Skip elements without geometry
    if (!element.geometry || element.geometry.length === 0) continue;

    // Convert Overpass geometry to GeoJSON format
    // Overpass: { lat, lon }  →  GeoJSON: [lng, lat]
    const coordinates: [number, number][] = element.geometry.map((node) => [
      node.lon, // longitude first (GeoJSON standard)
      node.lat, // latitude second
    ]);

    // Need at least 2 points to form a line
    if (coordinates.length < 2) continue;

    // Build GeoJSON LineString geometry
    const geometry: GeoJsonLineString = {
      type: "LineString",
      coordinates,
    };

    // Collect alternative names for better cross-source matching
    const altNames: string[] = [];
    if (element.tags.alt_name) altNames.push(element.tags.alt_name);
    if (element.tags["name:en"]) altNames.push(element.tags["name:en"]);
    if (element.tags.old_name) altNames.push(element.tags.old_name);
    if (element.tags.loc_name) altNames.push(element.tags.loc_name);

    // Use primary name or fallback to alternatives, then "Unnamed Road"
    const primaryName =
      element.tags.name ||
      element.tags.alt_name ||
      element.tags["name:en"] ||
      "Unnamed Road";

    // Create OsmStreet object with extended metadata
    const street: OsmStreet = {
      // Unique identifier: "way/123456789"
      osmId: `way/${element.id}`,

      // Street name from tags, with fallback chain
      name: primaryName,

      // Calculate total length of the street in meters
      lengthMeters: calculateLineLength(geometry),

      // Store geometry for point-to-line distance calculations
      geometry,

      // Type of road (residential, primary, footway, etc.)
      highwayType: element.tags.highway || "unknown",

      // Alternative names for cross-source matching
      altNames: altNames.length > 0 ? altNames : undefined,

      // Surface type (asphalt, concrete, gravel, etc.)
      surface: element.tags.surface,

      // Access restrictions (private, no, permissive, etc.)
      access: element.tags.access,

      // Road reference number (e.g., "A1", "B2154")
      ref: element.tags.ref,
    };

    streets.push(street);
  }

  return streets;
}

// ============================================
// Radius Query Function (for Routes)
// ============================================

/**
 * Query streets within a radius from a center point
 * 
 * Used for creating Routes - queries all streets within a circular area
 * around a center point. This is more appropriate for Routes than bounding
 * box queries because Routes are defined by center + radius.
 * 
 * Features:
 * - Queries by radius (circular area) instead of bounding box
 * - Only returns named streets (filters out unnamed roads)
 * - Same retry/fallback logic as bounding box query
 * 
 * @param centerLat - Center latitude of the search area
 * @param centerLng - Center longitude of the search area
 * @param radiusMeters - Radius in meters (e.g., 2000 for 2km)
 * @returns Array of OsmStreet objects with name, length, and geometry
 * @throws OverpassError if all API requests fail after retries
 * 
 * @example
 * // Query streets within 2km of a point
 * const streets = await queryStreetsInRadius(50.788, -1.089, 2000);
 * // Returns: [
 * //   { osmId: "way/123", name: "High Street", lengthMeters: 450, ... },
 * //   { osmId: "way/456", name: "Park Lane", lengthMeters: 320, ... },
 * // ]
 */
export async function queryStreetsInRadius(
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): Promise<OsmStreet[]> {
  // Build the highway type filter (residential|primary|secondary|...)
  const highwayFilter = OVERPASS.HIGHWAY_TYPES.join("|");

  // Construct Overpass QL query using "around" filter
  // The "around" filter selects ways within a radius of a point
  // Note: We include ["name"] to only get named streets
  const query = `
    [out:json][timeout:${OVERPASS.QUERY_TIMEOUT_SECONDS}];
    way["highway"~"^(${highwayFilter})$"]["name"]
      (around:${radiusMeters}, ${centerLat}, ${centerLng});
    out body geom;
  `;

  // Use the same server list and retry logic
  return executeOverpassQuery(query);
}

/**
 * Query ALL streets (including unnamed) within a radius
 * 
 * Similar to queryStreetsInRadius but includes unnamed roads.
 * Used when we need complete street coverage (e.g., for accurate map display).
 * 
 * @param centerLat - Center latitude of the search area
 * @param centerLng - Center longitude of the search area
 * @param radiusMeters - Radius in meters
 * @returns Array of OsmStreet objects (includes unnamed roads)
 */
export async function queryAllStreetsInRadius(
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): Promise<OsmStreet[]> {
  const highwayFilter = OVERPASS.HIGHWAY_TYPES.join("|");

  // Same query but without ["name"] filter
  const query = `
    [out:json][timeout:${OVERPASS.QUERY_TIMEOUT_SECONDS}];
    way["highway"~"^(${highwayFilter})$"]
      (around:${radiusMeters}, ${centerLat}, ${centerLng});
    out body geom;
  `;

  return executeOverpassQuery(query);
}

/**
 * Execute an Overpass query with retry and fallback logic
 * 
 * Internal helper that handles the actual API request with:
 * - Multiple server fallbacks
 * - Exponential backoff retries
 * - Error classification and handling
 * 
 * @param query - Overpass QL query string
 * @returns Parsed OsmStreet array
 * @throws OverpassError if all attempts fail
 */
async function executeOverpassQuery(query: string): Promise<OsmStreet[]> {
  const servers = [OVERPASS.API_URL, ...OVERPASS.FALLBACK_URLS];
  const errors: string[] = [];

  for (let serverIndex = 0; serverIndex < servers.length; serverIndex++) {
    const serverUrl = servers[serverIndex];
    const isLastServer = serverIndex === servers.length - 1;

    for (let attempt = 0; attempt < OVERPASS.MAX_RETRIES; attempt++) {
      try {
        // Exponential backoff (except first attempt)
        if (attempt > 0) {
          const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        const response = await axios.post<OverpassResponse>(
          serverUrl,
          query,
          {
            headers: { "Content-Type": "text/plain" },
            timeout: OVERPASS.TIMEOUT_MS,
          }
        );

        console.log(
          `[Overpass] Successfully queried ${serverUrl} (attempt ${attempt + 1})`
        );
        return parseOverpassResponse(response.data);
      } catch (error) {
        const errorMessage = getErrorMessage(error, serverUrl, attempt);
        errors.push(errorMessage);

        if (!isRetryableError(error)) {
          throw new OverpassError(errorMessage);
        }

        if (attempt === OVERPASS.MAX_RETRIES - 1 && isLastServer) {
          throw new OverpassError(
            `All Overpass API servers failed after ${OVERPASS.MAX_RETRIES} attempts each. Last error: ${errorMessage}`
          );
        }

        console.warn(
          `[Overpass] ${serverUrl} failed (attempt ${attempt + 1}/${OVERPASS.MAX_RETRIES}): ${errorMessage}`
        );
      }
    }

    if (!isLastServer) {
      console.log(
        `[Overpass] Switching to fallback server after ${OVERPASS.MAX_RETRIES} failed attempts`
      );
    }
  }

  throw new OverpassError(
    `All Overpass API servers failed. Errors: ${errors.join("; ")}`
  );
}

// ============================================
// Custom Error Class
// ============================================

/**
 * Custom error class for Overpass API errors
 *
 * Thrown when:
 * - API request times out
 * - Rate limit exceeded (429)
 * - Server errors (5xx)
 * - Network failures
 *
 * Caught in route handler to return appropriate error response.
 *
 * @example
 * try {
 *   const streets = await queryStreetsInBoundingBox(bbox);
 * } catch (error) {
 *   if (error instanceof OverpassError) {
 *     // Return 502 Bad Gateway with error message
 *     res.status(502).json({ error: error.message });
 *   }
 * }
 */
export class OverpassError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OverpassError";
  }
}
