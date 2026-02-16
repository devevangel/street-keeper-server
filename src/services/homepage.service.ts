/**
 * Homepage aggregation: single payload (hero, streak, suggestion, milestone, mapContext).
 * Resolves context: projectId > lat/lng > last viewed > null.
 */
import prisma from "../lib/prisma.js";
import { getStreak } from "./streak.service.js";
import { getNextMilestone } from "./milestone.service.js";
import { getHeroState } from "./hero.service.js";
import { getHomepageSuggestions, getNearestShortStreet } from "./suggestion.service.js";
import type { HomepagePayload } from "../types/homepage.types.js";

const DEFAULT_RADIUS = 1200;

export async function getHomepageData(
  userId: string,
  query: { lat?: string; lng?: string; radius?: string; projectId?: string; userLat?: string; userLng?: string }
): Promise<HomepagePayload> {
  const prefs = await prisma.userPreferences.findUnique({
    where: { userId },
  });

  const latNum = query.lat != null ? parseFloat(query.lat) : undefined;
  const lngNum = query.lng != null ? parseFloat(query.lng) : undefined;
  const radiusNum =
    query.radius != null ? parseInt(query.radius, 10) : DEFAULT_RADIUS;
  const projectId = query.projectId ?? undefined;
  const userLatNum = query.userLat != null ? parseFloat(query.userLat) : undefined;
  const userLngNum = query.userLng != null ? parseFloat(query.userLng) : undefined;

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

  const [streakData, nextMilestone, lastActivity, activityCount, user] = await Promise.all([
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
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, createdAt: true },
    }),
  ]);

  const lastActivityDate = lastActivity?.startDate ?? null;
  const hasAnyActivity = activityCount > 0;
  const isNewUser = !hasAnyActivity;
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

  const distanceKm =
    Math.round((lastActivity?.distanceMeters ?? 0) / 1000) / 100;

  const hero = getHeroState({
    streak: streakData,
    nextMilestone,
    lastActivityDate,
    hasAnyActivity,
    isFirstRunRecent: isFirstRunRecent && daysSinceLast != null && daysSinceLast <= 1,
    lastRunNewStreets,
    lastRunDistanceKm: distanceKm,
    daysSinceLast,
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

  // For new users, find the nearest short street if we have their location
  let firstStreet = undefined;
  if (isNewUser && userLatNum != null && userLngNum != null && !Number.isNaN(userLatNum) && !Number.isNaN(userLngNum)) {
    firstStreet = await getNearestShortStreet(userLatNum, userLngNum, 500);
  }

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
    isNewUser,
    userName: user?.name,
    ...(firstStreet && { firstStreet }),
  };

  return payload;
}
