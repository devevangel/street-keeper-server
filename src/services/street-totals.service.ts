/**
 * Street-completion totals for the homepage/project metric strip (V2 engine).
 *
 * Semantics
 * ---------
 * We use the same source of truth the map uses for its "Done · 100%" bin:
 * `UserNodeHit` + `WayNode` + `WayTotalEdges`, with the V2 node-hit rule
 * (`isWayComplete`). V1 (`UserStreetProgress`) is intentionally ignored — it
 * is kept around for educational comparison only and is not written in
 * production.
 *
 * Lifetime streets completed:
 *   1. Load every `UserNodeHit` for the user (with `hitAt` timestamps).
 *   2. Fetch `WayNode` rows for those node IDs → map of (wayId → hit count).
 *   3. Fetch `WayTotalEdges` for touched ways.
 *   4. A way is "complete" when `isWayComplete(hitCount, totalNodes)`.
 *   5. Group by normalised street name, ignore unnamed ways, and count each
 *      logical street where at least one observed segment is complete.
 *      ("At least one" rather than "all" because a single node at an
 *      intersection is shared with multiple ways — requiring every same-named
 *      segment to be complete systematically under-counts finished streets.)
 *
 * Streets completed this month:
 *   Same pipeline, but the hit set is partitioned into "before month start"
 *   and "all time" so a named street is counted as "newly completed this
 *   month" iff some segment is complete now AND no segment was complete at
 *   month start.
 */

import prisma from "../lib/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { isWayComplete } from "../engines/v2/street-completion.js";
import { isUnnamedStreet } from "../engines/v1/street-aggregation.js";
import { normalizeStreetName } from "../utils/normalize-street-name.js";

/** UTC midnight on the first of the month containing `ref` (fallback). */
export function getUtcMonthStart(ref: Date): Date {
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1, 0, 0, 0, 0));
}

/**
 * First instant of the calendar month containing `ref`, in IANA `timeZone`,
 * using PostgreSQL (handles DST). Falls back to UTC month start on invalid zone or query error.
 */
export async function getZonedMonthStartUtc(ref: Date, timeZone: string): Promise<Date> {
  const tz = timeZone?.trim() || "UTC";
  if (tz === "UTC" || tz === "Etc/UTC") {
    return getUtcMonthStart(ref);
  }
  if (!/^[A-Za-z_/+\-0-9]+$/.test(tz)) {
    return getUtcMonthStart(ref);
  }
  try {
    const rows = await prisma.$queryRaw<{ month_start: Date }[]>(
      Prisma.sql`
        SELECT (date_trunc('month', (${ref}::timestamptz AT TIME ZONE ${tz})::timestamp) AT TIME ZONE ${tz})::timestamptz AS month_start
      `,
    );
    const row = rows[0]?.month_start;
    if (row instanceof Date && !Number.isNaN(row.getTime())) return row;
  } catch {
    /* invalid zone or DB error */
  }
  return getUtcMonthStart(ref);
}

export function formatZonedMonthLabel(ref: Date, timeZone: string): string {
  const zone = timeZone?.trim() || "UTC";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    month: "long",
    year: "numeric",
  }).formatToParts(ref);
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  return `${month} ${year}`.trim();
}

export interface UserStreetTotals {
  lifetimeStreetsCompleted: number;
  streetsThisMonth: number;
  monthLabel: string;
}

interface ComputedTotals {
  lifetime: number;
  thisMonth: number;
}

/** Named street → whether any observed segment is complete. */
type NameBucket = { anyComplete: boolean };

/**
 * Compute both the lifetime and "newly completed this month" street counts
 * in a single pass over the user's node hits. Groups by normalised street
 * name, ignores unnamed ways, and matches the map's "Done · 100%" rule.
 */
async function computeCompletedStreetCounts(
  userId: string,
  monthStart: Date,
): Promise<ComputedTotals> {
  const hits = await prisma.userNodeHit.findMany({
    where: { userId },
    select: { nodeId: true, hitAt: true },
  });
  if (hits.length === 0) return { lifetime: 0, thisMonth: 0 };

  const allHitNodeIds = new Set<bigint>();
  const priorHitNodeIds = new Set<bigint>();
  for (const h of hits) {
    allHitNodeIds.add(h.nodeId);
    if (h.hitAt < monthStart) priorHitNodeIds.add(h.nodeId);
  }

  const wayNodes = await prisma.wayNode.findMany({
    where: { nodeId: { in: [...allHitNodeIds] } },
    select: { wayId: true, nodeId: true },
  });
  if (wayNodes.length === 0) return { lifetime: 0, thisMonth: 0 };

  const nowHitsByWay = new Map<bigint, number>();
  const priorHitsByWay = new Map<bigint, number>();
  for (const wn of wayNodes) {
    nowHitsByWay.set(wn.wayId, (nowHitsByWay.get(wn.wayId) ?? 0) + 1);
    if (priorHitNodeIds.has(wn.nodeId)) {
      priorHitsByWay.set(wn.wayId, (priorHitsByWay.get(wn.wayId) ?? 0) + 1);
    }
  }

  const touchedWayIds = [...nowHitsByWay.keys()];
  const wayTotals = await prisma.wayTotalEdges.findMany({
    where: { wayId: { in: touchedWayIds } },
    select: { wayId: true, totalNodes: true, name: true },
  });

  // Group by normalised name. We carry a "complete now" and "complete before
  // month start" signal per name so both metrics fall out of one pass.
  const nowByName = new Map<string, NameBucket>();
  const priorByName = new Map<string, NameBucket>();

  const markComplete = (
    bucketMap: Map<string, NameBucket>,
    name: string,
  ): void => {
    const entry = bucketMap.get(name) ?? { anyComplete: false };
    entry.anyComplete = true;
    bucketMap.set(name, entry);
  };

  for (const row of wayTotals) {
    if (!row.name || isUnnamedStreet(row.name)) continue;
    const nameKey = normalizeStreetName(row.name);
    if (!nameKey) continue;

    const nowHits = nowHitsByWay.get(row.wayId) ?? 0;
    if (isWayComplete(nowHits, row.totalNodes)) {
      markComplete(nowByName, nameKey);
    }

    const priorHits = priorHitsByWay.get(row.wayId) ?? 0;
    if (priorHits > 0 && isWayComplete(priorHits, row.totalNodes)) {
      markComplete(priorByName, nameKey);
    }
  }

  let lifetime = 0;
  let thisMonth = 0;
  for (const [nameKey, bucket] of nowByName.entries()) {
    if (!bucket.anyComplete) continue;
    lifetime += 1;
    if (!priorByName.get(nameKey)?.anyComplete) thisMonth += 1;
  }

  return { lifetime, thisMonth };
}

export async function getUserStreetTotals(
  userId: string,
  timeZone: string,
  ref: Date = new Date(),
): Promise<UserStreetTotals> {
  const tz = timeZone?.trim() || "UTC";
  const monthStart = await getZonedMonthStartUtc(ref, tz);
  const { lifetime, thisMonth } = await computeCompletedStreetCounts(userId, monthStart);

  return {
    lifetimeStreetsCompleted: lifetime,
    streetsThisMonth: thisMonth,
    monthLabel: formatZonedMonthLabel(ref, tz),
  };
}

/**
 * Project-scoped "streets completed this month" count.
 *
 * Uses the same V2 node-hit logic but restricts touched ways to those present
 * in the project's current street snapshot (by osmId). This keeps the number
 * consistent with the project detail view's street list.
 */
export async function getProjectStreetTotals(
  projectId: string,
  userId: string,
  timeZone: string,
  ref: Date = new Date(),
): Promise<{ streetsThisMonth: number; monthLabel: string }> {
  const tz = timeZone?.trim() || "UTC";
  const monthStart = await getZonedMonthStartUtc(ref, tz);

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { streetsSnapshot: true },
  });
  const snapshot = project?.streetsSnapshot as
    | { streets?: Array<{ osmId?: string }> }
    | null
    | undefined;
  const snapshotOsmIds = new Set<string>();
  if (snapshot && Array.isArray(snapshot.streets)) {
    for (const s of snapshot.streets) {
      if (s && typeof s.osmId === "string") snapshotOsmIds.add(s.osmId);
    }
  }

  if (snapshotOsmIds.size === 0) {
    return { streetsThisMonth: 0, monthLabel: formatZonedMonthLabel(ref, tz) };
  }

  // Reuse the user-wide computation and filter into the project's snapshot
  // downstream. Because the user count already ignores unnamed ways and
  // aggregates by name, we just re-filter the raw way-level data here.
  const hits = await prisma.userNodeHit.findMany({
    where: { userId },
    select: { nodeId: true, hitAt: true },
  });
  if (hits.length === 0) {
    return { streetsThisMonth: 0, monthLabel: formatZonedMonthLabel(ref, tz) };
  }

  const projectWayIds = [...snapshotOsmIds]
    .filter((id) => id.startsWith("way/"))
    .map((id) => {
      try {
        return BigInt(id.slice(4));
      } catch {
        return null;
      }
    })
    .filter((x): x is bigint => x !== null);
  if (projectWayIds.length === 0) {
    return { streetsThisMonth: 0, monthLabel: formatZonedMonthLabel(ref, tz) };
  }

  const wayNodes = await prisma.wayNode.findMany({
    where: { wayId: { in: projectWayIds } },
    select: { wayId: true, nodeId: true },
  });
  const hitNodeIds = new Set(hits.map((h) => h.nodeId));
  const priorHitNodeIds = new Set(
    hits.filter((h) => h.hitAt < monthStart).map((h) => h.nodeId),
  );

  const nowHitsByWay = new Map<bigint, number>();
  const priorHitsByWay = new Map<bigint, number>();
  for (const wn of wayNodes) {
    if (!hitNodeIds.has(wn.nodeId)) continue;
    nowHitsByWay.set(wn.wayId, (nowHitsByWay.get(wn.wayId) ?? 0) + 1);
    if (priorHitNodeIds.has(wn.nodeId)) {
      priorHitsByWay.set(wn.wayId, (priorHitsByWay.get(wn.wayId) ?? 0) + 1);
    }
  }

  const wayTotals = await prisma.wayTotalEdges.findMany({
    where: { wayId: { in: [...nowHitsByWay.keys()] } },
    select: { wayId: true, totalNodes: true, name: true },
  });

  const nowByName = new Map<string, NameBucket>();
  const priorByName = new Map<string, NameBucket>();
  const markComplete = (
    bucketMap: Map<string, NameBucket>,
    name: string,
  ): void => {
    const entry = bucketMap.get(name) ?? { anyComplete: false };
    entry.anyComplete = true;
    bucketMap.set(name, entry);
  };

  for (const row of wayTotals) {
    if (!row.name || isUnnamedStreet(row.name)) continue;
    const nameKey = normalizeStreetName(row.name);
    if (!nameKey) continue;
    const nowHits = nowHitsByWay.get(row.wayId) ?? 0;
    if (isWayComplete(nowHits, row.totalNodes)) {
      markComplete(nowByName, nameKey);
    }
    const priorHits = priorHitsByWay.get(row.wayId) ?? 0;
    if (priorHits > 0 && isWayComplete(priorHits, row.totalNodes)) {
      markComplete(priorByName, nameKey);
    }
  }

  let streetsThisMonth = 0;
  for (const [nameKey, bucket] of nowByName.entries()) {
    if (!bucket.anyComplete) continue;
    if (!priorByName.get(nameKey)?.anyComplete) streetsThisMonth += 1;
  }

  return {
    streetsThisMonth,
    monthLabel: formatZonedMonthLabel(ref, tz),
  };
}
