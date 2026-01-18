/**
 * GPX Service
 * Parses GPX files and extracts GPS coordinates
 *
 * GPX (GPS Exchange Format) is an XML schema for GPS data.
 * This service converts GPX files into a structured format
 * containing GPS points with coordinates, elevation, and timestamps.
 *
 * How it works:
 * 1. Parse XML using @xmldom/xmldom
 * 2. Convert to GeoJSON using @mapbox/togeojson
 * 3. Extract coordinates and timestamps into GpxPoint array
 *
 * GPX Structure (simplified):
 * <gpx>
 *   <metadata><name>Run Name</name></metadata>
 *   <trk>
 *     <name>Track Name</name>
 *     <trkseg>
 *       <trkpt lat="50.79" lon="-1.09">
 *         <ele>25.5</ele>
 *         <time>2026-01-17T08:00:00Z</time>
 *       </trkpt>
 *       ...more points...
 *     </trkseg>
 *   </trk>
 * </gpx>
 */

import { DOMParser } from "@xmldom/xmldom";
import * as toGeoJSON from "@tmcw/togeojson";
import type { ParsedGpxData, GpxPoint } from "../types/run.types.js";
import { GPX_UPLOAD } from "../config/constants.js";

// ============================================
// Main Parse Function
// ============================================

/**
 * Parse GPX content from a Buffer into structured GPS data
 *
 * This is the main entry point for GPX parsing.
 * Takes a file buffer (from Multer upload) and returns
 * parsed GPS points with metadata.
 *
 * @param buffer - Raw GPX file content as Buffer
 * @returns Parsed data with points array and optional metadata
 * @throws GpxParseError if file is invalid or has no track points
 *
 * @example
 * // In route handler after Multer upload:
 * const gpxData = parseGpxBuffer(req.file.buffer);
 * console.log(gpxData.points.length);  // Number of GPS points
 * console.log(gpxData.name);           // "Morning Run"
 */
export function parseGpxBuffer(buffer: Buffer): ParsedGpxData {
  // Convert buffer to string (GPX is XML text)
  const gpxContent = buffer.toString("utf-8");

  // Step 1: Parse XML string into DOM document
  const dom = new DOMParser().parseFromString(gpxContent, "text/xml");

  // Check for XML parse errors
  const parseError = dom.getElementsByTagName("parsererror")[0];
  if (parseError) {
    throw new GpxParseError("Invalid GPX file: malformed XML");
  }

  // Step 2: Convert GPX DOM to GeoJSON using Mapbox library
  // This extracts tracks/routes as GeoJSON features
  const geoJson = toGeoJSON.gpx(dom);

  // Step 3: Extract GPS points from GeoJSON
  // We also pass raw XML to extract timestamps (toGeoJSON loses some precision)
  const points = extractPointsFromGeoJson(geoJson, gpxContent);

  // Validate minimum points requirement
  if (points.length < GPX_UPLOAD.MIN_POINTS) {
    throw new GpxParseError(
      `GPX file must contain at least ${GPX_UPLOAD.MIN_POINTS} track points`
    );
  }

  // Step 4: Extract optional metadata
  const name = extractGpxName(dom);
  const { startTime, endTime } = extractTimeRange(points);

  return { points, name, startTime, endTime };
}

// ============================================
// Point Extraction
// ============================================

/**
 * Extract GPS points from GeoJSON conversion
 *
 * toGeoJSON converts GPX tracks to GeoJSON LineString or MultiLineString.
 * This function extracts individual coordinates as GpxPoint objects.
 *
 * GeoJSON coordinate order is [longitude, latitude, elevation?]
 * which we convert to our GpxPoint format.
 *
 * @param geoJson - GeoJSON FeatureCollection from toGeoJSON
 * @param rawXml - Original XML string (for timestamp extraction)
 * @returns Array of GPS points
 * @throws GpxParseError if no tracks found
 */
function extractPointsFromGeoJson(geoJson: any, rawXml: string): GpxPoint[] {
  const points: GpxPoint[] = [];

  // toGeoJSON returns a FeatureCollection with features array
  if (!geoJson.features || geoJson.features.length === 0) {
    throw new GpxParseError("No tracks found in GPX file");
  }

  // Extract timestamps separately from raw XML
  // toGeoJSON doesn't preserve timestamps in coordTimes consistently
  const timestamps = extractTimestampsFromXml(rawXml);
  let timestampIndex = 0;

  // Process each feature (track or route)
  for (const feature of geoJson.features) {
    // Single track segment: LineString
    if (feature.geometry?.type === "LineString") {
      for (const coord of feature.geometry.coordinates) {
        const point: GpxPoint = {
          lng: coord[0], // GeoJSON: [lng, lat, elevation?]
          lat: coord[1],
          elevation: coord[2], // May be undefined
          timestamp: timestamps[timestampIndex],
        };
        points.push(point);
        timestampIndex++;
      }
    }
    // Multiple track segments: MultiLineString
    else if (feature.geometry?.type === "MultiLineString") {
      for (const line of feature.geometry.coordinates) {
        for (const coord of line) {
          const point: GpxPoint = {
            lng: coord[0],
            lat: coord[1],
            elevation: coord[2],
            timestamp: timestamps[timestampIndex],
          };
          points.push(point);
          timestampIndex++;
        }
      }
    }
  }

  return points;
}

// ============================================
// Timestamp Extraction
// ============================================

/**
 * Extract timestamps from raw GPX XML
 *
 * We extract timestamps directly from XML because toGeoJSON
 * doesn't always preserve them correctly. This regex approach
 * finds all <time> elements in document order.
 *
 * @param xml - Raw GPX XML string
 * @returns Array of Date objects (or undefined for missing timestamps)
 *
 * @example
 * // GPX content: <time>2026-01-17T08:00:00Z</time>
 * const timestamps = extractTimestampsFromXml(gpxContent);
 * // Returns: [Date("2026-01-17T08:00:00Z"), ...]
 */
function extractTimestampsFromXml(xml: string): (Date | undefined)[] {
  const timestamps: (Date | undefined)[] = [];

  // Match all <time>...</time> elements
  const timeRegex = /<time>([^<]+)<\/time>/g;
  let match;

  while ((match = timeRegex.exec(xml)) !== null) {
    try {
      // Parse ISO 8601 timestamp (e.g., "2026-01-17T08:00:00Z")
      timestamps.push(new Date(match[1]));
    } catch {
      // Invalid date format - skip this timestamp
      timestamps.push(undefined);
    }
  }

  return timestamps;
}

// ============================================
// Metadata Extraction
// ============================================

/**
 * Extract GPX track/route name from metadata
 *
 * GPX files can have names in multiple places:
 * 1. Inside <trk><name>...</name></trk> (track name)
 * 2. Inside <metadata><name>...</name></metadata> (file name)
 *
 * We prefer track name over metadata name.
 *
 * @param dom - Parsed XML DOM document
 * @returns Track/file name, or undefined if not present
 */
function extractGpxName(dom: Document): string | undefined {
  // Try to get name from inside <trk> element first
  const trkElement = dom.getElementsByTagName("trk")[0];
  if (trkElement) {
    const trkNameElement = trkElement.getElementsByTagName("name")[0];
    if (trkNameElement?.textContent) {
      return trkNameElement.textContent;
    }
  }

  // Fallback: try to get name from <metadata> element
  const metadataElement = dom.getElementsByTagName("metadata")[0];
  if (metadataElement) {
    const metaNameElement = metadataElement.getElementsByTagName("name")[0];
    if (metaNameElement?.textContent) {
      return metaNameElement.textContent;
    }
  }

  return undefined;
}

/**
 * Get start and end times from points array
 *
 * Finds the first and last points that have timestamps.
 * Used to determine when the run started and ended.
 *
 * @param points - Array of GPS points (some may have timestamps)
 * @returns Object with startTime and endTime (may be undefined)
 */
function extractTimeRange(points: GpxPoint[]): {
  startTime?: Date;
  endTime?: Date;
} {
  // Filter to only points with timestamps
  const pointsWithTime = points.filter((p) => p.timestamp);

  if (pointsWithTime.length === 0) {
    return { startTime: undefined, endTime: undefined };
  }

  return {
    startTime: pointsWithTime[0].timestamp,
    endTime: pointsWithTime[pointsWithTime.length - 1].timestamp,
  };
}

// ============================================
// Custom Error Class
// ============================================

/**
 * Custom error class for GPX parsing errors
 *
 * Thrown when:
 * - XML is malformed
 * - No tracks found in file
 * - Too few track points
 *
 * Caught in route handler to return appropriate error response.
 *
 * @example
 * try {
 *   const data = parseGpxBuffer(buffer);
 * } catch (error) {
 *   if (error instanceof GpxParseError) {
 *     // Handle GPX-specific error
 *     res.status(400).json({ error: error.message });
 *   }
 * }
 */
export class GpxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GpxParseError";
  }
}
