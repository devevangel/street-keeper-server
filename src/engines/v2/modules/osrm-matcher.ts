/**
 * Module 2: OSRM Matcher
 *
 * Calls OSRM Map Matching API to snap GPS points to road network.
 * Returns matched geometry (for frontend) and OSM node IDs (source of truth).
 * Handles chunking for large GPX files (OSRM limit: 50 coordinates per request).
 */

import type { GpxPoint } from "../types.js";
import type { OsrmMatchResult } from "../types.js";
import { PARSER_CONFIG } from "../config.js";

/**
 * Match GPS points to OSM road network using OSRM
 *
 * @param points - Array of GPS coordinates
 * @returns Matched path with geometry and OSM node IDs
 */
export async function matchWithOSRM(
  points: GpxPoint[]
): Promise<OsrmMatchResult> {
  if (points.length === 0) {
    throw new Error("No GPS points provided");
  }

  // OSRM limit per request (see config)
  const maxCoords = PARSER_CONFIG.osrm.maxCoordinates;

  if (points.length <= maxCoords) {
    // Single request - no chunking needed
    return await matchChunk(points, 0);
  }

  // Multiple chunks needed - overlap by 1 point to ensure continuity
  const chunks: GpxPoint[][] = [];
  for (let i = 0; i < points.length; i += maxCoords - 1) {
    const chunk = points.slice(i, i + maxCoords);
    chunks.push(chunk);

    // If this is the last chunk, we're done
    if (i + maxCoords >= points.length) {
      break;
    }
  }

  // Merge small final chunks (< 5 points) with previous chunk to avoid NoSegment errors
  if (chunks.length > 1 && chunks[chunks.length - 1].length < 5) {
    const lastChunk = chunks.pop()!;
    chunks[chunks.length - 1] = [...chunks[chunks.length - 1], ...lastChunk];
    console.log(`[OSRM] Merged small final chunk (${lastChunk.length} points) with previous chunk`);
  }

  console.log(`[OSRM] Splitting ${points.length} points into ${chunks.length} chunks`);

  // Match each chunk sequentially (to respect rate limits)
  const chunkResults: OsrmMatchResult[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(`[OSRM] Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} points)`);
    try {
      const result = await matchChunk(chunks[i], i);
      chunkResults.push(result);
    } catch (error) {
      // All errors non-fatal: log warning and continue (production-ready for Strava sync)
      const errorMessage = error instanceof Error ? error.message : String(error);
      const warning = `Chunk ${i + 1}/${chunks.length} (${chunks[i].length} points) failed: ${errorMessage}. Skipping this chunk.`;
      console.warn(`[OSRM] ${warning}`);
      warnings.push(warning);
      chunkResults.push({
        confidence: 0,
        geometry: { type: "LineString", coordinates: [] },
        nodes: [],
        distance: 0,
        duration: 0,
      });
    }

    // Small delay between requests to respect rate limits
    if (i < chunks.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1100)); // 1.1s delay
    }
  }

  // Merge results
  const merged = mergeChunkResults(chunkResults);
  merged.warnings.push(...warnings);
  return merged;
}

/**
 * Match a single chunk of coordinates
 */
async function matchChunk(
  points: GpxPoint[],
  chunkIndex: number
): Promise<OsrmMatchResult> {
  // Build coordinate string for OSRM API
  // Format: lon1,lat1;lon2,lat2;lon3,lat3
  const coordinates = points
    .map((p) => `${p.lng},${p.lat}`)
    .join(";");

  // Build OSRM API URL
  const url = `${PARSER_CONFIG.osrm.baseUrl}/match/v1/${PARSER_CONFIG.osrm.profile}/${coordinates}?annotations=nodes&geometries=geojson&overview=full`;

  // Call OSRM API
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    PARSER_CONFIG.osrm.timeout
  );

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "street-keeper/1.0",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 414) {
        throw new Error(
          `OSRM request too large. Chunk ${chunkIndex} has ${points.length} points (max: ${PARSER_CONFIG.osrm.maxCoordinates}).`
        );
      }
      if (response.status === 429) {
        throw new Error("OSRM rate limit exceeded. Please try again later.");
      }
      const errorText = await response.text();
      let errorMessage = `OSRM API error: ${response.status} ${errorText}`;

      // Enhanced diagnostics for NoSegment errors
      if (errorText.includes("NoSegment")) {
        const firstPoint = points[0];
        const lastPoint = points[points.length - 1];
        const bounds = {
          minLat: Math.min(...points.map((p) => p.lat)),
          maxLat: Math.max(...points.map((p) => p.lat)),
          minLng: Math.min(...points.map((p) => p.lng)),
          maxLng: Math.max(...points.map((p) => p.lng)),
        };
        errorMessage =
          `OSRM NoSegment error for chunk ${chunkIndex} (${points.length} points). ` +
          `Bounds: [${bounds.minLat.toFixed(6)}, ${bounds.minLng.toFixed(6)}] to [${bounds.maxLat.toFixed(6)}, ${bounds.maxLng.toFixed(6)}]. ` +
          `First: [${firstPoint.lat.toFixed(6)}, ${firstPoint.lng.toFixed(6)}], ` +
          `Last: [${lastPoint.lat.toFixed(6)}, ${lastPoint.lng.toFixed(6)}]. ` +
          `OSRM URL: ${PARSER_CONFIG.osrm.baseUrl}`;
      }

      // Enhanced diagnostics for TooBig errors
      if (
        errorText.includes("TooBig") ||
        errorText.includes("Too many trace coordinates")
      ) {
        errorMessage =
          `OSRM TooBig error for chunk ${chunkIndex} (${points.length} points, max allowed: ${PARSER_CONFIG.osrm.maxCoordinates}). ` +
          `The chunk is too large for OSRM to process. Consider reducing maxCoordinates in config. ` +
          `OSRM URL: ${PARSER_CONFIG.osrm.baseUrl}`;
      }

      throw new Error(errorMessage);
    }

    const data = await response.json();

    // Parse OSRM response
    if (!data.matchings || data.matchings.length === 0) {
      throw new Error(`OSRM returned no matchings for chunk ${chunkIndex}`);
    }

    const matching = data.matchings[0];

    // Extract node IDs from legs
    const nodes: bigint[] = [];
    if (matching.legs && Array.isArray(matching.legs)) {
      for (const leg of matching.legs) {
        if (leg.annotation?.nodes && Array.isArray(leg.annotation.nodes)) {
          for (const nodeId of leg.annotation.nodes) {
            nodes.push(BigInt(nodeId));
          }
        }
      }
    }

    // Extract geometry
    const geometry = matching.geometry || {
      type: "LineString",
      coordinates: [],
    };

    // Calculate distance and duration
    const distance = matching.distance || 0;
    const duration = matching.duration || 0;

    // Confidence (UX only - never blocks edges)
    const confidence = matching.confidence || 0;

    return {
      confidence,
      geometry: {
        type: geometry.type === "LineString" ? "LineString" : "LineString",
        coordinates: geometry.coordinates || [],
      },
      nodes,
      distance,
      duration,
      warnings: [],
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`OSRM API timeout after ${PARSER_CONFIG.osrm.timeout}ms`);
    }
    throw error;
  }
}

/**
 * Merge multiple chunk results into a single result
 */
function mergeChunkResults(
  chunkResults: OsrmMatchResult[]
): OsrmMatchResult {
  if (chunkResults.length === 0) {
    throw new Error("No chunk results to merge");
  }

  if (chunkResults.length === 1) {
    return chunkResults[0];
  }

  // Merge nodes (remove duplicates at chunk boundaries)
  const mergedNodes: bigint[] = [];
  for (let i = 0; i < chunkResults.length; i++) {
    const chunkNodes = chunkResults[i].nodes;

    if (i === 0) {
      mergedNodes.push(...chunkNodes);
    } else {
      mergedNodes.push(...chunkNodes.slice(1));
    }
  }

  // Merge geometry coordinates (remove duplicates at chunk boundaries)
  const mergedCoordinates: [number, number][] = [];
  for (let i = 0; i < chunkResults.length; i++) {
    const chunkCoords = chunkResults[i].geometry.coordinates;

    if (i === 0) {
      mergedCoordinates.push(...chunkCoords);
    } else {
      mergedCoordinates.push(...chunkCoords.slice(1));
    }
  }

  const totalDistance = chunkResults.reduce(
    (sum, chunk) => sum + chunk.distance,
    0
  );
  const totalDuration = chunkResults.reduce(
    (sum, chunk) => sum + chunk.duration,
    0
  );
  const avgConfidence =
    chunkResults.reduce((sum, chunk) => sum + chunk.confidence, 0) /
    chunkResults.length;
  const allWarnings = chunkResults.flatMap((chunk) => chunk.warnings);
  if (avgConfidence < 0.5) {
    allWarnings.push(
      `Low match confidence (${avgConfidence.toFixed(2)}) - some edges may be missing`
    );
  }

  console.log(
    `[OSRM] Merged ${chunkResults.length} chunks: ${mergedNodes.length} nodes, ${mergedCoordinates.length} coordinates`
  );

  return {
    confidence: avgConfidence,
    geometry: {
      type: "LineString",
      coordinates: mergedCoordinates,
    },
    nodes: mergedNodes,
    distance: totalDistance,
    duration: totalDuration,
    warnings: allWarnings,
  };
}
