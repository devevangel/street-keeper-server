/**
 * City Sync Service (CityStrides Model)
 *
 * On-demand sync of OpenStreetMap street data per city. When a user creates
 * a project, we detect the city from their center point (Overpass is_in),
 * check if that city is already synced, and if not query Overpass for all
 * streets in the city boundary and populate NodeCache, WayNode, WayTotalEdges.
 * Subsequent projects in the same city reuse the cached data.
 */

import axios from "axios";
import prisma from "../lib/prisma.js";
import { OVERPASS } from "../config/constants.js";
import { CITY_SYNC } from "../config/constants.js";
import type { OverpassElement, OverpassResponse } from "../types/run.types.js";
import { OverpassError } from "./overpass.service.js";
import { throttledOverpassQuery } from "./overpass-throttle.service.js";

const OSM_AREA_OFFSET = 3_600_000_000; // area ID = relation_id + this for relations

export interface DetectedCity {
  relationId: bigint;
  name: string;
  adminLevel: number;
}

export interface CitySyncRecord {
  id: string;
  relationId: bigint;
  name: string;
  adminLevel: number;
  nodeCount: number;
  wayCount: number;
  syncedAt: Date;
  expiresAt: Date;
}

const BATCH_SIZE = 2000;
const CITY_QUERY_TIMEOUT_SECONDS = 900;

/**
 * Run a raw Overpass query and return the raw JSON response.
 */
async function executeRawOverpassQuery(
  query: string,
): Promise<OverpassResponse> {
  const servers = [OVERPASS.API_URL, ...OVERPASS.FALLBACK_URLS];
  const errors: string[] = [];

  for (let si = 0; si < servers.length; si++) {
    const serverUrl = servers[si];
    const isLastServer = si === servers.length - 1;

    for (let attempt = 0; attempt < OVERPASS.MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise((r) => setTimeout(r, delayMs));
        }

        const response = await axios.post<OverpassResponse>(serverUrl, query, {
          headers: { "Content-Type": "text/plain" },
          timeout: OVERPASS.TIMEOUT_MS,
        });

        if (!response.data || !Array.isArray(response.data.elements)) {
          throw new Error("Invalid Overpass response: missing elements");
        }
        return response.data;
      } catch (error: unknown) {
        const msg =
          axios.isAxiosError(error)
            ? `${error.response?.status ?? "network"} ${error.message}`
            : String(error);
        errors.push(msg);

        const status = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
        if (status === 429) {
          await new Promise((r) => setTimeout(r, 60000));
          continue;
        }

        if (attempt === OVERPASS.MAX_RETRIES - 1 && isLastServer) {
          throw new OverpassError(
            `Overpass failed: ${errors.join("; ")}`,
          );
        }
      }
    }
  }

  throw new OverpassError(`Overpass failed: ${errors.join("; ")}`);
}

/**
 * Detect which OSM city (administrative boundary) contains the given point.
 * Uses Overpass is_in query. Prefers admin_level 8 (city), then 6–10.
 */
export async function detectCity(
  lat: number,
  lng: number,
): Promise<DetectedCity | null> {
  const query = `
[out:json][timeout:15];
is_in(${lat}, ${lng})->.a;
area.a["boundary"="administrative"];
out tags;
`;
  const data = await throttledOverpassQuery(() =>
    executeRawOverpassQuery(query),
  );

  if (!data.elements || data.elements.length === 0) {
    return null;
  }

  // Areas have type "area" and id = OSM_AREA_OFFSET + relation_id for relations
  type AreaLike = { type?: string; id?: number; tags?: Record<string, string> };
  const areas = (data.elements as unknown as AreaLike[]).filter(
    (el) => el.type === "area" && el.id != null && el.tags,
  );

  if (areas.length === 0) {
    return null;
  }

  // Prefer admin_level 8 (city), then 6, 7, 9, 10
  const preferredLevels = [8, 6, 7, 9, 10];
  for (const level of preferredLevels) {
    const area = areas.find(
      (a) => a.tags && String(a.tags.admin_level) === String(level),
    );
    if (area && area.id != null && area.tags?.name) {
      const relationId = BigInt(area.id - OSM_AREA_OFFSET);
      if (relationId <= 0) continue; // invalid
      return {
        relationId,
        name: area.tags.name,
        adminLevel: level,
      };
    }
  }

  // Fallback: first area with a name
  const first = areas.find((a) => a.tags?.name && a.id != null);
  if (first && first.id != null && first.tags?.name) {
    const relationId = BigInt(first.id - OSM_AREA_OFFSET);
    if (relationId > 0) {
      return {
        relationId,
        name: first.tags.name,
        adminLevel: Number(first.tags.admin_level ?? 8),
      };
    }
  }

  return null;
}

/**
 * Sync one city from Overpass: query all streets in the city boundary,
 * then upsert NodeCache, WayNode, WayTotalEdges, and record CitySync.
 * @param relationId - OSM relation ID of the city boundary
 * @param options - Optional name and adminLevel from detectCity
 */
export async function syncCity(
  relationId: bigint,
  options?: { name?: string; adminLevel?: number },
): Promise<CitySyncRecord> {
  const areaId = Number(relationId) + OSM_AREA_OFFSET;

  // CityStrides-style query: named ways, pedestrian-accessible, exclude motorways etc.
  const query = `
[out:json][timeout:${CITY_QUERY_TIMEOUT_SECONDS}];
area(${areaId})->.a;
(
  way(area.a)["name"]["highway"]
  ["highway"!~"path"]["highway"!~"steps"]
  ["highway"!~"motorway"]["highway"!~"motorway_link"]
  ["highway"!~"raceway"]["highway"!~"bridleway"]
  ["highway"!~"proposed"]["highway"!~"construction"]
  ["highway"!~"elevator"]["highway"!~"bus_guideway"]
  ["highway"!~"footway"]["highway"!~"cycleway"]
  ["foot"!~"no"]
  ["access"!~"private"]["access"!~"no"];
);
(._;>;);
out;
`;

  const data = await throttledOverpassQuery(() =>
    executeRawOverpassQuery(query),
  );

  const elements = data.elements as OverpassElement[];
  const ways = elements.filter((el) => el.type === "way" && el.nodes && el.nodes.length >= 2);
  const nodes = elements.filter((el) => el.type === "node" && el.lat != null && el.lon != null);

  const nodeMap = new Map<number, { lat: number; lon: number }>();
  for (const n of nodes) {
    if (n.id != null && n.lat != null && n.lon != null) {
      nodeMap.set(n.id, { lat: n.lat, lon: n.lon });
    }
  }

  // Upsert NodeCache
  const nodeEntries = [...nodeMap.entries()];
  for (let i = 0; i < nodeEntries.length; i += BATCH_SIZE) {
    const batch = nodeEntries.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map(([nodeId, coords]) =>
        prisma.nodeCache.upsert({
          where: { nodeId: BigInt(nodeId) },
          create: {
            nodeId: BigInt(nodeId),
            lat: coords.lat,
            lon: coords.lon,
          },
          update: { lat: coords.lat, lon: coords.lon },
        })
    )
  );
  }

  // Build WayNode and WayTotalEdges from ways
  const wayTotalRows: { wayId: number; totalNodes: number; name: string | null; highwayType: string }[] = [];
  const wayNodeRows: { wayId: bigint; nodeId: bigint }[] = [];

  for (const w of ways) {
    if (!w.nodes || w.nodes.length < 2 || w.id == null) continue;
    const wayId = w.id;
    const totalNodes = w.nodes.length;
    const name = w.tags?.name ?? null;
    const highwayType = w.tags?.highway ?? "unknown";
    wayTotalRows.push({ wayId, totalNodes, name, highwayType });
    for (const nid of w.nodes) {
      wayNodeRows.push({ wayId: BigInt(wayId), nodeId: BigInt(nid) });
    }
  }

  // Upsert WayTotalEdges
  for (let i = 0; i < wayTotalRows.length; i += BATCH_SIZE) {
    const batch = wayTotalRows.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map((row) =>
        prisma.wayTotalEdges.upsert({
          where: { wayId: BigInt(row.wayId) },
          create: {
            wayId: BigInt(row.wayId),
            totalEdges: row.totalNodes - 1,
            totalNodes: row.totalNodes,
            name: row.name,
            highwayType: row.highwayType,
          },
          update: {
            totalNodes: row.totalNodes,
            totalEdges: row.totalNodes - 1,
            name: row.name,
            highwayType: row.highwayType,
          },
        })
    )
  );
  }

  // Upsert WayNode (ignore conflicts for duplicate way-node pairs)
  for (let i = 0; i < wayNodeRows.length; i += BATCH_SIZE) {
    const batch = wayNodeRows.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map((row) =>
        prisma.wayNode.upsert({
          where: {
            wayId_nodeId: { wayId: row.wayId, nodeId: row.nodeId },
          },
          create: row,
          update: {},
        })
    )
  );
  }

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + CITY_SYNC.EXPIRY_DAYS);

  const name =
    options?.name ?? (ways[0]?.tags?.name as string | undefined) ?? `City ${relationId}`;
  const adminLevel = options?.adminLevel ?? 8;
  const record = await prisma.citySync.upsert({
    where: { relationId },
    create: {
      relationId,
      name,
      adminLevel,
      nodeCount: nodeMap.size,
      wayCount: ways.length,
      syncedAt: now,
      expiresAt,
    },
    update: {
      syncedAt: now,
      expiresAt,
      nodeCount: nodeMap.size,
      wayCount: ways.length,
    },
  });

  console.log(
    `[CitySync] Synced city relationId=${relationId} nodes=${nodeMap.size} ways=${ways.length}`,
  );

  return {
    id: record.id,
    relationId: record.relationId,
    name: record.name,
    adminLevel: record.adminLevel,
    nodeCount: record.nodeCount,
    wayCount: record.wayCount,
    syncedAt: record.syncedAt,
    expiresAt: record.expiresAt,
  };
}

/**
 * In-memory lock to prevent concurrent syncs for the same city.
 * Maps relationId -> Promise that resolves when sync completes.
 * For multi-server deployments, replace with Redis or DB advisory locks.
 */
const syncInProgress = new Map<string, Promise<CitySyncRecord | null>>();

/**
 * Ensure the city containing (lat, lng) is synced. If not (or expired),
 * detect city and run sync. No-op if already synced and not expired.
 * Uses in-memory lock to prevent duplicate Overpass calls for the same city.
 */
export async function ensureCitySynced(
  lat: number,
  lng: number,
): Promise<CitySyncRecord | null> {
  const city = await detectCity(lat, lng);
  if (!city) {
    return null;
  }

  const lockKey = city.relationId.toString();

  // If a sync for this city is already in progress, wait for it
  const inProgress = syncInProgress.get(lockKey);
  if (inProgress) {
    return inProgress;
  }

  // Check if already synced (not expired)
  const existing = await prisma.citySync.findUnique({
    where: { relationId: city.relationId },
  });

  if (existing && existing.expiresAt > new Date()) {
    return {
      id: existing.id,
      relationId: existing.relationId,
      name: existing.name,
      adminLevel: existing.adminLevel,
      nodeCount: existing.nodeCount,
      wayCount: existing.wayCount,
      syncedAt: existing.syncedAt,
      expiresAt: existing.expiresAt,
    };
  }

  // Start sync and store the promise so concurrent calls wait for it
  const syncPromise = syncCity(city.relationId, {
    name: city.name,
    adminLevel: city.adminLevel,
  }).finally(() => {
    syncInProgress.delete(lockKey);
  });

  syncInProgress.set(lockKey, syncPromise);
  return syncPromise;
}
