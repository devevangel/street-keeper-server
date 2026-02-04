/**
 * Map Types
 * Types for the home page map view: user street progress with geometry and stats
 */

// ============================================
// Street Stats (Info Icon Popup)
// ============================================

/**
 * Stats for a single street, shown in the map info icon popup
 */
export interface MapStreetStats {
  /** Times the user has run on this street */
  runCount: number;
  /** Times the user achieved >= 90% coverage on this street */
  completionCount: number;
  /** Date of first run (ISO string) */
  firstRunDate: string | null;
  /** Date of most recent run (ISO string) */
  lastRunDate: string | null;
  /** Street length in meters */
  totalLengthMeters: number;
  /** Current coverage percentage (0-100) */
  currentPercentage: number;
  /** True if user has ever completed this street (>= 90%) */
  everCompleted: boolean;
}

// ============================================
// Map Street (Single Street for Rendering)
// ============================================

/**
 * Single street for map rendering with geometry and stats
 * Used by GET /api/v1/map/streets response
 */
export interface MapStreet {
  /** OpenStreetMap way ID */
  osmId: string;
  /** Street name */
  name: string;
  /** Highway type (e.g. residential, footway) */
  highwayType: string;
  /** Street length in meters */
  lengthMeters: number;
  /** Current coverage percentage (0-100) */
  percentage: number;
  /** Display status: completed (green) or partial (yellow) */
  status: "completed" | "partial";
  /** GeoJSON LineString for drawing the street on the map */
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
  /** Stats for the info icon popup */
  stats: MapStreetStats;
}

// ============================================
// API Response Types
// ============================================

/**
 * Response for GET /api/v1/map/streets
 */
export interface MapStreetsResponse {
  success: true;
  /** Aggregated logical streets (for list and stats) */
  streets: MapStreet[];
  /** Segment-level streets (for map polylines) */
  segments: MapStreet[];
  /** Request center (lat, lng) */
  center: { lat: number; lng: number };
  /** Request radius in meters */
  radiusMeters: number;
  /** Total logical streets (aggregated count) */
  totalStreets: number;
  /** Count of completed streets (green) */
  completedCount: number;
  /** Count of partial streets (yellow) */
  partialCount: number;
}
