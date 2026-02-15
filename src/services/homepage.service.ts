/**
 * Homepage aggregation: single payload (hero, streak, suggestion, milestone, mapContext).
 * Resolves context: projectId > lat/lng > last viewed > null.
 */
import prisma from "../lib/prisma.js";
import { getStreak } from "./streak.service.js";
import { getNextMilestone } from "./milestone.service.js";
import { getHeroState } from "./hero.service.js";
import { getHomepageSuggestions } from "./suggestion.service.js";
import type { HomepagePayload } from "../types/homepage.types.js";

const DEFAULT_RADIUS = 1200;

export async function getHomepageData(
  userId: string,
  query: { lat?: string; lng?: string; radius?: string; projectId?: string }
): Promise<HomepagePayload> {
  const prefs = await prisma.userPreferences.findUnique({
    where: { userId },
  });

  const latNum = query.lat != null ? parseFloat(query.lat) : undefined;
  const lngNum = query.lng != null ? parseFloat(query.lng) : undefined;
  const radiusNum =
    query.radius != null ? parseInt(query.radius, 10) : DEFAULT_RADIUS;
  const projectId = query.projectId ?? undefined;

  let mapLat: number;
  let mapLng: number;
  let mapRadius: number;
  let contextProjectId: string | undefined;

  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { centerLat: true, centerLng: true, radiusMeters: true },
    });
    if (project) {
      mapLat = project.centerLat;
      mapLng = project.centerLng;
      mapRadius = project.radiusMeters;
      contextProjectId = projectId;
    } else {
      mapLat = latNum ?? prefs?.lastViewedLat ?? 0;
      mapLng = lngNum ?? prefs?.lastViewedLng ?? 0;
      mapRadius = radiusNum;
    }
  } else if (latNum != null && lngNum != null && !Number.isNaN(latNum) && !Number.isNaN(lngNum)) {
    mapLat = latNum;
    mapLng = lngNum;
    mapRadius = radiusNum;
  } else if (prefs?.lastViewedLat != null && prefs?.lastViewedLng != null) {
    mapLat = prefs.lastViewedLat;
    mapLng = prefs.lastViewedLng;
    mapRadius = prefs.lastViewedRadius ?? DEFAULT_RADIUS;
  } else {
    mapLat = 0;
    mapLng = 0;
    mapRadius = DEFAULT_RADIUS;
  }

  const timezone = prefs?.timezone ?? "UTC";

  const [streakData, nextMilestone, lastActivity, activityCount] = await Promise.all([
    getStreak(userId, timezone),
    getNextMilestone(userId, contextProjectId),
    prisma.activity.findFirst({
      where: { userId, isProcessed: true },
      orderBy: { startDate: "desc" },
      include: {
        projects: {
          select: { streetsCompleted: true, streetsImproved: true },
        },
      },
    }),
    prisma.activity.count({ where: { userId } }),
  ]);

  const lastActivityDate = lastActivity?.startDate ?? null;
  const hasAnyActivity = activityCount > 0;
  const isFirstRunRecent = activityCount === 1 && lastActivityDate != null;
  const daysSinceLast =
    lastActivityDate != null
      ? Math.floor(
          (Date.now() - lastActivityDate.getTime()) / (24 * 60 * 60 * 1000)
        )
      : null;
  const lastRunNewStreets =
    lastActivity?.projects?.reduce(
      (sum, p) => sum + p.streetsCompleted + p.streetsImproved,
      0
    ) ?? 0;

  const hero = getHeroState({
    streak: streakData,
    nextMilestone,
    lastActivityDate,
    hasAnyActivity,
    isFirstRunRecent: isFirstRunRecent && daysSinceLast != null && daysSinceLast <= 1,
    lastRunNewStreets,
  });

  const suggestions = await getHomepageSuggestions(
    userId,
    {
      projectId: contextProjectId,
      lat: mapLat,
      lng: mapLng,
      radius: mapRadius,
    },
    streakData,
    nextMilestone
  );

  const distanceKm =
    Math.round((lastActivity?.distanceMeters ?? 0) / 1000) / 100;
  const lastRun =
    lastActivityDate != null && lastActivity != null
      ? {
          date: lastActivityDate.toISOString(),
          distanceKm,
          newStreets: lastRunNewStreets,
          daysAgo: daysSinceLast ?? 0,
        }
      : undefined;

  const recentHighlights =
    lastActivityDate != null && daysSinceLast != null && daysSinceLast <= 7
      ? {
          newStreets: lastRunNewStreets,
          distanceKm,
        }
      : undefined;

  const payload: HomepagePayload = {
    hero,
    streak: streakData,
    primarySuggestion: suggestions.primary,
    alternates: suggestions.alternates,
    nextMilestone,
    mapContext: {
      lat: mapLat,
      lng: mapLng,
      radius: mapRadius,
      ...(contextProjectId && { projectId: contextProjectId }),
    },
    ...(lastRun && { lastRun }),
    ...(recentHighlights && { recentHighlights }),
  };

  return payload;
}
