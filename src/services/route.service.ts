/**
 * Route Service
 * Handles route creation, management, and preview functionality
 * 
 * A Route represents a geographic area (circle) where users track street completion.
 * Users define routes by selecting a center point and radius, then the system:
 * 1. Queries OpenStreetMap for all streets in that area
 * 2. Creates a snapshot of streets with progress tracking
 * 3. Updates progress as users complete activities (runs)
 * 
 * Key features:
 * - **Preview before create**: Users can see street count before committing
 * - **Smart caching**: Avoids redundant Overpass API calls
 * - **30-day refresh**: Snapshots refresh when viewed after 30 days
 * - **Progress tracking**: Each street has completion percentage (0-100%)
 * 
 * @example
 * // Preview before creating
 * const preview = await previewRoute(50.788, -1.089, 2000);
 * console.log(`${preview.totalStreets} streets, ${preview.totalLengthMeters}m`);
 * 
 * // Create route using cached preview data
 * const route = await createRoute(userId, { name: "My Route", ... }, preview.cacheKey);
 */

import prisma from "../lib/prisma.js";
import { ROUTES, GEOMETRY_CACHE } from "../config/constants.js";
import { queryStreetsInRadius, OverpassError } from "./overpass.service.js";
import {
  generateRadiusCacheKey,
  getCachedGeometries,
  setCachedGeometries,
  findLargerCachedRadius,
  filterStreetsToRadius,
} from "./geometry-cache.service.js";
import type { OsmStreet } from "../types/run.types.js";
import type {
  CreateRouteInput,
  RoutePreview,
  RouteListItem,
  RouteDetail,
  SnapshotStreet,
  StreetSnapshot,
  SnapshotDiff,
} from "../types/route.types.js";

// ============================================
// Route Preview (Before Creation)
// ============================================

/**
 * Preview streets in an area before creating a route
 * 
 * Allows users to see street count, total length, and warnings
 * before committing to create a route. Uses smart caching:
 * - Checks for exact cache match first
 * - Falls back to filtering from larger cached radius
 * - Only queries Overpass if no suitable cache exists
 * 
 * @param centerLat - Center latitude of the route
 * @param centerLng - Center longitude of the route  
 * @param radiusMeters - Radius in meters (must be in ROUTES.ALLOWED_RADII)
 * @returns Preview data including street count, length, and warnings
 * @throws OverpassError if API query fails and no cache available
 * 
 * @example
 * const preview = await previewRoute(50.788, -1.089, 2000);
 * // Returns: {
 * //   totalStreets: 127,
 * //   totalLengthMeters: 45230,
 * //   streetsByType: { residential: 78, footway: 23 },
 * //   warnings: [],
 * //   cacheKey: "geo:radius:50.788:-1.089:2000"
 * // }
 */
export async function previewRoute(
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): Promise<RoutePreview> {
  // Get streets with smart caching
  const { streets, cacheKey, cachedRadius } = await getStreetsWithCache(
    centerLat,
    centerLng,
    radiusMeters
  );

  // Filter to requested radius if cache was larger
  const filteredStreets =
    cachedRadius > radiusMeters
      ? filterStreetsToRadius(streets, centerLat, centerLng, radiusMeters)
      : streets;

  // Build summary statistics
  const totalLengthMeters = filteredStreets.reduce(
    (sum, s) => sum + s.lengthMeters,
    0
  );
  const streetsByType = groupByHighwayType(filteredStreets);

  // Generate warnings
  const warnings = generatePreviewWarnings(filteredStreets);

  return {
    centerLat,
    centerLng,
    radiusMeters,
    cachedRadiusMeters: cachedRadius,
    cacheKey,
    totalStreets: filteredStreets.length,
    totalLengthMeters: Math.round(totalLengthMeters * 100) / 100,
    streetsByType,
    warnings,
  };
}

/**
 * Get streets with smart caching strategy
 * 
 * Internal helper that implements the caching logic:
 * 1. Check for exact radius cache match
 * 2. Check for larger radius cache (filter down)
 * 3. Query Overpass if no cache exists
 * 
 * @param centerLat - Center latitude
 * @param centerLng - Center longitude
 * @param radiusMeters - Requested radius
 * @returns Streets array, cache key, and actual cached radius
 */
async function getStreetsWithCache(
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): Promise<{ streets: OsmStreet[]; cacheKey: string; cachedRadius: number }> {
  // 1. Check for exact match
  const exactKey = generateRadiusCacheKey(centerLat, centerLng, radiusMeters);
  const exactCache = await getCachedGeometries(exactKey);

  if (exactCache) {
    console.log(`[Route] Exact cache hit for ${radiusMeters}m radius`);
    return {
      streets: exactCache,
      cacheKey: exactKey,
      cachedRadius: radiusMeters,
    };
  }

  // 2. Check for larger radius cache
  const largerCache = await findLargerCachedRadius(
    centerLat,
    centerLng,
    radiusMeters
  );

  if (largerCache) {
    console.log(
      `[Route] Using larger cache (${largerCache.cachedRadius}m) for ${radiusMeters}m request`
    );
    return largerCache;
  }

  // 3. Query Overpass and cache result
  console.log(`[Route] Cache miss, querying Overpass for ${radiusMeters}m radius`);
  const streets = await queryStreetsInRadius(centerLat, centerLng, radiusMeters);
  await setCachedGeometries(exactKey, streets);

  return {
    streets,
    cacheKey: exactKey,
    cachedRadius: radiusMeters,
  };
}

// ============================================
// Route Creation
// ============================================

/**
 * Create a new route for a user
 * 
 * Creates a route with a snapshot of all streets in the area.
 * Can optionally use a cache key from preview to skip Overpass query.
 * 
 * @param userId - User ID
 * @param input - Route creation input (name, center, radius, deadline)
 * @param cacheKey - Optional cache key from preview (avoids redundant API call)
 * @returns Created route summary
 * @throws OverpassError if API query fails
 * @throws Error if no streets found in area
 * 
 * @example
 * // Create using cached preview data
 * const route = await createRoute(
 *   "user-123",
 *   { name: "Southsea Explorer", centerLat: 50.788, centerLng: -1.089, radiusMeters: 2000 },
 *   "geo:radius:50.788:-1.089:2000"
 * );
 */
export async function createRoute(
  userId: string,
  input: CreateRouteInput,
  cacheKey?: string
): Promise<RouteListItem> {
  const { name, centerLat, centerLng, radiusMeters, deadline } = input;

  // Validate radius
  if (!ROUTES.ALLOWED_RADII.includes(radiusMeters as typeof ROUTES.ALLOWED_RADII[number])) {
    throw new Error(
      `Invalid radius. Must be one of: ${ROUTES.ALLOWED_RADII.join(", ")}`
    );
  }

  // Get streets (from cache or Overpass)
  let streets: OsmStreet[];

  if (cacheKey) {
    // Try to use provided cache key
    const cached = await getCachedGeometries(cacheKey);
    if (cached) {
      // Filter to requested radius in case cache was larger
      streets = filterStreetsToRadius(cached, centerLat, centerLng, radiusMeters);
      console.log(`[Route] Using cached data from: ${cacheKey}`);
    } else {
      // Cache expired or invalid, query fresh
      console.log(`[Route] Cache key invalid/expired, querying Overpass`);
      streets = await queryStreetsInRadius(centerLat, centerLng, radiusMeters);
    }
  } else {
    // No cache key provided, use smart caching
    const result = await getStreetsWithCache(centerLat, centerLng, radiusMeters);
    streets =
      result.cachedRadius > radiusMeters
        ? filterStreetsToRadius(result.streets, centerLat, centerLng, radiusMeters)
        : result.streets;
  }

  // Validate we have streets
  if (streets.length === 0) {
    throw new Error("No streets found in this area. Try a different location or larger radius.");
  }

  // Build street snapshot
  const snapshot = buildStreetSnapshot(streets);

  // Calculate totals
  const totalLengthMeters = streets.reduce((sum, s) => sum + s.lengthMeters, 0);

  // Create route in database
  const route = await prisma.route.create({
    data: {
      userId,
      name,
      centerLat,
      centerLng,
      radiusMeters,
      streetsSnapshot: snapshot as object,
      snapshotDate: new Date(),
      totalStreets: streets.length,
      totalLengthMeters,
      completedStreets: 0,
      progress: 0,
      deadline: deadline ? new Date(deadline) : null,
    },
  });

  console.log(
    `[Route] Created route "${name}" with ${streets.length} streets for user ${userId}`
  );

  return mapRouteToListItem(route);
}

// ============================================
// Route Reading
// ============================================

/**
 * Get all routes for a user (list view)
 * 
 * Returns route summaries without full street data.
 * Sorted by creation date (newest first).
 * 
 * @param userId - User ID
 * @param includeArchived - Include archived routes (default: false)
 * @returns Array of route summaries
 */
export async function listRoutes(
  userId: string,
  includeArchived = false
): Promise<RouteListItem[]> {
  const routes = await prisma.route.findMany({
    where: {
      userId,
      ...(includeArchived ? {} : { isArchived: false }),
    },
    orderBy: { createdAt: "desc" },
  });

  return routes.map(mapRouteToListItem);
}

/**
 * Get route detail by ID
 * 
 * Returns full route data including street list.
 * Checks if refresh is needed (>30 days since snapshot).
 * 
 * @param routeId - Route ID
 * @param userId - User ID (for authorization)
 * @returns Route detail with streets and refresh status
 * @throws Error if route not found or access denied
 */
export async function getRouteById(
  routeId: string,
  userId: string
): Promise<{ route: RouteDetail; warning?: string }> {
  const route = await prisma.route.findUnique({
    where: { id: routeId },
  });

  if (!route) {
    throw new RouteNotFoundError(routeId);
  }

  if (route.userId !== userId) {
    throw new RouteAccessDeniedError(routeId);
  }

  // Check if refresh needed
  const daysSinceRefresh = getDaysSinceDate(route.snapshotDate);
  const refreshNeeded = daysSinceRefresh >= ROUTES.SNAPSHOT_REFRESH_DAYS;

  // Parse snapshot
  const snapshot = route.streetsSnapshot as StreetSnapshot;

  // Calculate additional stats
  const inProgressCount = snapshot.streets.filter(
    (s) => s.percentage > 0 && s.percentage < 90
  ).length;
  const notStartedCount = snapshot.streets.filter(
    (s) => s.percentage === 0
  ).length;

  // Check for new streets (if any marked as new)
  const newStreetsDetected = snapshot.streets.filter((s) => s.isNew).length;

  const routeDetail: RouteDetail = {
    ...mapRouteToListItem(route),
    streets: snapshot.streets,
    snapshotDate: snapshot.snapshotDate,
    inProgressCount,
    notStartedCount,
    refreshNeeded,
    daysSinceRefresh,
    ...(newStreetsDetected > 0 ? { newStreetsDetected } : {}),
  };

  // Generate warning if refresh needed
  const warning = refreshNeeded
    ? `Street data is ${daysSinceRefresh} days old. Consider refreshing.`
    : undefined;

  return { route: routeDetail, warning };
}

// ============================================
// Route Refresh
// ============================================

/**
 * Refresh route's street snapshot from OpenStreetMap
 * 
 * Re-queries OSM for current streets and merges with existing progress.
 * Detects added and removed streets since last snapshot.
 * 
 * @param routeId - Route ID
 * @param userId - User ID (for authorization)
 * @returns Updated route detail and change summary
 */
export async function refreshRouteSnapshot(
  routeId: string,
  userId: string
): Promise<{ route: RouteDetail; changes: SnapshotDiff }> {
  // Get existing route
  const route = await prisma.route.findUnique({
    where: { id: routeId },
  });

  if (!route) {
    throw new RouteNotFoundError(routeId);
  }

  if (route.userId !== userId) {
    throw new RouteAccessDeniedError(routeId);
  }

  // Query fresh data from OSM
  const freshStreets = await queryStreetsInRadius(
    route.centerLat,
    route.centerLng,
    route.radiusMeters
  );

  // Get existing snapshot
  const oldSnapshot = route.streetsSnapshot as StreetSnapshot;

  // Merge snapshots (preserve progress)
  const { newSnapshot, diff } = mergeSnapshots(oldSnapshot, freshStreets);

  // Calculate new totals
  const totalLengthMeters = newSnapshot.streets.reduce(
    (sum, s) => sum + s.lengthMeters,
    0
  );
  const completedStreets = newSnapshot.streets.filter((s) => s.completed).length;
  const progress =
    newSnapshot.streets.length > 0
      ? (completedStreets / newSnapshot.streets.length) * 100
      : 0;

  // Update route
  const updatedRoute = await prisma.route.update({
    where: { id: routeId },
    data: {
      streetsSnapshot: newSnapshot as object,
      snapshotDate: new Date(),
      totalStreets: newSnapshot.streets.length,
      totalLengthMeters,
      completedStreets,
      progress,
    },
  });

  console.log(
    `[Route] Refreshed route "${route.name}": +${diff.added.length} added, -${diff.removed.length} removed`
  );

  // Get full route detail
  const { route: routeDetail } = await getRouteById(routeId, userId);

  return { route: routeDetail, changes: diff };
}

// ============================================
// Route Updates
// ============================================

/**
 * Archive a route (soft delete)
 * 
 * @param routeId - Route ID
 * @param userId - User ID (for authorization)
 */
export async function archiveRoute(
  routeId: string,
  userId: string
): Promise<void> {
  const route = await prisma.route.findUnique({
    where: { id: routeId },
  });

  if (!route) {
    throw new RouteNotFoundError(routeId);
  }

  if (route.userId !== userId) {
    throw new RouteAccessDeniedError(routeId);
  }

  await prisma.route.update({
    where: { id: routeId },
    data: { isArchived: true },
  });

  console.log(`[Route] Archived route "${route.name}"`);
}

/**
 * Update route progress after activity processing
 * 
 * Called by activity processor when a run affects a route.
 * Updates street percentages in the snapshot.
 * 
 * @param routeId - Route ID
 * @param streetUpdates - Array of street updates with new percentages
 */
export async function updateRouteProgress(
  routeId: string,
  streetUpdates: Array<{ osmId: string; percentage: number; lastRunDate: string }>
): Promise<void> {
  const route = await prisma.route.findUnique({
    where: { id: routeId },
  });

  if (!route) {
    throw new RouteNotFoundError(routeId);
  }

  // Get current snapshot
  const snapshot = route.streetsSnapshot as StreetSnapshot;

  // Update streets
  for (const update of streetUpdates) {
    const street = snapshot.streets.find((s) => s.osmId === update.osmId);
    if (street) {
      // Use MAX percentage (don't decrease)
      if (update.percentage > street.percentage) {
        street.percentage = update.percentage;
        street.lastRunDate = update.lastRunDate;
        street.completed = update.percentage >= 90;
      }
    }
  }

  // Recalculate totals
  const completedStreets = snapshot.streets.filter((s) => s.completed).length;
  const progress =
    snapshot.streets.length > 0
      ? (completedStreets / snapshot.streets.length) * 100
      : 0;

  // Save updates
  await prisma.route.update({
    where: { id: routeId },
    data: {
      streetsSnapshot: snapshot as object,
      completedStreets,
      progress,
    },
  });
}

// ============================================
// Helper Functions
// ============================================

/**
 * Build initial street snapshot from OSM streets
 */
function buildStreetSnapshot(streets: OsmStreet[]): StreetSnapshot {
  const snapshotStreets: SnapshotStreet[] = streets.map((street) => ({
    osmId: street.osmId,
    name: street.name,
    lengthMeters: Math.round(street.lengthMeters * 100) / 100,
    highwayType: street.highwayType,
    completed: false,
    percentage: 0,
    lastRunDate: null,
  }));

  return {
    streets: snapshotStreets,
    snapshotDate: new Date().toISOString(),
  };
}

/**
 * Merge old snapshot with fresh OSM data
 */
function mergeSnapshots(
  oldSnapshot: StreetSnapshot,
  freshStreets: OsmStreet[]
): { newSnapshot: StreetSnapshot; diff: SnapshotDiff } {
  const oldMap = new Map(oldSnapshot.streets.map((s) => [s.osmId, s]));
  const freshMap = new Map(freshStreets.map((s) => [s.osmId, s]));

  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];

  const newStreets: SnapshotStreet[] = [];

  // Process fresh streets
  for (const freshStreet of freshStreets) {
    const existing = oldMap.get(freshStreet.osmId);

    if (existing) {
      // Existing street - preserve progress
      unchanged.push(freshStreet.osmId);
      newStreets.push({
        ...existing,
        // Update metadata from fresh data
        name: freshStreet.name,
        lengthMeters: Math.round(freshStreet.lengthMeters * 100) / 100,
        highwayType: freshStreet.highwayType,
        isNew: false,
      });
    } else {
      // New street
      added.push(freshStreet.osmId);
      newStreets.push({
        osmId: freshStreet.osmId,
        name: freshStreet.name,
        lengthMeters: Math.round(freshStreet.lengthMeters * 100) / 100,
        highwayType: freshStreet.highwayType,
        completed: false,
        percentage: 0,
        lastRunDate: null,
        isNew: true,
      });
    }
  }

  // Find removed streets
  for (const oldStreet of oldSnapshot.streets) {
    if (!freshMap.has(oldStreet.osmId)) {
      removed.push(oldStreet.osmId);
    }
  }

  return {
    newSnapshot: {
      streets: newStreets,
      snapshotDate: new Date().toISOString(),
    },
    diff: { added, removed, unchanged },
  };
}

/**
 * Map database route to list item response
 */
function mapRouteToListItem(route: {
  id: string;
  name: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  progress: number;
  totalStreets: number;
  completedStreets: number;
  totalLengthMeters: number;
  deadline: Date | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}): RouteListItem {
  return {
    id: route.id,
    name: route.name,
    centerLat: route.centerLat,
    centerLng: route.centerLng,
    radiusMeters: route.radiusMeters,
    progress: Math.round(route.progress * 100) / 100,
    totalStreets: route.totalStreets,
    completedStreets: route.completedStreets,
    totalLengthMeters: Math.round(route.totalLengthMeters * 100) / 100,
    deadline: route.deadline?.toISOString() ?? null,
    isArchived: route.isArchived,
    createdAt: route.createdAt.toISOString(),
    updatedAt: route.updatedAt.toISOString(),
  };
}

/**
 * Group streets by highway type
 */
function groupByHighwayType(streets: OsmStreet[]): Record<string, number> {
  const groups: Record<string, number> = {};

  for (const street of streets) {
    const type = street.highwayType;
    groups[type] = (groups[type] || 0) + 1;
  }

  return groups;
}

/**
 * Generate warning messages for route preview
 */
function generatePreviewWarnings(streets: OsmStreet[]): string[] {
  const warnings: string[] = [];

  // Large area warning
  if (streets.length > ROUTES.MAX_STREETS_WARNING) {
    warnings.push(
      `Large area: ${streets.length} streets found. Consider reducing radius for a more manageable goal.`
    );
  }

  // Non-runnable roads warning
  const nonRunnable = streets.filter((s) =>
    ROUTES.NON_RUNNABLE_HIGHWAYS.includes(s.highwayType)
  );
  if (nonRunnable.length > 0) {
    warnings.push(
      `Area includes ${nonRunnable.length} major roads (motorway/trunk) that may not be runnable.`
    );
  }

  // No streets warning
  if (streets.length === 0) {
    warnings.push("No streets found in this area. Try a different location.");
  }

  return warnings;
}

/**
 * Calculate days since a date
 */
function getDaysSinceDate(date: Date): number {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// ============================================
// Custom Error Classes
// ============================================

/**
 * Error thrown when route is not found
 */
export class RouteNotFoundError extends Error {
  public routeId: string;

  constructor(routeId: string) {
    super(`Route not found: ${routeId}`);
    this.name = "RouteNotFoundError";
    this.routeId = routeId;
  }
}

/**
 * Error thrown when user doesn't have access to route
 */
export class RouteAccessDeniedError extends Error {
  public routeId: string;

  constructor(routeId: string) {
    super(`Access denied to route: ${routeId}`);
    this.name = "RouteAccessDeniedError";
    this.routeId = routeId;
  }
}
