/**
 * Homepage aggregation: single payload (suggestion, milestone, mapContext).
 * Resolves context: projectId > lat/lng > last viewed > null.
 */
import prisma from "../lib/prisma.js";
import { getNextMilestone } from "./milestone.service.js";
import { getHomepageSuggestions, getNearestShortStreets } from "./suggestion.service.js";
import type { HomepagePayload, UserState } from "../types/homepage.types.js";
import type { ActivityImpact } from "../types/activity.types.js";
import type { MapStreet } from "../types/map.types.js";

function bboxFromCoords(
  coords: Array<{ lat: number; lng: number }> | null | undefined,
): [number, number, number, number] | undefined {
  if (!coords || coords.length === 0) return undefined;
  const lats = coords.map((c) => c.lat);
  const lngs = coords.map((c) => c.lng);
  return [
    Math.min(...lats),
    Math.min(...lngs),
    Math.max(...lats),
    Math.max(...lngs),
  ];
}

function buildOsmIdToNameFromSegments(segments: MapStreet[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of segments) {
    if (s.osmId && s.name) m.set(s.osmId, s.name);
  }
  return m;
}

function collectStreetNamesFromImpacts(
  impacts: (ActivityImpact | null | undefined)[],
  osmIdToName: Map<string, string>,
): { completed: string[]; improved: string[] } {
  const completed: string[] = [];
  const improved: string[] = [];
  const seenC = new Set<string>();
  const seenI = new Set<string>();
  for (const impact of impacts) {
    if (!impact) continue;
    if (Array.isArray(impact.completed)) {
      for (const id of impact.completed) {
        const label = osmIdToName.get(id) ?? id;
        if (!seenC.has(label)) {
          seenC.add(label);
          completed.push(label);
        }
      }
    }
    for (const imp of impact.improved ?? []) {
      const label = osmIdToName.get(imp.osmId) ?? imp.osmId;
      if (!seenI.has(label)) {
        seenI.add(label);
        improved.push(label);
      }
    }
  }
  return { completed, improved };
}

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
    recentActivitiesRaw,
    projectForContext,
  ] = await Promise.all([
    prisma.activity.findFirst({
      where: { userId, isProcessed: true },
      orderBy: { startDate: "desc" },
      include: {
        projects: {
          select: {
            streetsCompleted: true,
            streetsImproved: true,
            impactDetails: true,
          },
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
    prisma.activity.findMany({
      where: { userId, isProcessed: true },
      orderBy: { startDate: "desc" },
      take: 5,
      select: {
        id: true,
        name: true,
        distanceMeters: true,
        startDate: true,
        coordinates: true,
      },
    }),
    contextProjectId
      ? prisma.project.findFirst({
          where: { id: contextProjectId, userId },
          select: {
            id: true,
            name: true,
            totalStreets: true,
            completedStreets: true,
            progress: true,
          },
        })
      : Promise.resolve(null),
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

  const mapSegments =
    suggestions?.mapStreetsResponse?.segments?.length
      ? suggestions.mapStreetsResponse.segments
      : undefined;

  const osmIdToName =
    mapSegments && mapSegments.length > 0
      ? buildOsmIdToNameFromSegments(mapSegments)
      : new Map<string, string>();

  const impactList =
    lastActivity?.projects?.map(
      (p) => p.impactDetails as ActivityImpact | null | undefined,
    ) ?? [];
  const { completed: completedStreetNames, improved: improvedStreetNames } =
    collectStreetNamesFromImpacts(impactList, osmIdToName);

  const lastCoords = lastActivity?.coordinates as
    | Array<{ lat: number; lng: number }>
    | null
    | undefined;
  const lastBbox = bboxFromCoords(lastCoords ?? undefined);

  const lastRun =
    lastActivityDate != null && lastActivity != null
      ? {
          date: lastActivityDate.toISOString(),
          distanceKm,
          newStreets: lastRunNewStreets,
          daysAgo: daysSinceLast ?? 0,
          activityId: lastActivity.id,
          ...(completedStreetNames.length > 0 && { completedStreetNames }),
          ...(improvedStreetNames.length > 0 && { improvedStreetNames }),
          ...(lastBbox && { bbox: lastBbox }),
        }
      : undefined;

  let nearbyStreets: HomepagePayload["nearbyStreets"];
  let firstStreet: HomepagePayload["firstStreet"];
  if (
    (userState === "brand_new" || userState === "has_runs_no_project") &&
    userLatNum != null &&
    userLngNum != null &&
    !Number.isNaN(userLatNum) &&
    !Number.isNaN(userLngNum)
  ) {
    const list = await getNearestShortStreets(userLatNum, userLngNum, 500, 5);
    if (list.length > 0) {
      nearbyStreets = list;
      firstStreet = list[0];
    }
  }

  const totalDistanceKm =
    activityCount > 0
      ? Math.round(((totalDistanceResult._sum.distanceMeters ?? 0) / 1000) * 100) / 100
      : undefined;

  const recentRuns = recentActivitiesRaw.map((a) => {
    const coords = a.coordinates as Array<{ lat: number; lng: number }> | null;
    let bbox = bboxFromCoords(coords ?? undefined);
    if (!bbox && mapLat !== 0 && mapLng !== 0) {
      const d = 0.002;
      bbox = [mapLat - d, mapLng - d, mapLat + d, mapLng + d];
    }
    return {
      activityId: a.id,
      name: a.name,
      date: a.startDate.toISOString(),
      distanceKm: Math.round((a.distanceMeters / 1000) * 100) / 100,
      bbox: bbox ?? ([0, 0, 0, 0] as [number, number, number, number]),
    };
  });

  const areaStats = suggestions?.mapStreetsResponse
    ? {
        totalStreets: suggestions.mapStreetsResponse.totalStreets,
        completedCount: suggestions.mapStreetsResponse.completedCount,
        partialCount: suggestions.mapStreetsResponse.partialCount,
      }
    : undefined;

  const projectContext = projectForContext
    ? {
        id: projectForContext.id,
        name: projectForContext.name,
        totalStreets: projectForContext.totalStreets,
        completedStreets: projectForContext.completedStreets,
        progress: Math.round(projectForContext.progress * 100) / 100,
      }
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
    ...(activityCount > 0 && {
      totalActivities: activityCount,
      totalDistanceKm,
    }),
    userName: user?.name,
    ...(firstStreet && { firstStreet }),
    ...(nearbyStreets && nearbyStreets.length > 0 && { nearbyStreets }),
    ...(recentRuns.length > 0 && { recentRuns }),
    ...(areaStats && { areaStats }),
    ...(projectContext && { projectContext }),
  };

  return payload;
}
