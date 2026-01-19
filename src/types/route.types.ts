/**
 * Route Types
 * Types for route creation, management, and street snapshots
 */

// ============================================
// Street Snapshot Types
// ============================================

/**
 * Individual street in a route snapshot
 * Stores progress state for each street
 */
export interface SnapshotStreet {
  osmId: string;
  name: string;
  lengthMeters: number;
  highwayType: string;
  
  // Progress tracking
  completed: boolean;
  percentage: number;        // 0-100
  lastRunDate: string | null; // ISO date string
  
  // Flags
  isNew?: boolean;           // Added during refresh
}

/**
 * Full street snapshot stored in Route.streetsSnapshot JSON field
 */
export interface StreetSnapshot {
  streets: SnapshotStreet[];
  snapshotDate: string;      // ISO date string
}

// ============================================
// Route Input/Output Types
// ============================================

/**
 * Input for creating a new route
 */
export interface CreateRouteInput {
  name: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;      // Must be in ROUTES.ALLOWED_RADII
  deadline?: string;         // ISO date string (optional)
}

/**
 * Route summary for list view (minimal data)
 */
export interface RouteListItem {
  id: string;
  name: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  progress: number;
  totalStreets: number;
  completedStreets: number;
  totalLengthMeters: number;
  deadline: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Full route detail with street data
 */
export interface RouteDetail extends RouteListItem {
  streets: SnapshotStreet[];
  snapshotDate: string;
  
  // Computed stats
  inProgressCount: number;   // Streets with 1-89% coverage
  notStartedCount: number;   // Streets with 0% coverage
  
  // Refresh info
  refreshNeeded: boolean;
  daysSinceRefresh: number;
  
  // Warnings
  newStreetsDetected?: number;
}

/**
 * Route data for map view (includes geometries)
 */
export interface RouteMapStreet {
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

export interface RouteMapData {
  id: string;
  name: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  progress: number;
  streets: RouteMapStreet[];
  
  // Cache info
  geometryCacheHit: boolean;
}

// ============================================
// API Response Types
// ============================================

/**
 * Response for route list endpoint
 */
export interface RouteListResponse {
  success: true;
  routes: RouteListItem[];
  total: number;
}

/**
 * Response for route detail endpoint
 */
export interface RouteDetailResponse {
  success: true;
  route: RouteDetail;
  warning?: string;          // e.g., "Could not refresh streets"
}

/**
 * Response for route creation
 */
export interface CreateRouteResponse {
  success: true;
  route: RouteListItem;
  message: string;
}

/**
 * Response for route map endpoint
 */
export interface RouteMapResponse {
  success: true;
  map: RouteMapData;
}

/**
 * Response for route refresh
 */
export interface RouteRefreshResponse {
  success: true;
  route: RouteDetail;
  changes: {
    added: number;
    removed: number;
  };
}

// ============================================
// Route Preview Types
// ============================================

/**
 * Route preview response (before creating route)
 * 
 * Allows users to see street count and total length before committing
 * to creating a route. Uses smart caching to avoid redundant API calls:
 * - Radius decrease: Filters from cached larger radius (FREE)
 * - Radius increase: New Overpass query, then cached
 * - Same radius: Cache hit (FREE)
 * 
 * @example
 * // GET /api/v1/routes/preview?lat=50.788&lng=-1.089&radius=2000
 * {
 *   "success": true,
 *   "preview": {
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
export interface RoutePreview {
  /** Center latitude of the preview area */
  centerLat: number;
  
  /** Center longitude of the preview area */
  centerLng: number;
  
  /** Requested radius in meters */
  radiusMeters: number;
  
  /** 
   * Actual radius in cache (may be larger than requested)
   * If larger, results were filtered to requested radius
   */
  cachedRadiusMeters: number;
  
  /** 
   * Cache key to pass to create endpoint
   * Allows route creation to skip Overpass query
   */
  cacheKey: string;
  
  /** Total number of streets in the area */
  totalStreets: number;
  
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
}

/**
 * API response wrapper for route preview endpoint
 */
export interface RoutePreviewResponse {
  success: true;
  preview: RoutePreview;
}

// ============================================
// Internal Types
// ============================================

/**
 * Data needed to update route progress after activity processing
 */
export interface RouteProgressUpdate {
  routeId: string;
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
  added: string[];           // OSM IDs of new streets
  removed: string[];         // OSM IDs of removed streets
  unchanged: string[];       // OSM IDs of unchanged streets
}
