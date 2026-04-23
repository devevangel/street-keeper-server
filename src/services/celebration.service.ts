/**
 * Run celebration persistence and Strava share helpers.
 */

import prisma from "../lib/prisma.js";
import type { ActivityProcessingResult } from "./activity-processor.service.js";
import type { ActivityImpact } from "../types/activity.types.js";
import {
  buildShareMessage,
  STREET_KEEPER_HASHTAG_FOOTER,
  STREET_KEEPER_HASHTAG_FOOTER_STRIP_RE,
} from "./celebration-message.service.js";
import {
  fetchActivity,
  updateStravaActivity,
  StravaApiError,
} from "./strava.service.js";
import { getValidStravaToken } from "./auth.service.js";

/** Strip our hashtag footer from a stored share message (for multi-project merge). */
export function stripHashtagFooter(message: string): string {
  return message.replace(STREET_KEEPER_HASHTAG_FOOTER_STRIP_RE, "").trim();
}

/** Strip leading Street Keeper header line from a stored share message. */
export function stripStreetKeeperHeader(message: string): string {
  return message.replace(/^--- Street Keeper ---\s*\n?/m, "").trim();
}

function normalizeShareBody(message: string): string {
  return stripHashtagFooter(stripStreetKeeperHeader(message));
}

const SK_FOOTER_BASE = "\n\n#StreetKeeper #RunEveryStreet";

/** Remove all Street Keeper blocks from a Strava description (legacy auto-footer + celebrations). */
export function stripAllStreetKeeperBlocks(description: string): string {
  const marker = "--- Street Keeper ---";
  let s = description;
  for (;;) {
    const start = s.indexOf(marker);
    if (start === -1) break;
    const tail = s.slice(start);
    const footIdx = tail.lastIndexOf(SK_FOOTER_BASE);
    if (footIdx === -1) {
      s = (s.slice(0, start) + tail.slice(marker.length)).trim();
      break;
    }
    const afterFoot = tail.slice(footIdx + SK_FOOTER_BASE.length);
    const extra = afterFoot.match(/^(?:\s+#[A-Za-z0-9_]+)*/u);
    const removeThrough = start + footIdx + SK_FOOTER_BASE.length + (extra?.[0].length ?? 0);
    s = (s.slice(0, start) + s.slice(removeThrough)).replace(/\n{3,}/g, "\n\n").trim();
  }
  return s.trim();
}

export function deriveBucketsFromImpact(impact: ActivityImpact): {
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

async function resolveStreetNames(
  userId: string,
  osmIds: string[],
): Promise<Map<string, string>> {
  if (osmIds.length === 0) return new Map();
  const rows = await prisma.userStreetProgress.findMany({
    where: { userId, osmId: { in: osmIds } },
    select: { osmId: true, name: true },
  });
  return new Map(rows.map((r) => [r.osmId, r.name || r.osmId]));
}

function orderNames(osmIds: string[], nameByOsm: Map<string, string>): string[] {
  return osmIds.map((id) => nameByOsm.get(id) ?? id);
}

/**
 * Persist celebration rows after a successful processActivity (project overlap only).
 * Non-fatal failures should be caught by the caller.
 */
export async function writeCelebrationEventsForActivity(
  activityId: string,
  userId: string,
  result: ActivityProcessingResult,
): Promise<void> {
  if (!result.success || !result.projects?.length) {
    return;
  }

  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: {
      distanceMeters: true,
      durationSeconds: true,
      startDate: true,
      isDeleted: true,
      user: {
        select: {
          preferences: { select: { timezone: true } },
        },
      },
    },
  });
  if (!activity || activity.isDeleted) return;

  const userTimeZone = activity.user?.preferences?.timezone ?? "UTC";

  const sameRunProjectCount = result.projects.filter((p) => {
    const { completedOsmIds, startedOsmIds, improvedOsmIds } =
      deriveBucketsFromImpact(p.impact);
    return (
      completedOsmIds.length + startedOsmIds.length + improvedOsmIds.length > 0
    );
  }).length;

  for (const pr of result.projects) {
    const { completedOsmIds, startedOsmIds, improvedOsmIds } =
      deriveBucketsFromImpact(pr.impact);
    const totalBuckets =
      completedOsmIds.length + startedOsmIds.length + improvedOsmIds.length;
    if (totalBuckets === 0) continue;

    const projectRow = await prisma.project.findUnique({
      where: { id: pr.projectId },
      select: {
        id: true,
        name: true,
        progress: true,
        completedStreets: true,
        totalStreets: true,
        isArchived: true,
        userId: true,
      },
    });
    if (!projectRow || projectRow.isArchived || projectRow.userId !== userId) {
      continue;
    }

    const totalStreets = projectRow.totalStreets;
    const afterCompleted = projectRow.completedStreets;
    const newlyCompleted = completedOsmIds.length;
    const progressAfter = projectRow.progress;
    const progressBefore =
      totalStreets > 0
        ? Math.max(
            0,
            Math.min(100, ((afterCompleted - newlyCompleted) / totalStreets) * 100),
          )
        : 0;
    const projectCompleted =
      progressBefore < 99.999 && progressAfter >= 99.999;

    const allOsm = [
      ...completedOsmIds,
      ...startedOsmIds,
      ...improvedOsmIds,
    ];
    const nameByOsm = await resolveStreetNames(userId, allOsm);
    const completedStreetNames = orderNames(completedOsmIds, nameByOsm);
    const startedStreetNames = orderNames(startedOsmIds, nameByOsm);
    const improvedStreetNames = orderNames(improvedOsmIds, nameByOsm);

    const shareMessage = buildShareMessage({
      activityId,
      projectId: pr.projectId,
      projectName: pr.projectName,
      sameRunProjectCount,
      completedCount: completedOsmIds.length,
      startedCount: startedOsmIds.length,
      improvedCount: improvedOsmIds.length,
      completedStreetNames,
      startedStreetNames,
      improvedStreetNames,
      projectProgressBefore: progressBefore,
      projectProgressAfter: progressAfter,
      projectCompleted,
      activityDistanceMeters: activity.distanceMeters,
      activityDurationSeconds: activity.durationSeconds,
      activityStartDate: activity.startDate,
      userTimeZone,
    });

    const existing = await prisma.runCelebrationEvent.findUnique({
      where: {
        activityId_projectId: {
          activityId,
          projectId: pr.projectId,
        },
      },
      select: { id: true, celebrationShownAt: true, sharedToStravaAt: true },
    });
    if (
      existing?.celebrationShownAt != null ||
      existing?.sharedToStravaAt != null
    ) {
      continue;
    }

    const data = {
      completedCount: completedOsmIds.length,
      startedCount: startedOsmIds.length,
      improvedCount: improvedOsmIds.length,
      completedStreetNames,
      startedStreetNames,
      improvedStreetNames,
      projectProgressBefore: progressBefore,
      projectProgressAfter: progressAfter,
      projectCompleted,
      activityDistanceMeters: activity.distanceMeters,
      activityDurationSeconds: activity.durationSeconds,
      activityStartDate: activity.startDate,
      shareMessage,
    };

    if (existing) {
      await prisma.runCelebrationEvent.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.runCelebrationEvent.create({
        data: {
          userId,
          activityId,
          projectId: pr.projectId,
          ...data,
        },
      });
    }
  }
}

export type PendingCelebrationEventDto = {
  id: string;
  activityId: string;
  projectId: string | null;
  projectName: string | null;
  completedCount: number;
  startedCount: number;
  improvedCount: number;
  completedStreetNames: string[];
  startedStreetNames: string[];
  improvedStreetNames: string[];
  projectProgressBefore: number;
  projectProgressAfter: number;
  projectCompleted: boolean;
  activityDistanceMeters: number;
  activityDurationSeconds: number;
  activityStartDate: string;
  shareMessage: string | null;
  createdAt: string;
};

export async function getPendingCelebrationBatch(userId: string): Promise<{
  events: PendingCelebrationEventDto[];
  rollup: {
    totalCompleted: number;
    totalStarted: number;
    totalImproved: number;
    activityCount: number;
    projectCount: number;
  };
}> {
  const rows = await prisma.runCelebrationEvent.findMany({
    where: {
      userId,
      celebrationShownAt: null,
      activity: { isDeleted: false },
      OR: [{ project: null }, { project: { isArchived: false } }],
    },
    include: {
      project: { select: { name: true } },
      activity: { select: { id: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const events: PendingCelebrationEventDto[] = rows.map((r) => ({
    id: r.id,
    activityId: r.activityId,
    projectId: r.projectId,
    projectName: r.project?.name ?? null,
    completedCount: r.completedCount,
    startedCount: r.startedCount,
    improvedCount: r.improvedCount,
    completedStreetNames: r.completedStreetNames,
    startedStreetNames: r.startedStreetNames,
    improvedStreetNames: r.improvedStreetNames,
    projectProgressBefore: r.projectProgressBefore,
    projectProgressAfter: r.projectProgressAfter,
    projectCompleted: r.projectCompleted,
    activityDistanceMeters: r.activityDistanceMeters,
    activityDurationSeconds: r.activityDurationSeconds,
    activityStartDate: r.activityStartDate.toISOString(),
    shareMessage: r.shareMessage,
    createdAt: r.createdAt.toISOString(),
  }));

  const activityIds = new Set(events.map((e) => e.activityId));
  const projectIds = new Set(
    events.map((e) => e.projectId).filter((id): id is string => id != null),
  );

  const rollup = {
    totalCompleted: events.reduce((s, e) => s + e.completedCount, 0),
    totalStarted: events.reduce((s, e) => s + e.startedCount, 0),
    totalImproved: events.reduce((s, e) => s + e.improvedCount, 0),
    activityCount: activityIds.size,
    projectCount: projectIds.size,
  };

  return { events, rollup };
}

export type CelebrationHistoryEntryDto = {
  /** First event id in the group; stable key for UI and share-batch replays. */
  groupKey: string;
  activityId: string;
  activityStartDate: string;
  activityDistanceMeters: number;
  activityDurationSeconds: number;
  /** Latest `createdAt` across the activity's events — drives sort order & cursor. */
  createdAt: string;
  /** True once the overlay has been shown for every event in the group. */
  acknowledged: boolean;
  /** True once the group has been posted to Strava. */
  sharedToStrava: boolean;
  rollup: {
    totalCompleted: number;
    totalStarted: number;
    totalImproved: number;
    projectCount: number;
  };
  events: PendingCelebrationEventDto[];
};

export type CelebrationHistoryPage = {
  entries: CelebrationHistoryEntryDto[];
  /** Cursor to pass as `cursor` on the next request; null when no more pages. */
  nextCursor: string | null;
};

const HISTORY_DEFAULT_LIMIT = 20;
const HISTORY_MAX_LIMIT = 50;

/**
 * Paginated history of celebration events, grouped by activity.
 *
 * Results are ordered by the most recent `createdAt` of each activity's events,
 * descending. The cursor encodes `<iso>|<activityId>` of the last returned
 * group so subsequent pages resume from the same boundary without skipping
 * ties. Optional `projectId` scopes the list to a single project's events.
 *
 * Because Prisma has no "group by with nested rows" helper, the query fetches
 * rows and groups in memory. That's safe because the unique
 * `(activityId, projectId)` constraint caps the number of rows per activity
 * at `projectCount + 1` (for a standalone null-project event).
 */
export async function getCelebrationHistory(
  userId: string,
  opts: {
    cursor?: string | null;
    limit?: number;
    projectId?: string | null;
  } = {},
): Promise<CelebrationHistoryPage> {
  const limit = Math.max(
    1,
    Math.min(HISTORY_MAX_LIMIT, opts.limit ?? HISTORY_DEFAULT_LIMIT),
  );

  const decoded = decodeHistoryCursor(opts.cursor);

  const where: Record<string, unknown> = {
    userId,
    activity: { isDeleted: false },
    OR: [{ project: null }, { project: { isArchived: false } }],
  };
  if (opts.projectId) {
    where.projectId = opts.projectId;
  }

  // Over-fetch by `limit * 3 + 1`: upper bound for rows-per-activity is small
  // (projectCount + 1), but we only want `limit` groups, so grab enough rows
  // to *always* fill a page + detect a next cursor without a second round-trip.
  const take = limit * 8 + 1;

  const rows = await prisma.runCelebrationEvent.findMany({
    where: {
      ...where,
      ...(decoded
        ? {
            OR: [
              { createdAt: { lt: decoded.createdAt } },
              {
                createdAt: decoded.createdAt,
                activityId: { lt: decoded.activityId },
              },
            ],
          }
        : {}),
    },
    include: {
      project: { select: { name: true } },
      activity: { select: { id: true } },
    },
    orderBy: [{ createdAt: "desc" }, { activityId: "desc" }],
    take,
  });

  type Row = (typeof rows)[number];
  const byActivity = new Map<string, Row[]>();
  const activityOrder: string[] = [];
  for (const row of rows) {
    const list = byActivity.get(row.activityId);
    if (list) {
      list.push(row);
    } else {
      byActivity.set(row.activityId, [row]);
      activityOrder.push(row.activityId);
    }
  }

  const groups: CelebrationHistoryEntryDto[] = [];
  for (const activityId of activityOrder) {
    const groupRows = byActivity.get(activityId)!;
    groupRows.sort((a, b) => {
      if (a.createdAt.getTime() !== b.createdAt.getTime()) {
        return b.createdAt.getTime() - a.createdAt.getTime();
      }
      return a.id.localeCompare(b.id);
    });
    const first = groupRows[0]!;
    const events: PendingCelebrationEventDto[] = groupRows.map((r) => ({
      id: r.id,
      activityId: r.activityId,
      projectId: r.projectId,
      projectName: r.project?.name ?? null,
      completedCount: r.completedCount,
      startedCount: r.startedCount,
      improvedCount: r.improvedCount,
      completedStreetNames: r.completedStreetNames,
      startedStreetNames: r.startedStreetNames,
      improvedStreetNames: r.improvedStreetNames,
      projectProgressBefore: r.projectProgressBefore,
      projectProgressAfter: r.projectProgressAfter,
      projectCompleted: r.projectCompleted,
      activityDistanceMeters: r.activityDistanceMeters,
      activityDurationSeconds: r.activityDurationSeconds,
      activityStartDate: r.activityStartDate.toISOString(),
      shareMessage: r.shareMessage,
      createdAt: r.createdAt.toISOString(),
    }));

    groups.push({
      groupKey: first.id,
      activityId,
      activityStartDate: first.activityStartDate.toISOString(),
      activityDistanceMeters: first.activityDistanceMeters,
      activityDurationSeconds: first.activityDurationSeconds,
      createdAt: first.createdAt.toISOString(),
      acknowledged: groupRows.every((r) => r.celebrationShownAt != null),
      sharedToStrava: groupRows.some((r) => r.sharedToStravaAt != null),
      rollup: {
        totalCompleted: events.reduce((s, e) => s + e.completedCount, 0),
        totalStarted: events.reduce((s, e) => s + e.startedCount, 0),
        totalImproved: events.reduce((s, e) => s + e.improvedCount, 0),
        projectCount: new Set(
          events.map((e) => e.projectId).filter((id): id is string => id != null),
        ).size,
      },
      events,
    });
  }

  // A trailing group might be incomplete if our over-fetch cut mid-activity.
  // Drop it so the caller never sees a half-grouped activity; the next page
  // will start at that activity's boundary.
  const hasMore = groups.length > limit || rows.length === take;
  const trimmed = hasMore ? groups.slice(0, limit) : groups;

  const last = trimmed[trimmed.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeHistoryCursor(new Date(last.createdAt), last.activityId)
      : null;

  return { entries: trimmed, nextCursor };
}

function encodeHistoryCursor(createdAt: Date, activityId: string): string {
  return `${createdAt.toISOString()}|${activityId}`;
}

function decodeHistoryCursor(
  raw: string | null | undefined,
): { createdAt: Date; activityId: string } | null {
  if (!raw) return null;
  const idx = raw.indexOf("|");
  if (idx < 0) return null;
  const iso = raw.slice(0, idx);
  const activityId = raw.slice(idx + 1);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || !activityId) return null;
  return { createdAt: d, activityId };
}

export async function acknowledgeCelebrations(
  userId: string,
  eventIds?: string[],
): Promise<{ updated: number }> {
  const now = new Date();
  if (eventIds?.length) {
    const result = await prisma.runCelebrationEvent.updateMany({
      where: {
        userId,
        id: { in: eventIds },
        celebrationShownAt: null,
      },
      data: { celebrationShownAt: now },
    });
    return { updated: result.count };
  }

  const result = await prisma.runCelebrationEvent.updateMany({
    where: { userId, celebrationShownAt: null },
    data: { celebrationShownAt: now },
  });
  return { updated: result.count };
}

function combineShareBodies(events: { shareMessage: string | null }[]): string {
  const bodies = events
    .map((e) => normalizeShareBody(e.shareMessage ?? ""))
    .filter(Boolean);
  return bodies.join("\n\n");
}

/**
 * Write combined celebration text to Strava for each affected activity.
 * Marks `sharedToStravaAt` on all provided events that belong to each updated activity.
 */
export async function shareBatchToStrava(
  userId: string,
  eventIds: string[],
): Promise<{ activitiesUpdated: number; eventsMarked: number }> {
  if (!eventIds.length) {
    return { activitiesUpdated: 0, eventsMarked: 0 };
  }

  const uniqueIds = [...new Set(eventIds)];

  const accessToken = await getValidStravaToken(userId);
  if (!accessToken) {
    throw new StravaApiError(
      "No valid Strava token — reconnect Strava",
      "TOKEN_INVALID",
    );
  }

  const events = await prisma.runCelebrationEvent.findMany({
    where: { userId, id: { in: uniqueIds } },
    include: {
      activity: { select: { stravaId: true } },
    },
  });

  if (events.length !== uniqueIds.length) {
    throw new Error(
      "One or more celebration events were not found or do not belong to you",
    );
  }

  const byActivity = new Map<
    string,
    typeof events
  >();
  for (const e of events) {
    const list = byActivity.get(e.activityId) ?? [];
    list.push(e);
    byActivity.set(e.activityId, list);
  }

  let activitiesUpdated = 0;
  let eventsMarked = 0;
  const now = new Date();

  for (const [, group] of byActivity) {
    const toShare = group.filter((e) => e.sharedToStravaAt == null);
    if (toShare.length === 0) continue;

    const stravaId = toShare[0]!.activity.stravaId;
    const stravaActivity = await fetchActivity(accessToken, stravaId);
    const existing = stravaActivity.description?.trim() ?? "";
    const userBase = stripAllStreetKeeperBlocks(existing);
    const celebrationBody = combineShareBodies(toShare);
    const celebrationBlock = `--- Street Keeper ---\n${celebrationBody}${STREET_KEEPER_HASHTAG_FOOTER}`;
    const description = userBase
      ? `${userBase}\n\n${celebrationBlock}`
      : celebrationBlock;

    await updateStravaActivity(accessToken, stravaId, { description });

    await prisma.runCelebrationEvent.updateMany({
      where: { id: { in: toShare.map((e) => e.id) } },
      data: { sharedToStravaAt: now },
    });

    activitiesUpdated += 1;
    eventsMarked += toShare.length;
  }

  return { activitiesUpdated, eventsMarked };
}
