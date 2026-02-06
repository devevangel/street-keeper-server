/**
 * Parser Test Engine Type Definitions
 *
 * Edge-based street coverage system.
 * Edges are truth, streets are derived, completion is deterministic.
 */

// ============================================
// Module 1: GPX Parser Types
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
// Module 2: OSRM Matcher Types
// ============================================

/** Result of OSRM map matching */
export interface OsrmMatchResult {
  confidence: number; // 0.0 to 1.0 (UX ONLY - never blocks edges)
  geometry: {
    type: "LineString";
    coordinates: [number, number][]; // [lng, lat] pairs (PRESENTATION ONLY)
  };
  nodes: bigint[]; // OSM node IDs in traversal order (SOURCE OF TRUTH)
  distance: number; // Total matched distance in meters
  duration: number; // Total matched duration in seconds
  warnings: string[];
}

// ============================================
// Module 3: Way Resolver Types
// ============================================

/** A node pair resolved to an OSM way */
export interface ResolvedEdge {
  nodeA: bigint;
  nodeB: bigint;
  wayId: bigint;
  wayName: string | null;
  highwayType: string;
  lengthMeters: number;
}

/** Result of way resolution from node pairs */
export interface WayResolverResult {
  resolvedEdges: ResolvedEdge[];
  cacheHits: number;
  cacheMisses: number;
  warnings: string[];
}

// ============================================
// Module 4: Edge Builder Types
// ============================================

/** An edge that passed or failed validation */
export interface ValidatedEdge {
  edgeId: string; // "{nodeA}-{nodeB}" normalized
  nodeA: bigint;
  nodeB: bigint;
  wayId: bigint;
  wayName: string | null;
  highwayType: string;
  lengthMeters: number;
  isValid: boolean;
  rejectionReason?: string;
}

/** Result of edge building and validation */
export interface EdgeBuilderResult {
  validEdges: ValidatedEdge[];
  rejectedEdges: ValidatedEdge[];
  statistics: {
    totalEdges: number;
    validCount: number;
    rejectedCount: number;
    rejectionReasons: Record<string, number>;
  };
}

// ============================================
// API Response Types
// ============================================

/** Per-way completion from UserEdge data */
export interface StreetCompletion {
  wayId: bigint;
  name: string | null;
  edgesTotal: number;
  edgesCompleted: number;
  isComplete: boolean;
}

/** Streets grouped by name for client display */
export interface GroupedStreet {
  name: string; // Street name (or "Unnamed")
  wayIds: string[]; // All OSM way IDs for this street
  edgesTotal: number; // Sum across all ways
  edgesCompleted: number; // Sum of unique edges across all ways
  isComplete: boolean; // True only if ALL ways are complete
  completionPercent: number; // edgesCompleted / edgesTotal * 100, rounded
}

/** Response from POST /engine-v2/analyze */
export interface AnalyzeGpxResponse {
  success: boolean;
  run: {
    name: string | null;
    date: string; // ISO 8601
    totalPoints: number;
    matchedPoints: number;
    matchConfidence: number;
    distanceMeters: number;
  };
  path: {
    type: "LineString";
    coordinates: [number, number][]; // [lng, lat] pairs (PRESENTATION ONLY)
  };
  edges: {
    total: number;
    valid: number;
    rejected: number;
    list: Array<{
      edgeId: string;
      wayId: string; // serialized from bigint for JSON
      wayName: string | null;
      lengthMeters: number;
    }>;
  };
  streets: GroupedStreet[]; // Streets grouped by name (client-friendly, no duplicates)
  warnings: string[];
}
