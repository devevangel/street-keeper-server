/**
 * Streak service: weekly discovery/running streaks.
 * Week boundaries follow ISO weeks (Mon–Sun) in the user's timezone.
 * Qualifying run: min 0.8 km OR min 8 min, and must produce at least one matched edge/street.
 */
import prisma from "../lib/prisma.js";

const MIN_DISTANCE_METERS = 800;
const MIN_DURATION_SECONDS = 8 * 60;

export interface StreakData {
  currentWeeks: number;
  isAtRisk: boolean;
  lastRunDate: string | null;
  longestStreak: number;
  qualifyingRunsThisWeek: number;
}

/**
 * Get start of ISO week (Monday) in a given timezone for a date.
 * Uses simple offset: for "UTC" we use UTC; for others we approximate with date only.
 */
function getWeekStart(date: Date, timezone: string): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Get end of ISO week (Sunday 23:59:59.999).
 */
function getWeekEnd(date: Date): Date {
  const start = getWeekStart(date, "UTC");
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

/**
 * Get set of activity IDs that have at least one project impact (street progress).
 */
async function getActivityIdsWithProgress(userId: string): Promise<Set<string>> {
  const rows = await prisma.projectActivity.findMany({
    where: {
      activity: { userId },
      OR: [
        { streetsCompleted: { gt: 0 } },
        { streetsImproved: { gt: 0 } },
      ],
    },
    select: { activityId: true },
  });
  return new Set(rows.map((r) => r.activityId));
}

/**
 * Get qualifying activities in a date range (for a user).
 */
export async function getQualifyingActivities(
  userId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<{ id: string; startDate: Date }[]> {
  const [activities, withProgress] = await Promise.all([
    prisma.activity.findMany({
      where: {
        userId,
        isProcessed: true,
        startDate: { gte: weekStart, lte: weekEnd },
      },
      select: { id: true, startDate: true, durationSeconds: true, distanceMeters: true },
    }),
    getActivityIdsWithProgress(userId),
  ]);

  return activities
    .filter(
      (a) =>
        (a.distanceMeters >= MIN_DISTANCE_METERS ||
          a.durationSeconds >= MIN_DURATION_SECONDS) &&
        withProgress.has(a.id)
    )
    .map((a) => ({ id: a.id, startDate: a.startDate }));
}

/**
 * Compute streak data for a user. Uses UTC for week boundaries (plan says user timezone;
 * we can later use UserPreferences.timezone to adjust).
 */
export async function getStreak(userId: string, timezone = "UTC"): Promise<StreakData> {
  const now = new Date();
  const currentWeekStart = getWeekStart(now, timezone);
  const currentWeekEnd = getWeekEnd(now);

  const [allProcessed, withProgress] = await Promise.all([
    prisma.activity.findMany({
      where: {
        userId,
        isProcessed: true,
        startDate: { lte: now },
      },
      select: {
        id: true,
        startDate: true,
        distanceMeters: true,
        durationSeconds: true,
      },
      orderBy: { startDate: "desc" },
    }),
    getActivityIdsWithProgress(userId),
  ]);

  const qualifyingByWeek = new Map<string, number>();
  for (const a of allProcessed) {
    if (
      (a.distanceMeters < MIN_DISTANCE_METERS &&
        a.durationSeconds < MIN_DURATION_SECONDS) ||
      !withProgress.has(a.id)
    )
      continue;
    const weekKey = getWeekStart(a.startDate, timezone).toISOString();
    qualifyingByWeek.set(weekKey, (qualifyingByWeek.get(weekKey) ?? 0) + 1);
  }

  let currentStreak = 0;
  let weekCursor = new Date(currentWeekStart);
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

  while (true) {
    const key = getWeekStart(weekCursor, timezone).toISOString();
    if ((qualifyingByWeek.get(key) ?? 0) > 0) {
      currentStreak++;
      weekCursor = new Date(weekCursor.getTime() - oneWeekMs);
    } else {
      break;
    }
  }

  const thisWeekKey = getWeekStart(now, timezone).toISOString();
  const qualifyingRunsThisWeek = qualifyingByWeek.get(thisWeekKey) ?? 0;
  const isAtRisk =
    currentStreak > 0 && qualifyingRunsThisWeek === 0 && now <= currentWeekEnd;

  let lastRunDate: string | null = null;
  for (const a of allProcessed) {
    if (
      (a.distanceMeters >= MIN_DISTANCE_METERS ||
        a.durationSeconds >= MIN_DURATION_SECONDS) &&
      withProgress.has(a.id)
    ) {
      lastRunDate = a.startDate.toISOString().slice(0, 10);
      break;
    }
  }

  let longestStreak = 0;
  const sortedWeeks = Array.from(qualifyingByWeek.keys()).sort();
  let run = 0;
  for (let i = 0; i < sortedWeeks.length; i++) {
    run++;
    if (i + 1 < sortedWeeks.length) {
      const thisStart = new Date(sortedWeeks[i]).getTime();
      const nextStart = new Date(sortedWeeks[i + 1]).getTime();
      if (nextStart < thisStart - oneWeekMs - 1) {
        longestStreak = Math.max(longestStreak, run);
        run = 0;
      }
    } else {
      longestStreak = Math.max(longestStreak, run);
    }
  }

  return {
    currentWeeks: currentStreak,
    isAtRisk,
    lastRunDate,
    longestStreak,
    qualifyingRunsThisWeek,
  };
}
