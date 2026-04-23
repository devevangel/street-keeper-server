/**
 * Map geometry for run celebration mini-map (downsampled paths + bbox).
 */

import { Prisma } from "../generated/prisma/client.js";
import prisma from "../lib/prisma.js";
import type { ActivityImpact } from "../types/activity.types.js";
import type { GpxPoint } from "../types/run.types.js";

function deriveBucketsFromImpact(impact: ActivityImpact): {
  completedOsmIds: string[];
  startedOsmIds: string[];
  improvedOsmIds: string[];
} {
  const completedSet = new Set(impact.completed);
  const completedOsmIds = [...impact.completed];
  const startedOsmIds = impact.improved
    .filter((i) => i.from === 0 && !completedSet.has(i.osmId))
    .map((i) => i.osmId);
  const improvedOsmIds = impact.improved
    .filter((i) => i.from > 0 && !completedSet.has(i.osmId))
    .map((i) => i.osmId);
  return { completedOsmIds, startedOsmIds, improvedOsmIds };
}

export type CelebrationMapBucket = "completed" | "started" | "improved";

export interface CelebrationMapStreetSegment {
  osmId: string;
  bucket: CelebrationMapBucket;
  path: [number, number][];
}

export interface CelebrationMapRunPath {
  activityId: string;
  path: [number, number][];
}

export interface CelebrationMapData {
  success: true;
  runs: CelebrationMapRunPath[];
  streets: CelebrationMapStreetSegment[];
  bbox: { south: number; west: number; north: number; east: number };
}

function parseWayId(osmId: string): bigint | null {
  const m = /^way\/(\d+)$/i.exec(osmId.trim());
  if (!m) return null;
  try {
    return BigInt(m[1]!);
  } catch {
    return null;
  }
}

function perpendicularDistance(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const [x, y] = p;
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(
    0,
    Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)),
  );
  const nx = x1 + t * dx;
  const ny = y1 + t * dy;
  return Math.hypot(x - nx, y - ny);
}

function rdp(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length <= 2) return [...points];
  let dmax = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i]!, points[0]!, points[end]!);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }
  if (dmax > epsilon) {
    const rec1 = rdp(points.slice(0, index + 1), epsilon);
    const rec2 = rdp(points.slice(index), epsilon);
    return [...rec1.slice(0, -1), ...rec2];
  }
  return [points[0]!, points[end]!];
}

function downsamplePath(points: [number, number][], maxPoints = 250): [number, number][] {
  if (points.length <= maxPoints) return points;
  let eps = 3e-5;
  let simplified = rdp(points, eps);
  let guard = 0;
  while (simplified.length > maxPoints && guard < 14) {
    eps *= 1.45;
    simplified = rdp(points, eps);
    guard++;
  }
  return simplified;
}

function extendBbox(
  bbox: { south: number; west: number; north: number; east: number } | null,
  lat: number,
  lng: number,
): { south: number; west: number; north: number; east: number } {
  if (!bbox) {
    return { south: lat, north: lat, west: lng, east: lng };
  }
  return {
    south: Math.min(bbox.south, lat),
    north: Math.max(bbox.north, lat),
    west: Math.min(bbox.west, lng),
    east: Math.max(bbox.east, lng),
  };
}

function bboxFromPaths(paths: [number, number][][]): CelebrationMapData["bbox"] {
  let bbox: { south: number; west: number; north: number; east: number } | null =
    null;
  for (const path of paths) {
    for (const [lat, lng] of path) {
      bbox = extendBbox(bbox, lat, lng);
    }
  }
  if (!bbox) {
    return { south: 0, west: 0, north: 0.01, east: 0.01 };
  }
  const pad = 0.002;
  return {
    south: bbox.south - pad,
    north: bbox.north + pad,
    west: bbox.west - pad,
    east: bbox.east + pad,
  };
}

function activityCoordsToPath(raw: unknown): [number, number][] {
  if (!Array.isArray(raw)) return [];
  const out: [number, number][] = [];
  for (const p of raw) {
    if (
      p &&
      typeof p === "object" &&
      "lat" in p &&
      "lng" in p &&
      typeof (p as GpxPoint).lat === "number" &&
      typeof (p as GpxPoint).lng === "number"
    ) {
      const pt = p as GpxPoint;
      out.push([pt.lat, pt.lng]);
    }
  }
  return out;
}

const BUCKET_RANK: Record<CelebrationMapBucket, number> = {
  completed: 3,
  started: 2,
  improved: 1,
};

/**
 * Load downsampled run polylines and highlighted street geometries for celebration events.
 */
export async function getCelebrationMapData(
  userId: string,
  eventIds: string[],
): Promise<CelebrationMapData> {
  const uniqueIds = [...new Set(eventIds)];
  if (uniqueIds.length === 0) {
    return {
      success: true,
      runs: [],
      streets: [],
      bbox: { south: 0, west: 0, north: 0.01, east: 0.01 },
    };
  }

  const events = await prisma.runCelebrationEvent.findMany({
    where: { userId, id: { in: uniqueIds } },
    select: {
      activityId: true,
      projectId: true,
    },
  });

  if (events.length !== uniqueIds.length) {
    throw new Error(
      "One or more celebration events were not found or do not belong to you",
    );
  }

  const activityIds = [...new Set(events.map((e) => e.activityId))];
  const activities = await prisma.activity.findMany({
    where: { id: { in: activityIds }, userId, isDeleted: false },
    select: { id: true, coordinates: true },
  });
  const coordByActivity = new Map(
    activities.map((a) => [a.id, activityCoordsToPath(a.coordinates)]),
  );

  const osmBucket = new Map<string, CelebrationMapBucket>();

  for (const ev of events) {
    if (!ev.projectId) continue;
    const pa = await prisma.projectActivity.findUnique({
      where: {
        projectId_activityId: {
          projectId: ev.projectId,
          activityId: ev.activityId,
        },
      },
      select: { impactDetails: true },
    });
    const impact = pa?.impactDetails as ActivityImpact | null | undefined;
    if (!impact) continue;
    const { completedOsmIds, startedOsmIds, improvedOsmIds } =
      deriveBucketsFromImpact(impact);

    const assign = (osmId: string, bucket: CelebrationMapBucket) => {
      const prev = osmBucket.get(osmId);
      if (!prev || BUCKET_RANK[bucket] > BUCKET_RANK[prev]) {
        osmBucket.set(osmId, bucket);
      }
    };
    for (const id of completedOsmIds) assign(id, "completed");
    for (const id of startedOsmIds) assign(id, "started");
    for (const id of improvedOsmIds) assign(id, "improved");
  }

  const runs: CelebrationMapRunPath[] = [];
  const allPathsForBbox: [number, number][][] = [];

  for (const aid of activityIds) {
    const rawPath = coordByActivity.get(aid) ?? [];
    const path = downsamplePath(rawPath);
    if (path.length >= 2) {
      runs.push({ activityId: aid, path });
      allPathsForBbox.push(path);
    }
  }

  const wayIds = [...new Set([...osmBucket.keys()].map(parseWayId).filter((x): x is bigint => x != null))];

  type WayRow = { wayId: bigint; geojson: string };
  const streets: CelebrationMapStreetSegment[] = [];

  if (wayIds.length > 0) {
    const rows = await prisma.$queryRaw<WayRow[]>`
      SELECT "wayId", ST_AsGeoJSON("geometry")::text AS geojson
      FROM "WayTotalEdges"
      WHERE "wayId" IN (${Prisma.join(wayIds)})
        AND "geometry" IS NOT NULL
    `;

    const rowByWay = new Map(rows.map((r) => [String(r.wayId), r]));

    for (const [osmId, bucket] of osmBucket) {
      const wid = parseWayId(osmId);
      if (wid == null) continue;
      const row = rowByWay.get(String(wid));
      if (!row?.geojson) continue;
      try {
        const gj = JSON.parse(row.geojson) as {
          type?: string;
          coordinates?: [number, number][];
        };
        if (gj.type !== "LineString" || !Array.isArray(gj.coordinates)) continue;
        const pathLatLng: [number, number][] = gj.coordinates.map(([lng, lat]) => [
          lat,
          lng,
        ]);
        const path = downsamplePath(pathLatLng, 120);
        if (path.length >= 2) {
          streets.push({ osmId, bucket, path });
          allPathsForBbox.push(path);
        }
      } catch {
        /* skip bad geojson */
      }
    }
  }

  return {
    success: true,
    runs,
    streets,
    bbox: bboxFromPaths(allPathsForBbox),
  };
}
