/**
 * Run Types
 * Types for GPX parsing and street matching
 */

export type CompletionStatus = "FULL" | "PARTIAL";

/** Single GPS coordinate from GPX file */
export interface GpxPoint {
  lat: number;
  lng: number;
  elevation?: number;
  timestamp?: Date;
}

/** Parsed GPX data */
export interface ParsedGpxData {
  points: GpxPoint[];
  name?: string;
  startTime?: Date;
  endTime?: Date;
}

/** Bounding box for area queries */
export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** GeoJSON LineString for street geometry */
export interface GeoJsonLineString {
  type: "LineString";
  coordinates: [number, number][];
}

/** Street data from OpenStreetMap */
export interface OsmStreet {
  osmId: string;
  name: string;
  lengthMeters: number;
  geometry: GeoJsonLineString;
  highwayType: string;
}

/** Result of matching a single street */
export interface MatchedStreet {
  osmId: string;
  name: string;
  highwayType: string;
  lengthMeters: number;
  distanceCoveredMeters: number;
  coverageRatio: number;
  completionStatus: CompletionStatus;
  matchedPointsCount: number;
  
  /**
   * Phase 2: Geometry-based coverage (optional, more accurate)
   * Distance measured along the street geometry itself, not between GPS points.
   * This accounts for GPS drift and gives more accurate coverage ratios.
   */
  geometryDistanceCoveredMeters?: number;
  geometryCoverageRatio?: number;
}

/** Successful GPX analysis response */
export interface AnalyzeGpxResponse {
  success: true;
  analysis: {
    gpxName?: string;
    totalDistanceMeters: number;
    durationSeconds: number;
    pointsCount: number;
    startTime?: string;
    endTime?: string;
  };
  streets: {
    total: number;
    fullCount: number;
    partialCount: number;
    list: MatchedStreet[];
  };
}

/** Error response */
export interface GpxErrorResponse {
  success: false;
  error: string;
  code: string;
}

/** Overpass API element response */
export interface OverpassElement {
  type: "way";
  id: number;
  geometry: { lat: number; lon: number }[];
  tags: {
    name?: string;
    highway?: string;
    [key: string]: string | undefined;
  };
}

/** Overpass API response structure */
export interface OverpassResponse {
  elements: OverpassElement[];
}

// ============================================
// Phase 4: Street Aggregation Types
// ============================================

/**
 * Aggregated logical street (groups multiple OSM ways with same name)
 *
 * Phase 4 Implementation: Street Aggregation
 *
 * OpenStreetMap often splits a single logical street into multiple "ways"
 * (segments). For example, "Main Street" might be split into:
 * - way/123: "Main Street" (residential, 200m)
 * - way/456: "Main Street" (residential, 150m)
 * - way/789: "Main Street" (residential, 100m)
 *
 * This interface represents the aggregated street, combining all segments
 * into a single logical street entry for better UX.
 *
 * Example:
 * {
 *   name: "Main Street",
 *   normalizedName: "main street",
 *   highwayType: "residential",
 *   totalLengthMeters: 450,
 *   totalDistanceCoveredMeters: 425,
 *   coverageRatio: 0.944,        // Clamped to max 1.0
 *   rawCoverageRatio: 0.944,     // Unclamped (for debugging)
 *   completionStatus: "FULL",
 *   segmentCount: 3,
 *   segmentOsmIds: ["way/123", "way/456", "way/789"]
 * }
 */
export interface AggregatedStreet {
  name: string;
  normalizedName: string;
  highwayType: string;
  totalLengthMeters: number;
  totalDistanceCoveredMeters: number;
  coverageRatio: number; // Clamped to max 1.0 for UX
  rawCoverageRatio: number; // Unclamped for debugging
  completionStatus: CompletionStatus;
  segmentCount: number;
  segmentOsmIds: string[];
}

/**
 * Bucket for unnamed roads grouped by highway type
 *
 * Phase 4 Implementation: Unnamed Road Bucketing
 *
 * Unnamed roads (footways, paths, etc.) are grouped by highway type
 * rather than listed individually. This improves UX by reducing clutter
 * and providing meaningful summaries.
 *
 * Example:
 * {
 *   highwayType: "footway",
 *   displayName: "Footpath (Unnamed)",
 *   totalLengthMeters: 226.89,
 *   totalDistanceCoveredMeters: 47.05,
 *   coverageRatio: 0.207,
 *   segmentCount: 3,
 *   fullCount: 1,
 *   partialCount: 2
 * }
 */
export interface UnnamedRoadBucket {
  highwayType: string;
  displayName: string; // e.g., "Footpath (Unnamed)"
  totalLengthMeters: number;
  totalDistanceCoveredMeters: number;
  coverageRatio: number;
  segmentCount: number;
  fullCount: number;
  partialCount: number;
}

/**
 * Enhanced GPX analysis with quality metrics and street coverage summary
 *
 * Phase 4 Implementation: Enhanced Analysis
 *
 * Extends basic GPX analysis with:
 * - Phase 3: Time breakdown (moving vs stopped)
 * - Phase 3: Track quality metrics (spacing, jumps)
 * - Phase 4: Street coverage summary (total streets, full/partial counts)
 */
export interface EnhancedAnalysis {
  gpxName?: string;
  totalDistanceMeters: number;
  durationSeconds: number;
  pointsCount: number;
  startTime?: string;
  endTime?: string;

  // Phase 3: Time breakdown
  movingTimeSeconds?: number;
  stoppedTimeSeconds?: number;

  // Phase 3: Track quality
  avgPointSpacingMeters: number;
  maxSegmentDistanceMeters: number;
  gpsJumpCount: number;

  // Phase 4: Street coverage summary
  streetsTotal: number;
  streetsFullCount: number;
  streetsPartialCount: number;
  percentageFullStreets: number;
}

/**
 * Aggregation result containing both named streets and unnamed road buckets
 *
 * Returned by aggregateSegmentsIntoLogicalStreets() to provide
 * both aggregated named streets and bucketed unnamed roads.
 */
export interface AggregationResult {
  streets: AggregatedStreet[];
  unnamedBuckets: UnnamedRoadBucket[];
}

/**
 * Enhanced GPX analysis response with both segment and aggregated data
 *
 * Phase 4 Implementation: Enhanced Response Structure
 *
 * Provides both:
 * - Raw segment-level data (for debugging, advanced use)
 * - Aggregated street-level data (for UX, cleaner presentation)
 * - Unnamed roads bucketed by type
 */
export interface EnhancedAnalyzeGpxResponse {
  success: true;
  analysis: EnhancedAnalysis;

  // Raw segment-level data (for debugging, advanced use)
  segments: {
    total: number;
    fullCount: number;
    partialCount: number;
    list: MatchedStreet[];
  };

  // Aggregated street-level data (for UX)
  streets: {
    total: number;
    fullCount: number;
    partialCount: number;
    list: AggregatedStreet[];
  };

  // Unnamed roads bucketed by type
  unnamedRoads: {
    totalSegments: number;
    buckets: UnnamedRoadBucket[];
  };
}