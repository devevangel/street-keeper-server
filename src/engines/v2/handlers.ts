/**
 * V2 engine handlers
 *
 * Edge-based street coverage system.
 * 4-step pipeline: Parse GPX -> OSRM Match -> Resolve Ways -> Build Edges
 */

import type { Request, Response } from "express";
import type { AnalyzeGpxResponse, GroupedStreet } from "./types.js";
import { parseGpx, GpxParseError } from "./modules/gpx-parser.js";
import { matchWithOSRM } from "./modules/osrm-matcher.js";
import { resolveWays } from "./modules/way-resolver.js";
import { buildAndValidateEdges } from "./modules/edge-builder.js";
import { deriveStreetCompletion, groupStreetsByName } from "./street-completion.js";
import { persistUserEdges } from "./edge-persistence.js";
import { getMapStreetsV2 } from "../../services/map.service.js";
import { MAP } from "../../config/constants.js";

/**
 * GET /api/v1/engine-v2
 * Returns info about the v2 engine endpoint.
 */
export function getInfo(_req: Request, res: Response): void {
  res.json({
    message: "GPX Parser Test Engine - Edge-Based System",
    version: "3.0.0",
    endpoints: {
      analyze: "POST /api/v1/engine-v2/analyze",
      streets: "GET /api/v1/engine-v2/streets",
      mapStreets: "GET /api/v1/engine-v2/map/streets",
    },
    description:
      "Upload a GPX file to analyze street coverage using OSRM edge-based matching. Returns matched path, edges, and street completion status.",
  });
}

/**
 * GET /api/v1/engine-v2/streets
 * Returns the user's street list (cumulative from UserEdge). Requires auth; userId from req.user.
 */
export async function getStreets(req: Request, res: Response): Promise<void> {
  const userId = (req as Request & { user?: { id: string } }).user?.id;
  if (!userId) {
    res.status(401).json({
      success: false,
      error: "Authentication required",
      code: "AUTH_REQUIRED",
    });
    return;
  }
  try {
    const streetCompletion = await deriveStreetCompletion(userId);
    const grouped = groupStreetsByName(streetCompletion);
    res.json({ success: true, streets: grouped });
  } catch (error) {
    console.error("[engine-v2] getStreets error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
}

/**
 * GET /api/v1/engine-v2/map/streets
 * Returns map streets with geometry and V2 (UserEdge) progress. Same shape as GET /map/streets.
 * Query: lat, lng, radius (optional, default MAP default).
 */
export async function getMapStreets(
  req: Request,
  res: Response
): Promise<void> {
  const userId = (req as Request & { user?: { id: string } }).user?.id;
  if (!userId) {
    res.status(401).json({
      success: false,
      error: "Authentication required",
      code: "AUTH_REQUIRED",
    });
    return;
  }

  const latRaw = req.query.lat;
  const lngRaw = req.query.lng;
  const radiusRaw = req.query.radius;
  const lat = typeof latRaw === "string" ? parseFloat(latRaw) : Number(latRaw);
  const lng = typeof lngRaw === "string" ? parseFloat(lngRaw) : Number(lngRaw);
  const radius =
    radiusRaw !== undefined
      ? typeof radiusRaw === "string"
        ? parseInt(radiusRaw, 10)
        : Number(radiusRaw)
      : MAP.DEFAULT_RADIUS_METERS;

  if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    res.status(400).json({
      success: false,
      error: "Valid lat and lng are required",
      code: "MAP_INVALID_COORDINATES",
    });
    return;
  }

  try {
    const result = await getMapStreetsV2(userId, lat, lng, radius);
    res.json(result);
  } catch (error) {
    console.error("[engine-v2] getMapStreets error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
}

/**
 * POST /api/v1/engine-v2/analyze
 * Analyzes a GPX file and returns edge-based street coverage analysis.
 *
 * Query params:
 *   - userId: User ID (required for persistence)
 *   - debug=true: Include additional debug information
 *
 * Body:
 *   - gpxFile: GPX file (multipart/form-data)
 *
 * Response: AnalyzeGpxResponse
 */
export async function analyzeGpx(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // Check if file was uploaded
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: "No GPX file provided. Use 'gpxFile' form field.",
        code: "GPX_MISSING",
      });
      return;
    }

    // Get userId from query params (required for persistence)
    const userId = req.query.userId as string | undefined;
    if (!userId) {
      res.status(400).json({
        success: false,
        error: "userId query parameter is required for edge persistence.",
        code: "USER_ID_MISSING",
      });
      return;
    }

    const startTime = Date.now();

    // Step 1: Parse GPX
    const parsedGpx = parseGpx(req.file.buffer);

    // Step 2: OSRM Map Match
    const matchResult = await matchWithOSRM(parsedGpx.points);

    // Step 3: Resolve Ways
    const wayResult = await resolveWays(matchResult.nodes);

    // Step 4: Build and Validate Edges
    const timestamps = parsedGpx.points.map((p) => p.time);
    const edgeResult = buildAndValidateEdges(
      wayResult.resolvedEdges,
      matchResult.nodes,
      timestamps
    );

    // Step 5: Persist valid edges to UserEdge table (cumulative tracking)
    const runDate = parsedGpx.points[0]?.time
      ? new Date(parsedGpx.points[0].time)
      : new Date();
    await persistUserEdges(userId, edgeResult.validEdges, runDate);

    // Step 6: Derive street completion from ALL stored edges (cumulative progress)
    const streetCompletion = await deriveStreetCompletion(userId);

    // Group streets by name for client-friendly display
    const groupedStreets = groupStreetsByName(streetCompletion);

    // Build response
    const response: AnalyzeGpxResponse = {
      success: true,
      run: {
        name: parsedGpx.name,
        date: parsedGpx.points[0]?.time || new Date().toISOString(),
        totalPoints: parsedGpx.totalPoints,
        matchedPoints: matchResult.nodes.length,
        matchConfidence: matchResult.confidence,
        distanceMeters: Math.round(matchResult.distance * 100) / 100,
      },
      path: {
        type: "LineString",
        coordinates: matchResult.geometry.coordinates,
      },
      edges: {
        total: edgeResult.statistics.totalEdges,
        valid: edgeResult.statistics.validCount,
        rejected: edgeResult.statistics.rejectedCount,
        list: edgeResult.validEdges.map((edge) => ({
          edgeId: edge.edgeId,
          wayId: String(edge.wayId),
          wayName: edge.wayName,
          lengthMeters: Math.round(edge.lengthMeters * 100) / 100,
        })),
      },
      streets: groupedStreets,
      warnings: [
        ...matchResult.warnings,
        ...wayResult.warnings,
      ],
    };

    res.json(response);
  } catch (error) {
    console.error("Error analyzing GPX:", error);

    // Handle specific error types
    if (error instanceof GpxParseError) {
      res.status(400).json({
        success: false,
        error: error.message,
        code: "GPX_PARSE_ERROR",
      });
      return;
    }

    // Generic error
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
}

