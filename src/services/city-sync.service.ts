/**
 * City Sync Service (CityStrides Model)
 *
 * On-demand sync of OpenStreetMap street data per city. When a user creates
 * a project, we detect the city from their center point (Overpass is_in),
 * check if that city is already synced, and if not query Overpass for all
 * streets in the city boundary and populate NodeCache, WayNode, WayTotalEdges.
 * Subsequent projects in the same city reuse the cached data.
 */

import * as turf from "@turf/turf";
import { Prisma } from "../generated/prisma/client.js";
import prisma from "../lib/prisma.js";
import { CITY_SYNC, OVERPASS } from "../config/constants.js";
import type { OverpassElement, OverpassResponse } from "../types/run.types.js";
import { executeRawOverpassQuery } from "./overpass.service.js";
import { throttledOverpassQuery } from "./overpass-throttle.service.js";
import { enqueueCitySyncJob } from "../queues/activity.queue.js";

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

const BATCH_SIZE = 500;
const CITY_QUERY_TIMEOUT_SECONDS = 900;

/** Overpass highway regex aligned with OVERPASS.HIGHWAY_TYPES + user-facing queries */
const CITY_SYNC_HIGHWAY_REGEX = OVERPASS.HIGHWAY_TYPES.join("|");

function collectAltNames(
  tags: Record<string, string | undefined> | undefined,
): string[] {
  if (!tags) return [];
  const altNames: string[] = [];
  if (tags.alt_name) altNames.push(tags.alt_name);
  if (tags["name:en"]) altNames.push(tags["name:en"]);
  if (tags.old_name) altNames.push(tags.old_name);
  if (tags.loc_name) altNames.push(tags.loc_name);
  return altNames;
}

// executeRawOverpassQuery is imported from overpass.service.ts (shared
// status-aware implementation with slot checking and server ranking).

/**
 * Short-lived in-flight cache for detectCity. Prevents 24 concurrent
 * activity processors from each firing their own Overpass is_in query
 * for the same neighbourhood. Entries auto-expire after 60s.
 */
const detectCityCache = new Map<string, { result: DetectedCity | null; expiresAt: number }>();
const detectCityInFlight = new Map<string, Promise<DetectedCity | null>>();

/**
 * Detect which OSM city (administrative boundary) contains the given point.
 * Uses Overpass is_in query. Prefers admin_level 8 (city), then 6–10.
 * Results are cached per ~1km grid cell for 60s to deduplicate concurrent calls.
 */
export async function detectCity(
  lat: number,
  lng: number,
): Promise<DetectedCity | null> {
  const key = gridKey(lat, lng);

  const cached = detectCityCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const inflight = detectCityInFlight.get(key);
  if (inflight) return inflight;

  const promise = doDetectCity(lat, lng).then((result) => {
    detectCityCache.set(key, { result, expiresAt: Date.now() + 60_000 });
    detectCityInFlight.delete(key);
    return result;
  }).catch((err) => {
    detectCityInFlight.delete(key);
    throw err;
  });
  detectCityInFlight.set(key, promise);
  return promise;
}

async function doDetectCity(
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
    executeRawOverpassQuery(query, {
      caller: "detect-city",
      maxWaitSeconds: OVERPASS.CITY_SYNC_MAX_SLOT_WAIT_SECONDS,
    }),
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

  // Align with OVERPASS.HIGHWAY_TYPES; include unnamed segments (map parity).
  const query = `
[out:json][timeout:${CITY_QUERY_TIMEOUT_SECONDS}];
area(${areaId})->.a;
(
  way(area.a)["highway"~"^(${CITY_SYNC_HIGHWAY_REGEX})$"]
  ["highway"!~"motorway|motorway_link|trunk|trunk_link|raceway|bridleway|proposed|construction|elevator|bus_guideway"]
  ["foot"!~"no"]
  ["access"!~"private"]["access"!~"no"];
);
(._;>;);
out;
`;

  const data = await throttledOverpassQuery(() =>
    executeRawOverpassQuery(query, {
      maxWaitSeconds: OVERPASS.CITY_SYNC_MAX_SLOT_WAIT_SECONDS,
      caller: "city-sync",
    }),
  );

  const elements = data.elements as OverpassElement[];
  const ways = elements.filter(
    (el) => el.type === "way" && el.nodes && el.nodes.length >= 2,
  );
  const nodes = elements.filter(
    (el) => el.type === "node" && el.lat != null && el.lon != null,
  );

  const nodeMap = new Map<number, { lat: number; lon: number }>();
  for (const n of nodes) {
    if (n.id != null && n.lat != null && n.lon != null) {
      nodeMap.set(n.id, { lat: n.lat, lon: n.lon });
    }
  }

  // Upsert NodeCache using raw SQL for performance over remote DB
  const nodeEntries = [...nodeMap.entries()];
  for (let i = 0; i < nodeEntries.length; i += BATCH_SIZE) {
    const batch = nodeEntries.slice(i, i + BATCH_SIZE);
    const values = batch.map(
      ([nodeId, coords]) =>
        Prisma.sql`(${BigInt(nodeId)}, ${coords.lat}, ${coords.lon}, ST_SetSRID(ST_MakePoint(${coords.lon}, ${coords.lat}), 4326))`,
    );
    await prisma.$executeRaw`
      INSERT INTO "NodeCache" ("nodeId", "lat", "lon", "geom")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("nodeId") DO UPDATE SET
        "lat" = EXCLUDED."lat",
        "lon" = EXCLUDED."lon",
        "geom" = EXCLUDED."geom"
    `;
  }

  // Build WayNode and WayTotalEdges from ways
  const wayTotalRows: {
    wayId: number;
    totalNodes: number;
    name: string | null;
    highwayType: string;
  }[] = [];
  const wayNodeRows: { wayId: bigint; nodeId: bigint; sequence: number }[] =
    [];

  const seenWayIds = new Set<number>();
  const seenWayNode = new Set<string>();

  for (const w of ways) {
    if (!w.nodes || w.nodes.length < 2 || w.id == null) continue;
    const wayId = w.id;

    if (!seenWayIds.has(wayId)) {
      seenWayIds.add(wayId);
      const totalNodes = w.nodes.length;
      const name = w.tags?.name ?? null;
      const highwayType = w.tags?.highway ?? "unknown";
      wayTotalRows.push({ wayId, totalNodes, name, highwayType });
    }

    for (let idx = 0; idx < w.nodes.length; idx++) {
      const nid = w.nodes[idx];
      const key = `${wayId}:${nid}`;
      if (seenWayNode.has(key)) continue;
      seenWayNode.add(key);
      wayNodeRows.push({
        wayId: BigInt(wayId),
        nodeId: BigInt(nid),
        sequence: idx,
      });
    }
  }

  // Upsert WayTotalEdges using raw SQL
  for (let i = 0; i < wayTotalRows.length; i += BATCH_SIZE) {
    const batch = wayTotalRows.slice(i, i + BATCH_SIZE);
    const values = batch.map(
      (row) =>
        Prisma.sql`(${BigInt(row.wayId)}, ${row.totalNodes - 1}, ${row.totalNodes}, ${row.name}, ${row.highwayType})`,
    );
    await prisma.$executeRaw`
      INSERT INTO "WayTotalEdges" ("wayId", "totalEdges", "totalNodes", "name", "highwayType")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("wayId") DO UPDATE SET
        "totalEdges" = EXCLUDED."totalEdges",
        "totalNodes" = EXCLUDED."totalNodes",
        "name" = EXCLUDED."name",
        "highwayType" = EXCLUDED."highwayType"
    `;
  }

  // Upsert WayNode using raw SQL
  for (let i = 0; i < wayNodeRows.length; i += BATCH_SIZE) {
    const batch = wayNodeRows.slice(i, i + BATCH_SIZE);
    const values = batch.map(
      (row) => Prisma.sql`(${row.wayId}, ${row.nodeId}, ${row.sequence})`,
    );
    await prisma.$executeRaw`
      INSERT INTO "WayNode" ("wayId", "nodeId", "sequence")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("wayId", "nodeId") DO UPDATE SET
        "sequence" = EXCLUDED."sequence"
    `;
  }

  // PostGIS geometry + metadata (after Prisma upserts created core rows)
  type GeometryRow = {
    wayId: bigint;
    geojson: string;
    lengthMeters: number;
    surface: string | null;
    access: string | null;
    ref: string | null;
    altNames: string[];
  };

  const geometryRows: GeometryRow[] = [];
  for (const w of ways) {
    if (!w.nodes || w.nodes.length < 2 || w.id == null) continue;
    const wayId = BigInt(w.id);
    const coordinates: [number, number][] = [];
    for (const nid of w.nodes) {
      const c = nodeMap.get(nid);
      if (c) coordinates.push([c.lon, c.lat]);
    }
    if (coordinates.length < 2) continue;

    const geojson = JSON.stringify({
      type: "LineString",
      coordinates,
    });
    const line = turf.lineString(coordinates);
    const lengthMeters = turf.length(line, { units: "kilometers" }) * 1000;
    const tags = w.tags;
    const altNames = collectAltNames(tags);
    geometryRows.push({
      wayId,
      geojson,
      lengthMeters,
      surface: tags?.surface ?? null,
      access: tags?.access ?? null,
      ref: tags?.ref ?? null,
      altNames,
    });
  }

  for (let i = 0; i < geometryRows.length; i += BATCH_SIZE) {
    const batch = geometryRows.slice(i, i + BATCH_SIZE);
    const values = batch.map(
      (r) =>
        Prisma.sql`(${r.wayId}, ST_SetSRID(ST_GeomFromGeoJSON(${r.geojson}::json), 4326), ${r.lengthMeters}, ${r.surface}, ${r.access}, ${r.ref}, ${r.altNames}::text[])`,
    );
    await prisma.$executeRaw`
      UPDATE "WayTotalEdges" AS w SET
        "geometry" = v."geometry"::geometry,
        "lengthMeters" = v."lengthMeters"::double precision,
        "surface" = v."surface"::text,
        "access" = v."access"::text,
        "ref" = v."ref"::text,
        "altNames" = v."altNames"::text[]
      FROM (VALUES ${Prisma.join(values)})
        AS v("wayId", "geometry", "lengthMeters", "surface", "access", "ref", "altNames")
      WHERE w."wayId" = v."wayId"::bigint
    `;
  }

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + CITY_SYNC.EXPIRY_DAYS);

  const name =
    options?.name ??
    (ways[0]?.tags?.name as string | undefined) ??
    `City ${relationId}`;
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

  // Compute and store the convex hull boundary from all synced street geometries.
  // ST_Buffer adds ~100m so edge streets fall inside the polygon.
  const syncedWayIds = wayTotalRows.map((r) => BigInt(r.wayId));
  if (syncedWayIds.length > 0) {
    await prisma.$executeRaw`
      UPDATE "CitySync"
      SET "boundary" = (
        SELECT ST_Buffer(ST_ConvexHull(ST_Collect("geometry")), 0.001)
        FROM "WayTotalEdges"
        WHERE "wayId" IN (${Prisma.join(syncedWayIds)})
          AND "geometry" IS NOT NULL
      )
      WHERE "relationId" = ${relationId}
    `;
  }

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
 * PostGIS-first city lookup: check if (lat, lng) falls inside any synced
 * city boundary. Returns the CitySync record or null. This avoids calling
 * Overpass detectCity for every request in already-synced areas.
 */
export async function findSyncedCityByPoint(
  lat: number,
  lng: number,
): Promise<CitySyncRecord | null> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      relationId: bigint;
      name: string;
      adminLevel: number;
      nodeCount: number;
      wayCount: number;
      syncedAt: Date;
      expiresAt: Date;
    }>
  >`
    SELECT "id", "relationId", "name", "adminLevel",
           "nodeCount", "wayCount", "syncedAt", "expiresAt"
    FROM "CitySync"
    WHERE "boundary" IS NOT NULL
      AND ST_Contains("boundary", ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))
      AND "expiresAt" > NOW()
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  const r = rows[0];
  console.log(
    `[CitySync] PostGIS boundary hit: "${r.name}" (relation ${r.relationId}) — skipping Overpass`,
  );
  return {
    id: r.id,
    relationId: r.relationId,
    name: r.name,
    adminLevel: r.adminLevel,
    nodeCount: r.nodeCount,
    wayCount: r.wayCount,
    syncedAt: r.syncedAt,
    expiresAt: r.expiresAt,
  };
}

/**
 * In-memory lock to prevent concurrent syncs for the same city.
 * Maps relationId -> Promise that resolves when sync completes.
 */
const syncInProgress = new Map<string, Promise<CitySyncRecord | null>>();

/**
 * In-memory lock for the full ensureCitySynced flow (detect + sync).
 * Keyed by a ~1km grid cell so concurrent activities in the same area
 * share a single detectCity Overpass call instead of firing 24+ in parallel.
 */
const ensureInProgress = new Map<string, Promise<CitySyncRecord | null>>();

function gridKey(lat: number, lng: number): string {
  return `${(lat * 100) | 0},${(lng * 100) | 0}`;
}

/**
 * Ensure the city containing (lat, lng) is synced. If not (or expired),
 * detect city and run sync. No-op if already synced and not expired.
 * Deduplicates both detectCity and syncCity calls for concurrent requests.
 *
 * Fast path: PostGIS boundary check (no Overpass).
 * Slow path: detectCity via Overpass (only for genuinely new cities).
 */
export async function ensureCitySynced(
  lat: number,
  lng: number,
): Promise<CitySyncRecord | null> {
  // Fast path: PostGIS boundary lookup
  const local = await findSyncedCityByPoint(lat, lng);
  if (local) return local;

  // Dedup: if another call for the same grid cell is in-flight, piggyback on it.
  const key = gridKey(lat, lng);
  const existing = ensureInProgress.get(key);
  if (existing) return existing;

  const promise = doEnsureCitySynced(lat, lng).finally(() => {
    ensureInProgress.delete(key);
  });
  ensureInProgress.set(key, promise);
  return promise;
}

async function doEnsureCitySynced(
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
  const existingSync = await prisma.citySync.findUnique({
    where: { relationId: city.relationId },
  });

  if (existingSync && existingSync.expiresAt > new Date()) {
    return {
      id: existingSync.id,
      relationId: existingSync.relationId,
      name: existingSync.name,
      adminLevel: existingSync.adminLevel,
      nodeCount: existingSync.nodeCount,
      wayCount: existingSync.wayCount,
      syncedAt: existingSync.syncedAt,
      expiresAt: existingSync.expiresAt,
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

/**
 * True if the administrative area containing (lat,lng) has a non-expired CitySync row.
 * Fast path: PostGIS boundary check. Slow path: Overpass detectCity.
 */
export async function isCitySynced(
  lat: number,
  lng: number,
): Promise<boolean> {
  const local = await findSyncedCityByPoint(lat, lng);
  if (local) return true;

  const city = await detectCity(lat, lng);
  if (!city) return false;
  const existing = await prisma.citySync.findUnique({
    where: { relationId: city.relationId },
  });
  return existing != null && existing.expiresAt > new Date();
}

/**
 * Ensure city data is loading without blocking: enqueue background sync if missing/expired.
 * Fast path: PostGIS boundary check (no Overpass).
 */
export async function ensureCitySyncedAsync(
  lat: number,
  lng: number,
): Promise<{ synced: boolean }> {
  // Fast path: PostGIS boundary lookup — completely avoids Overpass
  const local = await findSyncedCityByPoint(lat, lng);
  if (local) return { synced: true };

  // Slow path: new area — detect city via Overpass and enqueue sync
  const city = await detectCity(lat, lng);
  if (!city) return { synced: false };

  const existing = await prisma.citySync.findUnique({
    where: { relationId: city.relationId },
  });

  if (existing && existing.expiresAt > new Date()) {
    return { synced: true };
  }

  await enqueueCitySyncJob({
    relationId: city.relationId.toString(),
    name: city.name,
    adminLevel: city.adminLevel,
  });

  return { synced: false };
}
