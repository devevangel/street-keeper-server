/**
 * Geometry helpers for project boundaries: cache keys, radius/polygon filters,
 * and Turf-based predicates. Street geometries are loaded from PostGIS (WayTotalEdges).
 */

import * as turf from "@turf/turf";
import { GEOMETRY_CACHE } from "../config/constants.js";
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

/**
 * Filter streets to those that intersect the circle (any part within radius).
 * Uses Turf pointToLineDistance for exact geodesic distance. Skips degenerate streets (< 2 coords).
 */
export function filterStreetsToRadiusIntersects(
  streets: OsmStreet[],
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): OsmStreet[] {
  const center = turf.point([centerLng, centerLat]);
  const metersPerDegLat = 111_000;
  const metersPerDegLng = 111_000 * Math.cos((centerLat * Math.PI) / 180);
  const deltaLat = radiusMeters / metersPerDegLat;
  const deltaLng = radiusMeters / metersPerDegLng;
  const circleSouth = centerLat - deltaLat;
  const circleNorth = centerLat + deltaLat;
  const circleWest = centerLng - deltaLng;
  const circleEast = centerLng + deltaLng;

  return streets.filter((street) => {
    const coords = street.geometry.coordinates;
    if (coords.length < 2) {
      console.warn(
        "[GeometryCache] Skipping street with < 2 coordinates (degenerate):",
        street.osmId ?? street.name
      );
      return false;
    }
    const streetBbox = polygonBoundingBox(coords);
    if (
      streetBbox.east < circleWest ||
      streetBbox.west > circleEast ||
      streetBbox.north < circleSouth ||
      streetBbox.south > circleNorth
    ) {
      return false;
    }
    const line = turf.lineString(coords);
    const distMeters = turf.pointToLineDistance(center, line, {
      units: "meters",
    });
    return distMeters <= radiusMeters;
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

/**
 * Filter streets to those that intersect the polygon (any part touches or crosses).
 * Uses Turf booleanIntersects with bbox pre-filter. Skips degenerate streets (< 2 coords).
 * Polygon coordinates are [lng, lat][] (GeoJSON closed ring).
 */
export function filterStreetsToPolygonIntersects(
  streets: OsmStreet[],
  polygonCoords: [number, number][]
): OsmStreet[] {
  if (polygonCoords.length < 3) return [];

  const ring =
    polygonCoords.length > 0 &&
    (polygonCoords[0][0] !== polygonCoords[polygonCoords.length - 1][0] ||
      polygonCoords[0][1] !== polygonCoords[polygonCoords.length - 1][1])
      ? [...polygonCoords, polygonCoords[0]]
      : polygonCoords;

  const poly = turf.polygon([ring]);
  const polyBbox = polygonBoundingBox(ring);

  return streets.filter((street) => {
    const coords = street.geometry.coordinates;
    if (coords.length < 2) {
      console.warn(
        "[GeometryCache] Skipping street with < 2 coordinates (degenerate):",
        street.osmId ?? street.name
      );
      return false;
    }
    const streetBbox = polygonBoundingBox(coords);
    if (
      streetBbox.east < polyBbox.west ||
      streetBbox.west > polyBbox.east ||
      streetBbox.north < polyBbox.south ||
      streetBbox.south > polyBbox.north
    ) {
      return false;
    }
    const line = turf.lineString(coords);
    return turf.booleanIntersects(line, poly);
  });
}

// ============================================
// Filter Resolvers (single place to map boundaryMode to filter function)
// ============================================

export function resolveRadiusFilter(boundaryMode: string): typeof filterStreetsToRadius {
  if (boundaryMode === "strict") return filterStreetsToRadiusStrict;
  if (boundaryMode === "centroid") return filterStreetsToRadius;
  return filterStreetsToRadiusIntersects;
}

export function resolvePolygonFilter(
  boundaryMode: string
): typeof filterStreetsToPolygon {
  if (boundaryMode === "strict") return filterStreetsToPolygonStrict;
  if (boundaryMode === "centroid") return filterStreetsToPolygon;
  return filterStreetsToPolygonIntersects;
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
