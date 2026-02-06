/**
 * Parser Test Engine Configuration
 *
 * Edge-based street coverage system.
 * All thresholds are binary gates - pass = accept, fail = reject.
 */

export const PARSER_CONFIG = {
  // ============================================
  // OSRM Map Matching Configuration
  // ============================================
  osrm: {
    // Use OSRM_BASE_URL from .env (your AWS instance) or fall back to public demo
    baseUrl:
      process.env.OSRM_BASE_URL?.replace(/\/$/, "") ??
      "https://router.project-osrm.org",
    profile: "foot" as const, // or "walking"
    timeout: 30000,
    maxCoordinates: 50, // OSRM limit per request (reduced from 100 for safety)
  },

  // ============================================
  // Edge Validation Rules (Binary Gates)
  // ============================================
  validation: {
    // Minimum edge length in meters (filters noise from dense OSM nodes)
    minEdgeLengthMeters: 5,

    // Maximum speed in m/s (optional sanity check)
    // Reject edges that would require impossible speed
    maxSpeedMps: 50,

    // Excluded highway types (CONFIGURABLE)
    // Set to [] to include all paths (CityStrides style)
    // Default excludes service roads and driveways
    excludedHighwayTypes: ["service", "driveway", "parking_aisle"],
  },

  // ============================================
  // Overpass API Configuration
  // ============================================
  overpass: {
    baseUrl: "https://overpass-api.de/api/interpreter",
    timeout: 30000,
    // When true, never call Overpass; use only WayCache (e.g. after seeding from PBF).
    skipOverpass: process.env.SKIP_OVERPASS === "true",
  },

  // ============================================
  // Caching Configuration
  // ============================================
  cache: {
    // How long to cache way data (in days)
    // OSM data rarely changes, so 30 days is safe
    wayExpiryDays: 30,
  },
} as const;
