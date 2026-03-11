/**
 * V2 engine configuration (CityStrides-style node proximity).
 */

/**
 * CityStrides-style node proximity configuration.
 */
export const NODE_PROXIMITY_CONFIG = {
  /** Buffer radius in meters around each GPS point (CityStrides "snap"). */
  snapRadiusM: 25,
  /** Streets with this many nodes or fewer require 100% of nodes hit. */
  shortStreetNodeThreshold: 10,
  /** For longer streets, this fraction of nodes must be hit to mark complete. */
  standardCompletionThreshold: 0.9,
} as const;

/**
 * Overpass and cache (used by WayCache seeding; optional for runtime).
 * @deprecated skipOverpass is no longer used; V2 data comes from on-demand city sync (Overpass per city), not PBF seed.
 */
export const PARSER_CONFIG = {
  overpass: {
    baseUrl: "https://overpass-api.de/api/interpreter",
    timeout: 30000,
    /** @deprecated No longer needed; city sync uses Overpass on-demand. Kept for backward compatibility. */
    skipOverpass: process.env.SKIP_OVERPASS === "true",
  },
  cache: {
    wayExpiryDays: 30,
  },
} as const;
