/**
 * V2 engine handlers
 *
 * CityStrides-style node proximity: parse GPX, mark hit nodes (25m), derive street completion.
 */

import type { Request, Response } from "express";
import type { AnalyzeGpxResponse } from "./types.js";
import { parseGpx, GpxParseError } from "./modules/gpx-parser.js";
import { markHitNodes } from "./modules/node-proximity.js";
import { deriveStreetCompletion, groupStreetsByName } from "./street-completion.js";
import { getMapStreetsV2 } from "../../services/map.service.js";
import { MAP, ERROR_CODES } from "../../config/constants.js";
import prisma from "../../lib/prisma.js";

/**
 * GET /api/v1/engine-v2
 * Returns info about the v2 engine endpoint.
 */
export function getInfo(_req: Request, res: Response): void {
  res.json({
    message: "GPX Parser Test Engine - CityStrides-Style Node Proximity",
    version: "3.0.0",
    endpoints: {
      analyze: "POST /api/v1/engine-v2/analyze",
      streets: "GET /api/v1/engine-v2/streets",
      mapStreets: "GET /api/v1/engine-v2/map/streets",
    },
    description:
      "Upload a GPX file to mark nodes within 25m as hit and derive street completion (90% rule). Returns nodes hit and street list.",
  });
}

/**
 * GET /api/v1/engine-v2/streets
 * Returns the user's street list (cumulative from UserNodeHit). Requires auth.
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
 * Returns map streets with geometry and V2 (UserNodeHit) progress. Same shape as GET /map/streets.
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
 * Parses GPX, marks nodes within 25m as hit, persists to UserNodeHit, returns street completion.
 */
export async function analyzeGpx(
  req: Request,
  res: Response
): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: "No GPX file provided. Use 'gpxFile' form field.",
        code: "GPX_MISSING",
      });
      return;
    }

    const userId = req.query.userId as string | undefined;
    if (!userId) {
      res.status(400).json({
        success: false,
        error: "userId query parameter is required for node hit persistence.",
        code: "USER_ID_MISSING",
      });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({
        success: false,
        error: "User not found. Provide a valid userId (e.g. create a user first or use an existing user id).",
        code: ERROR_CODES.NOT_FOUND,
      });
      return;
    }

    const parsedGpx = parseGpx(req.file.buffer);
    const points = parsedGpx.points.map((p) => ({ lat: p.lat, lng: p.lng }));
    const { nodesHit } = await markHitNodes(userId, points);
    const streetCompletion = await deriveStreetCompletion(userId);
    const groupedStreets = groupStreetsByName(streetCompletion);

    const response: AnalyzeGpxResponse = {
      success: true,
      run: {
        name: parsedGpx.name,
        date: parsedGpx.points[0]?.time || new Date().toISOString(),
        totalPoints: parsedGpx.totalPoints,
        nodesHit,
      },
      streets: groupedStreets,
      warnings: [],
    };

    res.json(response);
  } catch (error) {
    console.error("Error analyzing GPX:", error);

    if (error instanceof GpxParseError) {
      res.status(400).json({
        success: false,
        error: error.message,
        code: "GPX_PARSE_ERROR",
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
      code: "INTERNAL_ERROR",
    });
  }
}
