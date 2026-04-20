/**
 * Local street queries via PostGIS (WayTotalEdges.geometry).
 * Drop-in replacement for Overpass radius/bbox/polygon queries.
 */

import { Prisma } from "../generated/prisma/client.js";
import prisma from "../lib/prisma.js";
import { OVERPASS } from "../config/constants.js";
import type { BoundingBox, GeoJsonLineString, OsmStreet } from "../types/run.types.js";
import { calculateLineLength } from "./geo.service.js";
import { resolvePolygonFilter } from "./geometry-cache.service.js";

const POSTGIS_LOG_SLOW_MS = 100;

function logPostGIS(fn: string, rowCount: number, ms: number): void {
  if (ms > POSTGIS_LOG_SLOW_MS) {
    console.warn(`[PostGIS] ${fn}: ${rowCount} rows in ${ms.toFixed(1)}ms (slow)`);
  } else {
    console.log(`[PostGIS] ${fn}: ${rowCount} rows in ${ms.toFixed(1)}ms`);
  }
}

type RawStreetRow = {
  wayId: bigint;
  name: string | null;
  highwayType: string;
  lengthMeters: number | null;
  geojson: string;
  surface: string | null;
  access: string | null;
  ref: string | null;
  altNames: string[] | null;
};

function rowToOsmStreet(row: RawStreetRow): OsmStreet | null {
  let geometry: GeoJsonLineString;
  try {
    const parsed = JSON.parse(row.geojson) as GeoJsonLineString;
    if (parsed.type !== "LineString" || !Array.isArray(parsed.coordinates)) {
      return null;
    }
    geometry = parsed;
  } catch {
    return null;
  }

  const wayIdStr = String(row.wayId);
  const primaryName =
    row.name && row.name.trim() !== ""
      ? row.name
      : "";

  const lengthMeters =
    row.lengthMeters != null && row.lengthMeters > 0
      ? row.lengthMeters
      : calculateLineLength(geometry);

  return {
    osmId: `way/${wayIdStr}`,
    name: primaryName,
    lengthMeters,
    geometry,
    highwayType: row.highwayType,
    altNames:
      row.altNames && row.altNames.length > 0 ? row.altNames : undefined,
    surface: row.surface ?? undefined,
    access: row.access ?? undefined,
    ref: row.ref ?? undefined,
  };
}

function highwayTypeFilterSql(
  highwayTypes: string[] | undefined,
): Prisma.Sql {
  if (!highwayTypes?.length) {
    return Prisma.empty;
  }
  const or = highwayTypes.map(
    (h) => Prisma.sql`"highwayType" = ${h}`,
  );
  return Prisma.sql`AND (${Prisma.join(or, " OR ")})`;
}

/**
 * Streets within radius of a point (meters), using geography distance.
 */
export async function getLocalStreetsInRadius(
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
  options?: { namedOnly?: boolean; highwayTypes?: string[] },
): Promise<OsmStreet[]> {
  const namedOnly = options?.namedOnly ?? false;
  const highwayTypes =
    options?.highwayTypes ?? [...OVERPASS.HIGHWAY_TYPES];
  const start = performance.now();

  const rows = await prisma.$queryRaw<RawStreetRow[]>`
    SELECT
      "wayId",
      "name",
      "highwayType",
      "lengthMeters",
      ST_AsGeoJSON("geometry")::text AS geojson,
      "surface",
      "access",
      "ref",
      "altNames"
    FROM "WayTotalEdges"
    WHERE "geometry" IS NOT NULL
      AND ST_DWithin(
        "geometry"::geography,
        ST_SetSRID(ST_MakePoint(${centerLng}, ${centerLat}), 4326)::geography,
        ${radiusMeters}
      )
      ${namedOnly ? Prisma.sql`AND "name" IS NOT NULL AND TRIM("name") <> ''` : Prisma.empty}
      ${highwayTypeFilterSql(highwayTypes)}
  `;

  logPostGIS(
    "getLocalStreetsInRadius",
    rows.length,
    performance.now() - start,
  );

  const out: OsmStreet[] = [];
  for (const row of rows) {
    const s = rowToOsmStreet(row);
    if (s) out.push(s);
  }
  return out;
}

/**
 * Streets intersecting a bounding box (WGS84).
 */
export async function getLocalStreetsInBBox(
  bbox: BoundingBox,
  options?: { namedOnly?: boolean; highwayTypes?: string[] },
): Promise<OsmStreet[]> {
  const { south, west, north, east } = bbox;
  const namedOnly = options?.namedOnly ?? false;
  const highwayTypes =
    options?.highwayTypes ?? [...OVERPASS.HIGHWAY_TYPES];
  const start = performance.now();

  const rows = await prisma.$queryRaw<RawStreetRow[]>`
    SELECT
      "wayId",
      "name",
      "highwayType",
      "lengthMeters",
      ST_AsGeoJSON("geometry")::text AS geojson,
      "surface",
      "access",
      "ref",
      "altNames"
    FROM "WayTotalEdges"
    WHERE "geometry" IS NOT NULL
      AND "geometry" && ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326)
      ${namedOnly ? Prisma.sql`AND "name" IS NOT NULL AND TRIM("name") <> ''` : Prisma.empty}
      ${highwayTypeFilterSql(highwayTypes)}
  `;

  logPostGIS(
    "getLocalStreetsInBBox",
    rows.length,
    performance.now() - start,
  );

  const out: OsmStreet[] = [];
  for (const row of rows) {
    const s = rowToOsmStreet(row);
    if (s) out.push(s);
  }
  return out;
}

/**
 * Streets intersecting a polygon (GeoJSON lon/lat ring).
 */
export async function getLocalStreetsInPolygon(
  polygonCoordinates: [number, number][],
  options?: { namedOnly?: boolean; highwayTypes?: string[] },
): Promise<OsmStreet[]> {
  if (polygonCoordinates.length < 3) return [];

  const ring = [...polygonCoordinates];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }

  const geojsonPolygon = JSON.stringify({
    type: "Polygon",
    coordinates: [ring],
  });

  const namedOnly = options?.namedOnly ?? false;
  const highwayTypes =
    options?.highwayTypes ?? [...OVERPASS.HIGHWAY_TYPES];
  const start = performance.now();

  const rows = await prisma.$queryRaw<RawStreetRow[]>`
    SELECT
      "wayId",
      "name",
      "highwayType",
      "lengthMeters",
      ST_AsGeoJSON("geometry")::text AS geojson,
      "surface",
      "access",
      "ref",
      "altNames"
    FROM "WayTotalEdges"
    WHERE "geometry" IS NOT NULL
      AND ST_Intersects(
        "geometry",
        ST_SetSRID(ST_GeomFromGeoJSON(${geojsonPolygon}::json), 4326)
      )
      ${namedOnly ? Prisma.sql`AND "name" IS NOT NULL AND TRIM("name") <> ''` : Prisma.empty}
      ${highwayTypeFilterSql(highwayTypes)}
  `;

  logPostGIS(
    "getLocalStreetsInPolygon",
    rows.length,
    performance.now() - start,
  );

  const out: OsmStreet[] = [];
  for (const row of rows) {
    const s = rowToOsmStreet(row);
    if (s) out.push(s);
  }
  return out;
}

/**
 * Polygon query with client-side boundary filter (intersects / contains), matching geometry-cache behavior.
 */
export async function getLocalStreetsInPolygonFiltered(
  polygonCoordinates: [number, number][],
  boundaryMode: string | undefined,
  options?: { namedOnly?: boolean },
): Promise<OsmStreet[]> {
  const bbox: BoundingBox = {
    south: Math.min(...polygonCoordinates.map((c) => c[1])),
    north: Math.max(...polygonCoordinates.map((c) => c[1])),
    west: Math.min(...polygonCoordinates.map((c) => c[0])),
    east: Math.max(...polygonCoordinates.map((c) => c[0])),
  };
  const streets = await getLocalStreetsInBBox(bbox, {
    namedOnly: options?.namedOnly ?? false,
    highwayTypes: [...OVERPASS.HIGHWAY_TYPES],
  });
  const filterFn = resolvePolygonFilter(boundaryMode ?? "intersects");
  return filterFn(streets, polygonCoordinates);
}
