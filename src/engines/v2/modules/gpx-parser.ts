/**
 * Module 1: GPX Parser (Simplified)
 *
 * Parses GPX files and extracts coordinates only.
 * No bearings, speed, or quality metrics - just coordinates.
 */

import { parseGpxBuffer, GpxParseError } from "../../../services/gpx.service.js";
import type { ParsedGpx, GpxPoint } from "../types.js";

/**
 * Parse GPX buffer and extract coordinates
 *
 * @param buffer - GPX file buffer
 * @returns ParsedGpx with coordinates and metadata
 * @throws GpxParseError if GPX is invalid
 */
export function parseGpx(buffer: Buffer): ParsedGpx {
  // Parse GPX using existing service
  const gpxData = parseGpxBuffer(buffer);

  // Convert to simple GpxPoint format (just coordinates + time)
  const points: GpxPoint[] = gpxData.points.map((point) => ({
    lat: point.lat,
    lng: point.lng,
    time: point.timestamp?.toISOString() || null,
  }));

  return {
    name: gpxData.name || null,
    points,
    totalPoints: points.length,
  };
}

// Re-export error class for convenience
export { GpxParseError };
