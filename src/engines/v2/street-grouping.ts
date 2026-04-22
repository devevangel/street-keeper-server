/**
 * Location-aware logical street grouping.
 *
 * Two OSM ways share the same name but are different logical streets when they're
 * physically separated (e.g. two Richmond Places in the same city). Grouping by
 * `normalizeStreetName` alone pools their node hits and merges their geometries,
 * which corrupts both the displayed percentage and the rendered polyline.
 *
 * This helper groups ways by (normalizedName, spatial cluster):
 *   1. Bucket by normalized name.
 *   2. Inside each name bucket, cluster segments whose centroids are within
 *      MAX_CLUSTER_DIST_METERS of at least one other segment in the same cluster
 *      (single-linkage union-find).
 *
 * Neighbouring segments of one logical street have adjacent centroids and collapse
 * into a single cluster. Two physically distant streets with the same name end up
 * in separate clusters and are reported as separate logical streets.
 */

import { normalizeStreetName } from "../../utils/normalize-street-name.js";
import type { GeoJsonLineString } from "../../types/run.types.js";

const DEFAULT_MAX_CLUSTER_DIST_METERS = 750;

export type LatLng = { lat: number; lng: number };

/** Compute centroid of a GeoJSON LineString in [lng, lat] coords. */
export function lineStringCentroid(
  coords: ReadonlyArray<readonly [number, number]> | undefined,
): LatLng | null {
  if (!coords || coords.length === 0) return null;
  let sumLng = 0;
  let sumLat = 0;
  for (const [lng, lat] of coords) {
    sumLng += lng;
    sumLat += lat;
  }
  return { lat: sumLat / coords.length, lng: sumLng / coords.length };
}

/** Great-circle distance in metres (Haversine). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type LogicalStreetGroup<T> = {
  /** "normalizedName|clusterIndex" — stable within a single call. */
  key: string;
  /** Normalized name shared by every item. */
  normalizedName: string;
  /** Name of the first item in the cluster (for UI). */
  displayName: string;
  /** Approximate cluster centroid (mean of member centroids). */
  centroid: LatLng | null;
  items: T[];
};

/**
 * Group items by (normalized name, spatial cluster).
 *
 * @param items           Items to group.
 * @param getName         Return the street name for each item.
 * @param getCentroid     Return a LatLng for each item; items with a null centroid
 *                        skip the spatial check and share a single bucket per name.
 * @param opts.maxClusterDistMeters Max distance between any two centroids in the
 *                        same cluster (single-linkage). Defaults to 750 m.
 */
export function groupByLogicalStreet<T>(
  items: T[],
  getName: (t: T) => string | null | undefined,
  getCentroid: (t: T) => LatLng | null,
  opts?: { maxClusterDistMeters?: number },
): LogicalStreetGroup<T>[] {
  const maxDist = opts?.maxClusterDistMeters ?? DEFAULT_MAX_CLUSTER_DIST_METERS;

  const byName = new Map<string, { items: T[]; displayName: string }>();
  for (const item of items) {
    const raw = getName(item) ?? "";
    const key = normalizeStreetName(raw);
    const bucket = byName.get(key);
    if (bucket) {
      bucket.items.push(item);
    } else {
      byName.set(key, { items: [item], displayName: raw });
    }
  }

  const out: LogicalStreetGroup<T>[] = [];

  for (const [normalizedName, bucket] of byName) {
    const { items: bucketItems, displayName } = bucket;

    // Fast path: one item → one cluster.
    if (bucketItems.length === 1) {
      const centroid = getCentroid(bucketItems[0]);
      out.push({
        key: normalizedName,
        normalizedName,
        displayName,
        centroid,
        items: bucketItems,
      });
      continue;
    }

    // Compute centroids up front.
    const centroids = bucketItems.map((it) => getCentroid(it));

    // Union-find single-linkage clustering on centroid distance.
    const parent = bucketItems.map((_, i) => i);
    const find = (i: number): number => {
      let r = i;
      while (parent[r] !== r) r = parent[r];
      // Path compression.
      let c = i;
      while (parent[c] !== r) {
        const next = parent[c];
        parent[c] = r;
        c = next;
      }
      return r;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };

    for (let i = 0; i < bucketItems.length; i++) {
      const ci = centroids[i];
      if (!ci) continue;
      for (let j = i + 1; j < bucketItems.length; j++) {
        const cj = centroids[j];
        if (!cj) continue;
        if (haversineMeters(ci, cj) <= maxDist) union(i, j);
      }
    }

    // Collect clusters by root.
    const clusters = new Map<number, number[]>();
    const noCentroid: number[] = [];
    for (let i = 0; i < bucketItems.length; i++) {
      if (!centroids[i]) {
        noCentroid.push(i);
        continue;
      }
      const root = find(i);
      const arr = clusters.get(root);
      if (arr) arr.push(i);
      else clusters.set(root, [i]);
    }
    // Items without centroid go into the first cluster (or a solo one).
    if (noCentroid.length > 0) {
      if (clusters.size === 0) {
        clusters.set(noCentroid[0], noCentroid);
      } else {
        const firstRoot = clusters.keys().next().value as number;
        clusters.get(firstRoot)!.push(...noCentroid);
      }
    }

    let clusterIdx = 0;
    for (const indices of clusters.values()) {
      let sumLat = 0;
      let sumLng = 0;
      let count = 0;
      for (const i of indices) {
        const c = centroids[i];
        if (c) {
          sumLat += c.lat;
          sumLng += c.lng;
          count += 1;
        }
      }
      const centroid =
        count > 0 ? { lat: sumLat / count, lng: sumLng / count } : null;
      const clusterItems = indices.map((i) => bucketItems[i]);
      const key =
        clusters.size === 1
          ? normalizedName
          : `${normalizedName}|${clusterIdx++}`;
      out.push({
        key,
        normalizedName,
        displayName: (getName(clusterItems[0]) ?? "").trim() || displayName,
        centroid,
        items: clusterItems,
      });
    }
  }

  return out;
}

// ============================================
// Geometry merging
// ============================================

type WithOptionalGeometry = {
  geometry?: GeoJsonLineString | null;
  lengthMeters?: number;
};

/**
 * Merge multiple segment LineStrings into a single LineString for display.
 *
 * Segments are sorted by the latitude of their first coordinate (then longitude)
 * so concatenation roughly follows a north→south walk; touching endpoints are
 * deduplicated. Not a perfect graph walk (which would require shared OSM nodes),
 * but it produces a stable, mostly continuous polyline for rendering.
 */
export function mergeSegmentGeometries<T extends WithOptionalGeometry>(
  segments: T[],
): GeoJsonLineString | undefined {
  const withGeom = segments.filter(
    (s): s is T & { geometry: GeoJsonLineString } =>
      !!s.geometry && Array.isArray(s.geometry.coordinates) &&
      s.geometry.coordinates.length > 0,
  );
  if (withGeom.length === 0) return undefined;

  const sorted = [...withGeom].sort((a, b) => {
    const aFirst = a.geometry.coordinates[0];
    const bFirst = b.geometry.coordinates[0];
    const latDiff = aFirst[1] - bFirst[1];
    if (Math.abs(latDiff) > 0.0001) return latDiff;
    return aFirst[0] - bFirst[0];
  });

  const out: [number, number][] = [];
  for (const seg of sorted) {
    for (const coord of seg.geometry.coordinates) {
      const last = out[out.length - 1];
      if (
        last &&
        Math.abs(last[0] - coord[0]) < 0.000001 &&
        Math.abs(last[1] - coord[1]) < 0.000001
      ) {
        continue;
      }
      out.push([coord[0], coord[1]]);
    }
  }

  if (out.length === 0) return undefined;

  return { type: "LineString", coordinates: out };
}
