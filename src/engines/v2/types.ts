/**
 * V2 Engine Type Definitions
 *
 * CityStrides-style node proximity: nodes hit within 25m, completion by 90% rule.
 */

// ============================================
// GPX Parser Types
// ============================================

/** Single GPS coordinate with optional timestamp */
export interface GpxPoint {
  lat: number;
  lng: number;
  time: string | null;
}

/** Parsed GPX data with coordinates and metadata */
export interface ParsedGpx {
  name: string | null;
  points: GpxPoint[];
  totalPoints: number;
}

// ============================================
// API Response Types
// ============================================

/** Per-way completion from UserNodeHit + WayNode (nodes hit / total nodes) */
export interface StreetCompletion {
  wayId: bigint;
  name: string | null;
  edgesTotal: number; // total nodes (display compatibility)
  edgesCompleted: number; // nodes hit (display compatibility)
  isComplete: boolean;
}

/** Streets grouped by name for client display */
export interface GroupedStreet {
  name: string;
  wayIds: string[];
  edgesTotal: number;
  edgesCompleted: number;
  isComplete: boolean;
  completionPercent: number;
}

/** Response from POST /engine-v2/analyze */
export interface AnalyzeGpxResponse {
  success: boolean;
  run: {
    name: string | null;
    date: string;
    totalPoints: number;
    nodesHit: number;
  };
  streets: GroupedStreet[];
  warnings: string[];
}
