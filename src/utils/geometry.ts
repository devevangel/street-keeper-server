/**
 * Geometry utilities for map and GPS trace processing.
 */

import type { GpxPoint } from "../types/run.types.js";

const DEFAULT_TOLERANCE = 0.00005; // ~5m in degrees (approximate at mid-latitudes)

/**
 * Squared perpendicular distance from point (px, py) to the line through (ax, ay)-(bx, by).
 * Uses lng as x, lat as y for simplicity; acceptable for short segments.
 */
function perpendicularDistanceSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const tx = px - ax;
    const ty = py - ay;
    return tx * tx + ty * ty;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const rx = px - projX;
  const ry = py - projY;
  return rx * rx + ry * ry;
}

/**
 * Ramer-Douglas-Peucker simplification on a slice of points (by index).
 * Returns indices of points to keep (including first and last).
 */
function rdpIndices(
  points: Array<{ lng: number; lat: number }>,
  start: number,
  end: number,
  toleranceSq: number
): number[] {
  if (end <= start + 1) {
    return [start, end].filter((i) => i <= points.length - 1);
  }
  const ax = points[start].lng;
  const ay = points[start].lat;
  const bx = points[end].lng;
  const by = points[end].lat;
  let maxDistSq = 0;
  let maxIdx = start;
  for (let i = start + 1; i < end; i++) {
    const d = perpendicularDistanceSq(
      points[i].lng,
      points[i].lat,
      ax,
      ay,
      bx,
      by
    );
    if (d > maxDistSq) {
      maxDistSq = d;
      maxIdx = i;
    }
  }
  if (maxDistSq <= toleranceSq) {
    return [start, end];
  }
  const left = rdpIndices(points, start, maxIdx, toleranceSq);
  const right = rdpIndices(points, maxIdx, end, toleranceSq);
  return [...left.slice(0, -1), ...right];
}

/**
 * Simplify a sequence of GPS points using the Ramer-Douglas-Peucker algorithm.
 * Returns [lat, lng] pairs (no elevation/timestamp) for smaller payloads.
 *
 * @param points - Input GPS points (e.g. Activity.coordinates).
 * @param tolerance - Max perpendicular distance in degrees (~5m ≈ 0.00005). Default 0.00005.
 * @returns Simplified [lat, lng][] for map rendering.
 */
export function simplifyCoordinates(
  points: GpxPoint[],
  tolerance: number = DEFAULT_TOLERANCE
): [number, number][] {
  if (points.length === 0) return [];
  if (points.length <= 2) {
    return points.map((p) => [p.lat, p.lng] as [number, number]);
  }
  const arr = points.map((p) => ({ lng: p.lng, lat: p.lat }));
  const toleranceSq = tolerance * tolerance;
  const indices = rdpIndices(arr, 0, arr.length - 1, toleranceSq);
  return indices.map((i) => [arr[i].lat, arr[i].lng] as [number, number]);
}
