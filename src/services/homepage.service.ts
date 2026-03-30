/**
 * Homepage aggregation: single payload (suggestion, milestone, mapContext).
 * Resolves context: projectId > lat/lng > last viewed > null.
 */
import prisma from "../lib/prisma.js";
import { getNextMilestone } from "./milestone.service.js";
import { getHomepageSuggestions, getNearestShortStreet } from "./suggestion.service.js";
import type { HomepagePayload, UserState } from "../types/homepage.types.js";

const DEFAULT_RADIUS = 1200;

function computeUserState(
  activityCount: number,
  activeSyncJob: boolean,
  activeProjectCount: number,
  anyProjectHasProgress: boolean,
): UserState {
  if (activityCount === 0) {
    return activeSyncJob ? "syncing" : "brand_new";
  }
  if (activeProjectCount === 0) return "has_runs_no_project";
  if (!anyProjectHasProgress) return "project_processing";
  return "active";
}

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
  } else if (userLatNum != null && userLngNum != null && !Number.isNaN(userLatNum) && !Number.isNaN(userLngNum)) {
    mapLat = userLatNum;
    mapLng = userLngNum;
    mapRadius = DEFAULT_RADIUS;
  } else {
    const recentActivity = await prisma.activity.findFirst({
      where: { userId },
      orderBy: { startDate: "desc" },
      select: { coordinates: true },
    });
    const coords = recentActivity?.coordinates as Array<{ lat: number; lng: number }> | null;
    if (coords && coords.length > 0) {
      mapLat = coords[0].lat;
      mapLng = coords[0].lng;
    } else {
      mapLat = 0;
      mapLng = 0;
    }
    mapRadius = DEFAULT_RADIUS;
  }

  const [
    lastActivity,
    activityCount,
    user,
    activeSyncJob,
    activeProjectCount,
    projectsWithProgressCount,
    totalDistanceResult,
  ] = await Promise.all([
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
    prisma.syncJob.findFirst({
      where: { userId, status: { in: ["queued", "running"] } },
      select: { id: true },
    }),
    prisma.project.count({
      where: { userId, isArchived: false },
    }),
    prisma.project.count({
      where: { userId, isArchived: false, completedStreets: { gt: 0 } },
    }),
    prisma.activity.aggregate({
      where: { userId },
      _sum: { distanceMeters: true },
    }),
  ]);

  const userState = computeUserState(
    activityCount,
    activeSyncJob != null,
    activeProjectCount,
    projectsWithProgressCount > 0,
  );

  const lastActivityDate = lastActivity?.startDate ?? null;
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
    Math.round(((lastActivity?.distanceMeters ?? 0) / 1000) * 100) / 100;

  const hasRealLocation = mapLat !== 0 || mapLng !== 0;
  const suggestions = hasRealLocation
    ? await getHomepageSuggestions(userId, {
        projectId: contextProjectId,
        lat: mapLat,
        lng: mapLng,
        radius: mapRadius,
      })
    : null;

  const nextMilestone = suggestions
    ? suggestions.nextMilestone
    : await getNextMilestone(userId, contextProjectId);

  const lastRun =
    lastActivityDate != null && lastActivity != null
      ? {
          date: lastActivityDate.toISOString(),
          distanceKm,
          newStreets: lastRunNewStreets,
          daysAgo: daysSinceLast ?? 0,
        }
      : undefined;

  let firstStreet = undefined;
  if (
    (userState === "brand_new" || userState === "has_runs_no_project") &&
    userLatNum != null &&
    userLngNum != null &&
    !Number.isNaN(userLatNum) &&
    !Number.isNaN(userLngNum)
  ) {
    firstStreet = await getNearestShortStreet(userLatNum, userLngNum, 500);
  }

  const mapSegments =
    suggestions?.mapStreetsResponse?.segments?.length
      ? suggestions.mapStreetsResponse.segments
      : undefined;

  const totalDistanceKm =
    userState === "has_runs_no_project"
      ? Math.round(((totalDistanceResult._sum.distanceMeters ?? 0) / 1000) * 100) / 100
      : undefined;

  const payload: HomepagePayload = {
    primarySuggestion: suggestions?.primary ?? null,
    alternates: suggestions?.alternates ?? [],
    nextMilestone,
    mapContext: {
      lat: mapLat,
      lng: mapLng,
      radius: mapRadius,
      ...(contextProjectId && { projectId: contextProjectId }),
    },
    ...(mapSegments && mapSegments.length > 0 && { mapSegments }),
    ...(lastRun && { lastRun }),
    userState,
    ...(userState === "has_runs_no_project" && {
      totalActivities: activityCount,
      totalDistanceKm,
    }),
    userName: user?.name,
    ...(firstStreet && { firstStreet }),
  };

  return payload;
}
