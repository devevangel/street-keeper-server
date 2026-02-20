/**
 * Geometry Cache Service
 * Caches street geometries to reduce Overpass API calls
 *
 * This service provides a caching layer for street geometry data retrieved
 * from OpenStreetMap via Overpass API. Key features:
 *
 * 1. **24-hour TTL**: Cached data expires after 24 hours
 * 2. **Smart key generation**: Cache keys include coordinates and radius
 * 3. **Larger radius filtering**: Can filter cached larger-radius results for smaller requests
 *
 * Cache is stored in PostgreSQL (GeometryCache table) rather than Redis
 * to simplify deployment and because street data is relatively static.
 *
 * @example
 * // Check cache before querying Overpass
 * const cacheKey = generateRadiusCacheKey(50.788, -1.089, 2000);
 * let streets = await getCachedGeometries(cacheKey);
 *
 * if (!streets) {
 *   streets = await queryStreetsInRadius(50.788, -1.089, 2000);
 *   await setCachedGeometries(cacheKey, streets);
 * }
 */

import prisma from "../lib/prisma.js";
import { GEOMETRY_CACHE, PROJECTS } from "../config/constants.js";
import type { OsmStreet } from "../types/run.types.js";

// ============================================
// Cache Key Generation
// ============================================

/**
 * Generate a cache key for radius-based queries
 *
 * Key format: "geo:radius:{lat}:{lng}:{meters}"
 * Coordinates are rounded to 4 decimal places (~11m accuracy)
 * to improve cache hit rates for nearby queries.
 *
 * @param centerLat - Center latitude
 * @param centerLng - Center longitude
 * @param radiusMeters - Search radius in meters
 * @returns Cache key string
 *
 * @example
 * const key = generateRadiusCacheKey(50.78812, -1.08934, 2000);
 * // Returns: "geo:radius:50.7881:-1.0893:2000"
 */
export function generateRadiusCacheKey(
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): string {
  // Round coordinates to configured precision
  const precision = GEOMETRY_CACHE.COORD_PRECISION;
  const lat = centerLat.toFixed(precision);
  const lng = centerLng.toFixed(precision);

  return `${GEOMETRY_CACHE.KEY_PREFIX}radius:${lat}:${lng}:${radiusMeters}`;
}

/**
 * Parse a cache key to extract its components
 *
 * @param cacheKey - Cache key string
 * @returns Parsed components or null if invalid
 */
export function parseCacheKey(
  cacheKey: string
): { type: "radius"; lat: number; lng: number; meters: number } | null {
  // Match pattern: geo:radius:{lat}:{lng}:{meters}
  const match = cacheKey.match(
    /^geo:radius:(-?\d+\.?\d*):(-?\d+\.?\d*):(\d+)$/
  );

  if (!match) return null;

  return {
    type: "radius",
    lat: parseFloat(match[1]),
    lng: parseFloat(match[2]),
    meters: parseInt(match[3], 10),
  };
}

// ============================================
// Cache Read/Write Operations
// ============================================

/**
 * Get cached geometries by cache key
 *
 * Retrieves street geometries from cache if:
 * 1. Cache entry exists
 * 2. Cache entry has not expired
 *
 * @param cacheKey - Cache key (from generateRadiusCacheKey)
 * @returns Array of OsmStreet objects, or null if not cached/expired
 *
 * @example
 * const streets = await getCachedGeometries("geo:radius:50.788:-1.089:2000");
 * if (streets) {
 *   console.log(`Cache hit: ${streets.length} streets`);
 * }
 */
export async function getCachedGeometries(
  cacheKey: string
): Promise<OsmStreet[] | null> {
  try {
    const cached = await prisma.geometryCache.findUnique({
      where: { cacheKey },
    });

    // Not in cache
    if (!cached) {
      return null;
    }

    // Check if expired
    if (new Date() > cached.expiresAt) {
      // Expired - delete and return null. Use deleteMany to avoid P2025 (record not found)
      // when another request already deleted the record (race condition).
      await prisma.geometryCache.deleteMany({
        where: { cacheKey },
      });
      console.log(`[GeometryCache] Expired cache entry deleted: ${cacheKey}`);
      return null;
    }

    // Cache hit!
    console.log(`[GeometryCache] Cache hit: ${cacheKey}`);
    return cached.geometries as unknown as OsmStreet[];
  } catch (error) {
    console.error("[GeometryCache] Error reading cache:", error);
    return null;
  }
}

/**
 * Store geometries in cache
 *
 * Stores street geometries with a 24-hour TTL.
 * Uses upsert to handle both new entries and updates.
 *
 * @param cacheKey - Cache key
 * @param geometries - Array of OsmStreet objects to cache
 *
 * @example
 * const streets = await queryStreetsInRadius(50.788, -1.089, 2000);
 * await setCachedGeometries("geo:radius:50.788:-1.089:2000", streets);
 */
export async function setCachedGeometries(
  cacheKey: string,
  geometries: OsmStreet[]
): Promise<void> {
  try {
    // Calculate expiration time
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + GEOMETRY_CACHE.TTL_HOURS);

    // Upsert: create if not exists, update if exists
    await prisma.geometryCache.upsert({
      where: { cacheKey },
      create: {
        cacheKey,
        geometries: geometries as unknown as object,
        expiresAt,
      },
      update: {
        geometries: geometries as unknown as object,
        expiresAt,
      },
    });

    console.log(
      `[GeometryCache] Cached ${geometries.length} streets: ${cacheKey}`
    );
  } catch (error) {
    // Log but don't throw - caching failures shouldn't break the app
    console.error("[GeometryCache] Error writing cache:", error);
  }
}

// ============================================
// Smart Caching (Larger Radius Filtering)
// ============================================

/**
 * Find a larger cached radius that contains the requested area
 *
 * If a user requests 2km radius but we have 5km cached for the same
 * center point, we can filter the 5km results instead of making
 * a new API call.
 *
 * @param centerLat - Center latitude
 * @param centerLng - Center longitude
 * @param radiusMeters - Requested radius
 * @returns Cached data from larger radius, or null if none found
 *
 * @example
 * // User requests 2km, but we have 5km cached
 * const larger = await findLargerCachedRadius(50.788, -1.089, 2000);
 * if (larger) {
 *   const filtered = filterStreetsToRadius(larger.streets, 50.788, -1.089, 2000);
 * }
 */
export async function findLargerCachedRadius(
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): Promise<{
  streets: OsmStreet[];
  cacheKey: string;
  cachedRadius: number;
} | null> {
  // Generate larger radii candidates (up to max, step 100)
  const largerRadii: number[] = [];
  for (
    let r = radiusMeters + PROJECTS.RADIUS_STEP;
    r <= PROJECTS.RADIUS_MAX;
    r += PROJECTS.RADIUS_STEP
  ) {
    largerRadii.push(r);
  }

  for (const largerRadius of largerRadii) {
    const cacheKey = generateRadiusCacheKey(centerLat, centerLng, largerRadius);
    const cached = await getCachedGeometries(cacheKey);

    if (cached) {
      console.log(
        `[GeometryCache] Found larger cached radius: ${largerRadius}m (requested: ${radiusMeters}m)`
      );
      return {
        streets: cached,
        cacheKey,
        cachedRadius: largerRadius,
      };
    }
  }

  return null;
}

/**
 * Filter streets to only those within a radius
 *
 * When we have cached data for a larger radius, filter it down
 * to the requested smaller radius by checking each street's
 * distance from the center point.
 *
 * A street is included if its centroid (midpoint) is within the radius.
 *
 * @param streets - Array of streets to filter
 * @param centerLat - Center latitude
 * @param centerLng - Center longitude
 * @param radiusMeters - Target radius in meters
 * @returns Filtered array of streets within radius
 */
export function filterStreetsToRadius(
  streets: OsmStreet[],
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): OsmStreet[] {
  return streets.filter((street) => {
    // Calculate street centroid (midpoint of geometry)
    const coords = street.geometry.coordinates;
    if (coords.length === 0) return false;

    // Use midpoint as representative point
    const midIndex = Math.floor(coords.length / 2);
    const [streetLng, streetLat] = coords[midIndex];

    // Calculate distance using Haversine formula
    const distance = haversineDistance(
      centerLat,
      centerLng,
      streetLat,
      streetLng
    );

    return distance <= radiusMeters;
  });
}

/**
 * Filter streets to only those entirely inside the circle (strict mode).
 * Every coordinate of the street geometry must be within radius of center.
 *
 * @param streets - Streets from Overpass/cache
 * @param centerLat - Center latitude
 * @param centerLng - Center longitude
 * @param radiusMeters - Radius in meters
 * @returns Streets with all points inside the circle
 */
export function filterStreetsToRadiusStrict(
  streets: OsmStreet[],
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): OsmStreet[] {
  return streets.filter((street) => {
    const coords = street.geometry.coordinates;
    if (coords.length === 0) return false;
    for (const [streetLng, streetLat] of coords) {
      const distance = haversineDistance(
        centerLat,
        centerLng,
        streetLat,
        streetLng
      );
      if (distance > radiusMeters) return false;
    }
    return true;
  });
}

// ============================================
// Polygon Helpers (point-in-polygon, bbox, filter)
// ============================================

/**
 * Ray-casting point-in-polygon test.
 * Polygon coordinates are [lng, lat][] (GeoJSON order).
 *
 * @param lat - Point latitude
 * @param lng - Point longitude
 * @param polygon - Closed ring of [lng, lat] pairs
 */
export function pointInPolygon(
  lat: number,
  lng: number,
  polygon: [number, number][]
): boolean {
  const n = polygon.length;
  if (n < 3) return false;

  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const lngI = xi;
    const latI = yi;
    const lngJ = xj;
    const latJ = yj;

    const intersect =
      latI > lat !== latJ > lat &&
      lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Compute centroid of a polygon (for map centering).
 * Coordinates are [lng, lat][] (GeoJSON). Uses signed area for correctness.
 */
export function polygonCentroid(
  coords: [number, number][]
): { lat: number; lng: number } {
  if (coords.length === 0) return { lat: 0, lng: 0 };
  if (coords.length === 1) return { lat: coords[0][1], lng: coords[0][0] };
  let sumLng = 0;
  let sumLat = 0;
  let area = 0;
  const n = coords.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = coords[i];
    const [xj, yj] = coords[j];
    const cross = xi * yj - xj * yi;
    area += cross;
    sumLng += (xi + xj) * cross;
    sumLat += (yi + yj) * cross;
  }
  area *= 0.5;
  if (area === 0) return { lat: coords[0][1], lng: coords[0][0] };
  return {
    lng: sumLng / (6 * area),
    lat: sumLat / (6 * area),
  };
}

/**
 * Compute axis-aligned bounding box from polygon coordinates.
 * Coordinates are [lng, lat][] (GeoJSON).
 */
export function polygonBoundingBox(
  coords: [number, number][]
): { south: number; west: number; north: number; east: number } {
  if (coords.length === 0) {
    return { south: 0, west: 0, north: 0, east: 0 };
  }
  let minLat = coords[0][1];
  let maxLat = coords[0][1];
  let minLng = coords[0][0];
  let maxLng = coords[0][0];
  for (let i = 1; i < coords.length; i++) {
    const [lng, lat] = coords[i];
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return { south: minLat, west: minLng, north: maxLat, east: maxLng };
}

/**
 * Filter streets to those whose centroid is inside the polygon (centroid mode).
 * Polygon coordinates are [lng, lat][] (GeoJSON closed ring).
 */
export function filterStreetsToPolygon(
  streets: OsmStreet[],
  polygonCoords: [number, number][]
): OsmStreet[] {
  return streets.filter((street) => {
    const coords = street.geometry.coordinates;
    if (coords.length === 0) return false;
    const midIndex = Math.floor(coords.length / 2);
    const [streetLng, streetLat] = coords[midIndex];
    return pointInPolygon(streetLat, streetLng, polygonCoords);
  });
}

/**
 * Filter streets to only those entirely inside the polygon (strict mode).
 * Every coordinate of the street must be inside the polygon.
 * Polygon coordinates are [lng, lat][] (GeoJSON closed ring).
 */
export function filterStreetsToPolygonStrict(
  streets: OsmStreet[],
  polygonCoords: [number, number][]
): OsmStreet[] {
  return streets.filter((street) => {
    const coords = street.geometry.coordinates;
    if (coords.length === 0) return false;
    for (const [streetLng, streetLat] of coords) {
      if (!pointInPolygon(streetLat, streetLng, polygonCoords)) return false;
    }
    return true;
  });
}

// ============================================
// Cache Maintenance
// ============================================

/**
 * Delete expired cache entries
 *
 * Call this periodically (e.g., daily cron job) to clean up
 * expired cache entries and keep the database tidy.
 *
 * @returns Number of entries deleted
 */
export async function cleanExpiredCache(): Promise<number> {
  try {
    const result = await prisma.geometryCache.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });

    if (result.count > 0) {
      console.log(`[GeometryCache] Cleaned ${result.count} expired entries`);
    }

    return result.count;
  } catch (error) {
    console.error("[GeometryCache] Error cleaning cache:", error);
    return 0;
  }
}

/**
 * Get cache statistics
 *
 * Returns stats about the geometry cache for monitoring.
 */
export async function getCacheStats(): Promise<{
  totalEntries: number;
  expiredEntries: number;
  totalSizeEstimate: string;
}> {
  const [total, expired] = await Promise.all([
    prisma.geometryCache.count(),
    prisma.geometryCache.count({
      where: { expiresAt: { lt: new Date() } },
    }),
  ]);

  return {
    totalEntries: total,
    expiredEntries: expired,
    // Rough estimate: ~5KB per entry average
    totalSizeEstimate: `~${Math.round((total * 5) / 1024)}MB`,
  };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Calculate distance between two points using Haversine formula
 *
 * @param lat1 - Latitude of first point
 * @param lng1 - Longitude of first point
 * @param lat2 - Latitude of second point
 * @param lng2 - Longitude of second point
 * @returns Distance in meters
 */
function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}
