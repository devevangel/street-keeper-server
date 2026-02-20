/**
 * Project Types
 * Types for project creation, management, and street snapshots
 */

import type { MilestoneWithProgress } from "./milestone.types.js";

// ============================================
// Street Snapshot Types
// ============================================

/**
 * Individual street in a project snapshot
 * Stores progress state for each street
 */
export interface SnapshotStreet {
  osmId: string;
  name: string;
  lengthMeters: number;
  highwayType: string;

  // Progress tracking
  completed: boolean;
  percentage: number; // 0-100
  lastRunDate: string | null; // ISO date string

  // Flags
  isNew?: boolean; // Added during refresh
}

/**
 * Full street snapshot stored in Project.streetsSnapshot JSON field
 */
export interface StreetSnapshot {
  streets: SnapshotStreet[];
  snapshotDate: string; // ISO date string
}

// ============================================
// Project Input/Output Types
// ============================================

/**
 * Boundary mode: which streets to include in the project area.
 * - intersects: include if any part of street touches/crosses the boundary (default)
 * - centroid: include if street centroid is inside boundary
 * - strict: include only if entire street geometry is inside boundary
 */
export type BoundaryMode = "centroid" | "strict" | "intersects";

/**
 * Input for creating a new project.
 * For circle: provide centerLat, centerLng, radiusMeters.
 * For polygon: provide polygonCoordinates (closed ring [lng, lat][]).
 */
export interface CreateProjectInput {
  name: string;
  boundaryType?: "circle" | "polygon"; // Default "circle"
  centerLat?: number;
  centerLng?: number;
  radiusMeters?: number; // Required for circle; must be in allowed range
  polygonCoordinates?: [number, number][]; // [lng, lat][] closed ring for polygon
  boundaryMode?: BoundaryMode; // Default "intersects"
  /** Creation-time only. Cannot be changed after project creation. */
  includePreviousRuns?: boolean;
  deadline?: string; // ISO date string (optional)
  cacheKey?: string; // From preview response (circle only)
}

/**
 * Project summary for list view (minimal data).
 * For circle projects: centerLat, centerLng, radiusMeters set.
 * For polygon projects: boundaryType "polygon", center/radius null (optional centroid for display).
 */
export interface ProjectListItem {
  id: string;
  name: string;
  boundaryType: "circle" | "polygon";
  centerLat: number | null;
  centerLng: number | null;
  radiusMeters: number | null;
  progress: number;
  totalStreets: number;
  completedStreets: number;
  totalLengthMeters: number;
  deadline: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  /** Total unique street names (grouped by name). If not provided, use totalStreets. */
  totalStreetNames?: number;
  /** Completed street names (all segments of street completed). If not provided, use completedStreets. */
  completedStreetNames?: number;
}

/** Next milestone (25, 50, 75, 100) and streets needed to reach it */
export interface NextMilestone {
  target: number;
  streetsNeeded: number;
  currentProgress: number;
}

/** Street count by highway type for bar chart */
export interface StreetsByTypeItem {
  type: string;
  total: number;
  completed: number;
}

/** Completion bins for dashboard (replaces client-side CompletionFunnel computation) */
export interface CompletionBins {
  completed: number;
  almostThere: number;
  inProgress: number;
  notStarted: number;
}

/**
 * Full project detail with street data
 * When fetched without ?include=streets, streets array is empty to reduce payload.
 */
export interface ProjectDetail extends ProjectListItem {
  streets: SnapshotStreet[];
  snapshotDate: string;

  // Server-computed completion bins (by street name, so pills match the street list)
  completionBins: CompletionBins;

  /** Total distinct street names (for "X of Y streets completed" display). */
  totalStreetNames: number;
  /** Street names where every segment is completed (matches list/map). */
  completedStreetNames: number;

  // Computed stats
  inProgressCount: number; // Streets with 1-89% coverage
  notStartedCount: number; // Streets with 0% coverage

  // High-impact stats
  distanceCoveredMeters: number; // Sum of completed street lengths
  activityCount: number; // Activities that touched this project
  lastActivityDate: string | null; // Most recent activity in project (ISO)
  nextMilestone: NextMilestone | null;
  realNextMilestone: MilestoneWithProgress | null;
  streetsByType: StreetsByTypeItem[];

  // Refresh info
  refreshNeeded: boolean;
  daysSinceRefresh: number;

  // Pace and projection (server-computed, safe math)
  streetsPerWeek: number;
  projectedFinishDate: string | null; // ISO or null

  // Engagement
  currentStreak: number; // Consecutive days with a run (ending today or yesterday)
  longestStreak: number;

  // Warnings
  newStreetsDetected?: number;
}

/**
 * Project data for map view (includes geometries)
 */
export interface ProjectMapStreet {
  osmId: string;
  name: string;
  highwayType: string;
  lengthMeters: number;
  percentage: number;
  status: "completed" | "partial" | "not_started";
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
}

/** Boundary for project map (circle or polygon) */
export type ProjectMapBoundary =
  | {
      type: "circle";
      center: { lat: number; lng: number };
      radiusMeters: number;
    }
  | { type: "polygon"; coordinates: [number, number][] };

/** Stats for project map view (segment counts; use *StreetNames for display consistency with list). */
export interface ProjectMapStats {
  totalStreets: number;
  completedStreets: number;
  partialStreets: number;
  notRunStreets: number;
  completionPercentage: number;
  /** Distinct street names in this view (for "X of Y streets completed"). */
  totalStreetNames: number;
  /** Street names where every segment is completed. */
  completedStreetNames: number;
}

export interface ProjectMapData {
  id: string;
  name: string;
  /** Present for circle projects; null for polygon */
  centerLat: number | null;
  centerLng: number | null;
  radiusMeters: number | null;
  progress: number;
  /** Boundary for map centering/fitting */
  boundary: ProjectMapBoundary;
  /** Street counts by status */
  stats: ProjectMapStats;
  streets: ProjectMapStreet[];
  /** Whether geometry came from cache (vs fresh Overpass query) */
  geometryCacheHit: boolean;
}

// ============================================
// API Response Types
// ============================================

/**
 * Response for project list endpoint
 */
export interface ProjectListResponse {
  success: true;
  projects: ProjectListItem[];
  total: number;
}

/**
 * Response for project detail endpoint
 */
export interface ProjectDetailResponse {
  success: true;
  project: ProjectDetail;
  warning?: string; // e.g., "Could not refresh streets"
}

/**
 * Response for project creation
 */
export interface CreateProjectResponse {
  success: true;
  project: ProjectListItem;
  message: string;
}

/**
 * Response for project map endpoint
 */
export interface ProjectMapResponse {
  success: true;
  map: ProjectMapData;
}

/**
 * Heatmap point: [lat, lng, intensity]
 */
export type HeatmapPoint = [number, number, number];

export interface ProjectHeatmapData {
  points: HeatmapPoint[];
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

export interface ProjectHeatmapResponse {
  success: true;
  heatmap: ProjectHeatmapData;
}

/**
 * Response for project refresh
 */
export interface ProjectRefreshResponse {
  success: true;
  project: ProjectDetail;
  changes: {
    added: number;
    removed: number;
  };
}

// ============================================
// Project Preview Types
// ============================================

/**
 * Input for previewing a project (circle or polygon).
 * Circle: centerLat, centerLng, radiusMeters required.
 * Polygon: polygonCoordinates required.
 */
export interface PreviewProjectInput {
  boundaryType: "circle" | "polygon";
  centerLat?: number;
  centerLng?: number;
  radiusMeters?: number;
  polygonCoordinates?: [number, number][];
  boundaryMode?: BoundaryMode;
  includeStreets?: boolean;
}

/**
 * Project preview response (before creating project)
 *
 * Allows users to see street count and total length before committing
 * to creating a project. Uses smart caching to avoid redundant API calls:
 * - Radius decrease: Filters from cached larger radius (FREE)
 * - Radius increase: New Overpass query, then cached
 * - Same radius: Cache hit (FREE)
 *
 * @example
 * // GET /api/v1/projects/preview?lat=50.788&lng=-1.089&radius=2000
 * {
 *   "success": true,
 *   "preview": {
 *     "boundaryType": "circle",
 *     "centerLat": 50.788,
 *     "centerLng": -1.089,
 *     "radiusMeters": 2000,
 *     "cachedRadiusMeters": 5000,
 *     "cacheKey": "radius:50.788:-1.089:5000",
 *     "totalStreets": 127,
 *     "totalLengthMeters": 45230,
 *     "streetsByType": { "residential": 78, "footway": 23, "primary": 12 },
 *     "warnings": ["Large area: 127 streets found."]
 *   }
 * }
 */
export interface ProjectPreview {
  boundaryType: "circle" | "polygon";

  /** Center latitude (circle only) */
  centerLat?: number;

  /** Center longitude (circle only) */
  centerLng?: number;

  /** Requested radius in meters (circle only) */
  radiusMeters?: number;

  /**
   * Actual radius in cache (circle only; may be larger than requested)
   * If larger, results were filtered to requested radius
   */
  cachedRadiusMeters?: number;

  /** Polygon ring [lng, lat][] (polygon only) */
  polygonCoordinates?: [number, number][];

  /**
   * Cache key to pass to create endpoint
   * Allows project creation to skip Overpass query
   */
  cacheKey: string;

  /** Total number of street segments in the area */
  totalStreets: number;

  /** Total unique street names (for consistent display with detail page) */
  totalStreetNames: number;

  /** Combined length of all streets in meters */
  totalLengthMeters: number;

  /**
   * Street count grouped by highway type
   * @example { "residential": 78, "footway": 23, "primary": 12 }
   */
  streetsByType: Record<string, number>;

  /**
   * Warning messages for the user
   * @example ["Large area: 500+ streets. Consider reducing radius."]
   */
  warnings: string[];

  /**
   * Optional: Street names list (only included when includeStreets=true)
   * Grouped by name, showing unique street names with segment counts
   */
  streets?: Array<{
    name: string;
    segmentCount: number;
    totalLengthMeters: number;
    highwayType: string;
  }>;
}

/**
 * API response wrapper for project preview endpoint
 */
export interface ProjectPreviewResponse {
  success: true;
  preview: ProjectPreview;
}

// ============================================
// Internal Types
// ============================================

/**
 * Data needed to update project progress after activity processing
 */
export interface ProjectProgressUpdate {
  projectId: string;
  updatedStreets: Array<{
    osmId: string;
    newPercentage: number;
    lastRunDate: string;
  }>;
}

/**
 * Result of comparing old and new snapshots during refresh
 */
export interface SnapshotDiff {
  added: string[]; // OSM IDs of new streets
  removed: string[]; // OSM IDs of removed streets
  unchanged: string[]; // OSM IDs of unchanged streets
}
