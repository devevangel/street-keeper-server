/**
 * Project Suggestions Service
 *
 * Returns a focused "Next Run" payload scoped to a single project.
 * Uses the same suggestion primitives as the homepage but:
 *   - Project center/radius is always the source of truth (no lat/lng/prefs fallback).
 *   - "Your runs" stats (totals, last run, recent runs) are scoped to activities
 *     linked to this project via ProjectActivity.
 *   - No homepage-only fields (firstStreet, nearbyStreets, userState, milestones).
 *
 * Kept separate from homepage.service.ts so future project-specific panels
 * (e.g. weekly plan, milestone nudges, heatmap-driven hints) can extend this
 * without bloating the homepage payload.
 */

import prisma from "../lib/prisma.js";
import {
  getHomepageSuggestions,
  type HomepageSuggestion,
} from "./suggestion.service.js";
import { polygonCentroid } from "./geometry-cache.service.js";

/**
 * Coarse lifecycle state of the project from the suggestion engine's perspective.
 * - "preparing"   — totalStreets === 0 (street set not yet materialized)
 * - "completed"   — progress >= 100 (every logical street done)
 * - "in_progress" — anything else
 *
 * The UI branches on this to show a dedicated card instead of silently
 * rendering nothing when no runnable suggestions exist.
 */
export type ProjectState = "preparing" | "in_progress" | "completed";

export interface ProjectCompletionSummary {
  /** ISO date of the most recent project-scoped activity, if any. */
  completedAt: string | null;
  totalStreets: number;
  totalDistanceKm: number;
}

export interface ProjectSuggestionsPayload {
  primarySuggestion: HomepageSuggestion | null;
  alternates: HomepageSuggestion[];
  projectContext: {
    id: string;
    name: string;
    centerLat: number;
    centerLng: number;
    radiusMeters: number;
  };
  /** Lifecycle state — drives panel rendering on the frontend. */
  projectState: ProjectState;
  /** Present only when projectState === "completed". */
  completionSummary?: ProjectCompletionSummary;
  /** Totals scoped to activities linked to this project via ProjectActivity. */
  totalActivities: number;
  totalDistanceKm: number;
  /** Most recent project-scoped activity (for "Last run" card). */
  lastRun?: {
    activityId: string;
    date: string;
    distanceKm: number;
    newStreets: number;
    daysAgo: number;
    bbox?: [number, number, number, number];
  };
  /** Up to 5 most recent project-scoped activities (for "Recent runs" list). */
  recentRuns: Array<{
    activityId: string;
    name: string;
    date: string;
    distanceKm: number;
    bbox: [number, number, number, number];
  }>;
}

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project not found: ${id}`);
    this.name = "ProjectNotFoundError";
  }
}

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

/** Approximate bounding radius (meters) from a polygon's centroid to its farthest vertex. */
function polygonBoundingRadiusMeters(
  coords: [number, number][],
  center: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  let maxDist = 0;
  for (const [lng, lat] of coords) {
    const dLat = toRad(lat - center.lat);
    const dLng = toRad(lng - center.lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(center.lat)) *
        Math.cos(toRad(lat)) *
        Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const dist = R * c;
    if (dist > maxDist) maxDist = dist;
  }
  return Math.round(maxDist);
}

export async function getProjectSuggestionsPayload(
  userId: string,
  projectId: string,
): Promise<ProjectSuggestionsPayload> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: {
      id: true,
      name: true,
      boundaryType: true,
      centerLat: true,
      centerLng: true,
      radiusMeters: true,
      polygonCoordinates: true,
      progress: true,
      totalStreets: true,
    },
  });

  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }

  // Derive effective center + radius for suggestion engine.
  // Circle projects use stored fields; polygon projects use centroid + bounding radius.
  let centerLat: number;
  let centerLng: number;
  let radiusMeters: number;

  const boundaryType = project.boundaryType ?? "circle";

  if (boundaryType === "polygon") {
    const coords = project.polygonCoordinates as
      | [number, number][]
      | null
      | undefined;
    if (!coords || coords.length < 3) {
      throw new ProjectNotFoundError(projectId);
    }
    const centroid = polygonCentroid(coords);
    centerLat = centroid.lat;
    centerLng = centroid.lng;
    radiusMeters = polygonBoundingRadiusMeters(coords, centroid);
  } else {
    if (
      project.centerLat == null ||
      project.centerLng == null ||
      project.radiusMeters == null
    ) {
      throw new ProjectNotFoundError(projectId);
    }
    centerLat = project.centerLat;
    centerLng = project.centerLng;
    radiusMeters = project.radiusMeters;
  }

  // Coarse lifecycle — drives whether we bother computing suggestions at all.
  const projectState: ProjectState =
    project.totalStreets === 0
      ? "preparing"
      : project.progress >= 100
        ? "completed"
        : "in_progress";

  // Activities linked to this project; soft-deleted rows must never contribute
  // to totals or "last run" so the panel reflects the live state.
  const projectActivityWhere = {
    userId,
    isDeleted: false,
    projects: { some: { projectId: project.id } },
  };

  const [
    suggestions,
    totalActivities,
    totalDistanceAgg,
    recentActivitiesRaw,
    lastActivity,
  ] = await Promise.all([
    // Skip the expensive suggestion graph for terminal states. "preparing"
    // has no streets yet; "completed" has nothing left to suggest.
    projectState === "in_progress"
      ? getHomepageSuggestions(userId, {
          projectId: project.id,
          lat: centerLat,
          lng: centerLng,
          radius: radiusMeters,
        })
      : Promise.resolve(null),
    prisma.activity.count({ where: projectActivityWhere }),
    prisma.activity.aggregate({
      where: projectActivityWhere,
      _sum: { distanceMeters: true },
    }),
    prisma.activity.findMany({
      where: { ...projectActivityWhere, isProcessed: true },
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
    prisma.activity.findFirst({
      where: { ...projectActivityWhere, isProcessed: true },
      orderBy: { startDate: "desc" },
      include: {
        projects: {
          where: { projectId: project.id },
          select: {
            streetsCompleted: true,
            streetsImproved: true,
          },
        },
      },
    }),
  ]);

  const totalDistanceKm =
    totalActivities > 0
      ? Math.round(
          ((totalDistanceAgg._sum.distanceMeters ?? 0) / 1000) * 100,
        ) / 100
      : 0;

  const recentRuns = recentActivitiesRaw.flatMap((a) => {
    const coords = a.coordinates as Array<{ lat: number; lng: number }> | null;
    const bbox = bboxFromCoords(coords);
    if (!bbox) return [];
    return [
      {
        activityId: a.id,
        name: a.name,
        date: a.startDate.toISOString(),
        distanceKm: Math.round((a.distanceMeters / 1000) * 100) / 100,
        bbox,
      },
    ];
  });

  let lastRun: ProjectSuggestionsPayload["lastRun"];
  if (lastActivity) {
    const daysAgo = Math.floor(
      (Date.now() - lastActivity.startDate.getTime()) / (24 * 60 * 60 * 1000),
    );
    const newStreets =
      lastActivity.projects?.reduce(
        (sum, p) => sum + p.streetsCompleted + p.streetsImproved,
        0,
      ) ?? 0;
    const coords = lastActivity.coordinates as
      | Array<{ lat: number; lng: number }>
      | null;
    lastRun = {
      activityId: lastActivity.id,
      date: lastActivity.startDate.toISOString(),
      distanceKm:
        Math.round((lastActivity.distanceMeters / 1000) * 100) / 100,
      newStreets,
      daysAgo,
      ...(bboxFromCoords(coords) && { bbox: bboxFromCoords(coords)! }),
    };
  }

  const completionSummary: ProjectCompletionSummary | undefined =
    projectState === "completed"
      ? {
          // No dedicated Project.completedAt — last project-scoped activity is
          // a reasonable proxy for "when the project hit 100%".
          completedAt: lastActivity?.startDate.toISOString() ?? null,
          totalStreets: project.totalStreets,
          totalDistanceKm,
        }
      : undefined;

  return {
    primarySuggestion: suggestions?.primary ?? null,
    alternates: suggestions?.alternates ?? [],
    projectContext: {
      id: project.id,
      name: project.name,
      centerLat,
      centerLng,
      radiusMeters,
    },
    projectState,
    ...(completionSummary && { completionSummary }),
    totalActivities,
    totalDistanceKm,
    ...(lastRun && { lastRun }),
    recentRuns,
  };
}
