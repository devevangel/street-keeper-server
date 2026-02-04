/**
 * Project Service
 * Handles project creation, management, and preview functionality
 *
 * A Project represents a geographic area (circle) where users track street completion.
 * Users define projects by selecting a center point and radius, then the system:
 * 1. Queries OpenStreetMap for all streets in that area
 * 2. Creates a snapshot of streets with progress tracking
 * 3. Updates progress as users complete activities (runs)
 *
 * Key features:
 * - **Preview before create**: Users can see street count before committing
 * - **Smart caching**: Avoids redundant Overpass API calls
 * - **30-day refresh**: Snapshots refresh when viewed after 30 days
 * - **Progress tracking**: Each street has completion percentage (0-100%)
 *
 * @example
 * // Preview before creating
 * const preview = await previewProject(50.788, -1.089, 2000);
 * console.log(`${preview.totalStreets} streets, ${preview.totalLengthMeters}m`);
 *
 * // Create project using cached preview data
 * const project = await createProject(userId, { name: "My Project", ... }, preview.cacheKey);
 */

import prisma from "../lib/prisma.js";
import { PROJECTS, GEOMETRY_CACHE } from "../config/constants.js";
import { queryStreetsInRadius, OverpassError } from "./overpass.service.js";
import {
  generateRadiusCacheKey,
  getCachedGeometries,
  setCachedGeometries,
  findLargerCachedRadius,
  filterStreetsToRadius,
} from "./geometry-cache.service.js";
import type { OsmStreet } from "../types/run.types.js";
import type {
  CreateProjectInput,
  ProjectPreview,
  ProjectListItem,
  ProjectDetail,
  ProjectMapData,
  ProjectMapStreet,
  SnapshotStreet,
  StreetSnapshot,
  SnapshotDiff,
} from "../types/project.types.js";

// ============================================
// Project Preview (Before Creation)
// ============================================

/**
 * Preview streets in an area before creating a project
 *
 * Allows users to see street count, total length, and warnings
 * before committing to create a project. Uses smart caching:
 * - Checks for exact cache match first
 * - Falls back to filtering from larger cached radius
 * - Only queries Overpass if no suitable cache exists
 *
 * @param centerLat - Center latitude of the project
 * @param centerLng - Center longitude of the project
 * @param radiusMeters - Radius in meters (must be in PROJECTS.ALLOWED_RADII)
 * @returns Preview data including street count, length, and warnings
 * @throws OverpassError if API query fails and no cache available
 */
export async function previewProject(
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): Promise<ProjectPreview> {
  // Get streets with smart caching
  const { streets, cacheKey, cachedRadius } = await getStreetsWithCache(
    centerLat,
    centerLng,
    radiusMeters
  );

  // Filter to requested radius if cache was larger
  const filteredStreets =
    cachedRadius > radiusMeters
      ? filterStreetsToRadius(streets, centerLat, centerLng, radiusMeters)
      : streets;

  // Build summary statistics
  const totalLengthMeters = filteredStreets.reduce(
    (sum, s) => sum + s.lengthMeters,
    0
  );
  const streetsByType = groupByHighwayType(filteredStreets);

  // Generate warnings
  const warnings = generatePreviewWarnings(filteredStreets);

  return {
    centerLat,
    centerLng,
    radiusMeters,
    cachedRadiusMeters: cachedRadius,
    cacheKey,
    totalStreets: filteredStreets.length,
    totalLengthMeters: Math.round(totalLengthMeters * 100) / 100,
    streetsByType,
    warnings,
  };
}

/**
 * Get streets with smart caching strategy
 */
async function getStreetsWithCache(
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): Promise<{ streets: OsmStreet[]; cacheKey: string; cachedRadius: number }> {
  const exactKey = generateRadiusCacheKey(centerLat, centerLng, radiusMeters);
  const exactCache = await getCachedGeometries(exactKey);

  if (exactCache) {
    console.log(`[Project] Exact cache hit for ${radiusMeters}m radius`);
    return {
      streets: exactCache,
      cacheKey: exactKey,
      cachedRadius: radiusMeters,
    };
  }

  const largerCache = await findLargerCachedRadius(
    centerLat,
    centerLng,
    radiusMeters
  );

  if (largerCache) {
    console.log(
      `[Project] Using larger cache (${largerCache.cachedRadius}m) for ${radiusMeters}m request`
    );
    return largerCache;
  }

  console.log(
    `[Project] Cache miss, querying Overpass for ${radiusMeters}m radius`
  );
  const streets = await queryStreetsInRadius(
    centerLat,
    centerLng,
    radiusMeters
  );
  await setCachedGeometries(exactKey, streets);

  return {
    streets,
    cacheKey: exactKey,
    cachedRadius: radiusMeters,
  };
}

// ============================================
// Project Creation
// ============================================

/**
 * Create a new project for a user
 */
export async function createProject(
  userId: string,
  input: CreateProjectInput,
  cacheKey?: string
): Promise<ProjectListItem> {
  const { name, centerLat, centerLng, radiusMeters, deadline } = input;

  if (
    !PROJECTS.ALLOWED_RADII.includes(
      radiusMeters as (typeof PROJECTS.ALLOWED_RADII)[number]
    )
  ) {
    throw new Error(
      `Invalid radius. Must be one of: ${PROJECTS.ALLOWED_RADII.join(", ")}`
    );
  }

  let streets: OsmStreet[];

  if (cacheKey) {
    const cached = await getCachedGeometries(cacheKey);
    if (cached) {
      streets = filterStreetsToRadius(
        cached,
        centerLat,
        centerLng,
        radiusMeters
      );
      console.log(`[Project] Using cached data from: ${cacheKey}`);
    } else {
      console.log(`[Project] Cache key invalid/expired, querying Overpass`);
      streets = await queryStreetsInRadius(centerLat, centerLng, radiusMeters);
    }
  } else {
    const result = await getStreetsWithCache(
      centerLat,
      centerLng,
      radiusMeters
    );
    streets =
      result.cachedRadius > radiusMeters
        ? filterStreetsToRadius(
            result.streets,
            centerLat,
            centerLng,
            radiusMeters
          )
        : result.streets;
  }

  if (streets.length === 0) {
    throw new Error(
      "No streets found in this area. Try a different location or larger radius."
    );
  }

  const snapshot = buildStreetSnapshot(streets);
  const totalLengthMeters = streets.reduce((sum, s) => sum + s.lengthMeters, 0);

  const project = await prisma.project.create({
    data: {
      userId,
      name,
      centerLat,
      centerLng,
      radiusMeters,
      streetsSnapshot: snapshot as object,
      snapshotDate: new Date(),
      totalStreets: streets.length,
      totalLengthMeters,
      completedStreets: 0,
      progress: 0,
      deadline: deadline ? new Date(deadline) : null,
    },
  });

  console.log(
    `[Project] Created project "${name}" with ${streets.length} streets for user ${userId}`
  );

  return mapProjectToListItem(project);
}

// ============================================
// Project Reading
// ============================================

/**
 * Get all projects for a user (list view)
 */
export async function listProjects(
  userId: string,
  includeArchived = false
): Promise<ProjectListItem[]> {
  const projects = await prisma.project.findMany({
    where: {
      userId,
      ...(includeArchived ? {} : { isArchived: false }),
    },
    orderBy: { createdAt: "desc" },
  });

  return projects.map(mapProjectToListItem);
}

/**
 * Get project detail by ID
 */
export async function getProjectById(
  projectId: string,
  userId: string
): Promise<{ project: ProjectDetail; warning?: string }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }

  if (project.userId !== userId) {
    throw new ProjectAccessDeniedError(projectId);
  }

  const daysSinceRefresh = getDaysSinceDate(project.snapshotDate);
  const refreshNeeded = daysSinceRefresh >= PROJECTS.SNAPSHOT_REFRESH_DAYS;

  const snapshot = project.streetsSnapshot as StreetSnapshot;

  const inProgressCount = snapshot.streets.filter(
    (s) => s.percentage > 0 && s.percentage < 90
  ).length;
  const notStartedCount = snapshot.streets.filter(
    (s) => s.percentage === 0
  ).length;
  const newStreetsDetected = snapshot.streets.filter((s) => s.isNew).length;

  const projectDetail: ProjectDetail = {
    ...mapProjectToListItem(project),
    streets: snapshot.streets,
    snapshotDate: snapshot.snapshotDate,
    inProgressCount,
    notStartedCount,
    refreshNeeded,
    daysSinceRefresh,
    ...(newStreetsDetected > 0 ? { newStreetsDetected } : {}),
  };

  const warning = refreshNeeded
    ? `Street data is ${daysSinceRefresh} days old. Consider refreshing.`
    : undefined;

  return { project: projectDetail, warning };
}

// ============================================
// Project Map Data
// ============================================

const MAP_COMPLETION_THRESHOLD = 90;

/**
 * Get project-scoped map data: streets with geometry and status for map rendering.
 *
 * Fetches street geometries from cache (or Overpass if cache miss), merges with
 * project snapshot progress, and returns streets with status (completed / partial / not_started)
 * and GeoJSON LineString geometry.
 *
 * @param projectId - Project UUID
 * @param userId - Authenticated user ID (must own the project)
 * @returns ProjectMapData with boundary, stats, and streets with geometry
 * @throws ProjectNotFoundError if project does not exist
 * @throws ProjectAccessDeniedError if user does not own the project
 */
export async function getProjectMapData(
  projectId: string,
  userId: string
): Promise<ProjectMapData> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }

  if (project.userId !== userId) {
    throw new ProjectAccessDeniedError(projectId);
  }

  const snapshot = project.streetsSnapshot as StreetSnapshot;
  const progressByOsmId = new Map(
    snapshot.streets.map((s) => [s.osmId, { percentage: s.percentage }])
  );

  let streetsWithGeometry: OsmStreet[];
  let geometryCacheHit: boolean;

  const exactKey = generateRadiusCacheKey(
    project.centerLat,
    project.centerLng,
    project.radiusMeters
  );
  const exactCache = await getCachedGeometries(exactKey);

  if (exactCache) {
    streetsWithGeometry = exactCache;
    geometryCacheHit = true;
  } else {
    const larger = await findLargerCachedRadius(
      project.centerLat,
      project.centerLng,
      project.radiusMeters
    );
    if (larger) {
      streetsWithGeometry = filterStreetsToRadius(
        larger.streets,
        project.centerLat,
        project.centerLng,
        project.radiusMeters
      );
      geometryCacheHit = true;
    } else {
      streetsWithGeometry = await queryStreetsInRadius(
        project.centerLat,
        project.centerLng,
        project.radiusMeters
      );
      await setCachedGeometries(exactKey, streetsWithGeometry);
      geometryCacheHit = false;
    }
  }

  let completedCount = 0;
  let partialCount = 0;
  let notRunCount = 0;

  const mapStreets: ProjectMapStreet[] = streetsWithGeometry.map((osm) => {
    const progress = progressByOsmId.get(osm.osmId);
    const percentage = progress?.percentage ?? 0;

    let status: ProjectMapStreet["status"];
    if (percentage >= MAP_COMPLETION_THRESHOLD) {
      status = "completed";
      completedCount++;
    } else if (percentage > 0) {
      status = "partial";
      partialCount++;
    } else {
      status = "not_started";
      notRunCount++;
    }

    return {
      osmId: osm.osmId,
      name: osm.name,
      highwayType: osm.highwayType,
      lengthMeters: osm.lengthMeters,
      percentage: Math.round(percentage * 100) / 100,
      status,
      geometry: osm.geometry,
    };
  });

  const totalStreets = mapStreets.length;
  const completionPercentage =
    totalStreets > 0 ? (completedCount / totalStreets) * 100 : 0;

  const mapData: ProjectMapData = {
    id: project.id,
    name: project.name,
    centerLat: project.centerLat,
    centerLng: project.centerLng,
    radiusMeters: project.radiusMeters,
    progress: Math.round(project.progress * 100) / 100,
    boundary: {
      type: "circle",
      center: { lat: project.centerLat, lng: project.centerLng },
      radiusMeters: project.radiusMeters,
    },
    stats: {
      totalStreets,
      completedStreets: completedCount,
      partialStreets: partialCount,
      notRunStreets: notRunCount,
      completionPercentage: Math.round(completionPercentage * 100) / 100,
    },
    streets: mapStreets,
    geometryCacheHit,
  };

  return mapData;
}

// ============================================
// Project Refresh
// ============================================

/**
 * Refresh project's street snapshot from OpenStreetMap
 */
export async function refreshProjectSnapshot(
  projectId: string,
  userId: string
): Promise<{ project: ProjectDetail; changes: SnapshotDiff }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }

  if (project.userId !== userId) {
    throw new ProjectAccessDeniedError(projectId);
  }

  const freshStreets = await queryStreetsInRadius(
    project.centerLat,
    project.centerLng,
    project.radiusMeters
  );

  const oldSnapshot = project.streetsSnapshot as StreetSnapshot;
  const { newSnapshot, diff } = mergeSnapshots(oldSnapshot, freshStreets);

  const totalLengthMeters = newSnapshot.streets.reduce(
    (sum, s) => sum + s.lengthMeters,
    0
  );
  const completedStreets = newSnapshot.streets.filter(
    (s) => s.completed
  ).length;
  const progress =
    newSnapshot.streets.length > 0
      ? (completedStreets / newSnapshot.streets.length) * 100
      : 0;

  await prisma.project.update({
    where: { id: projectId },
    data: {
      streetsSnapshot: newSnapshot as object,
      snapshotDate: new Date(),
      totalStreets: newSnapshot.streets.length,
      totalLengthMeters,
      completedStreets,
      progress,
    },
  });

  console.log(
    `[Project] Refreshed project "${project.name}": +${diff.added.length} added, -${diff.removed.length} removed`
  );

  const { project: projectDetail } = await getProjectById(projectId, userId);

  return { project: projectDetail, changes: diff };
}

// ============================================
// Project Updates
// ============================================

/**
 * Archive a project (soft delete)
 */
export async function archiveProject(
  projectId: string,
  userId: string
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }

  if (project.userId !== userId) {
    throw new ProjectAccessDeniedError(projectId);
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { isArchived: true },
  });

  console.log(`[Project] Archived project "${project.name}"`);
}

/**
 * Update project progress after activity processing
 */
export async function updateProjectProgress(
  projectId: string,
  streetUpdates: Array<{
    osmId: string;
    percentage: number;
    lastRunDate: string;
  }>
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }

  const snapshot = project.streetsSnapshot as StreetSnapshot;

  for (const update of streetUpdates) {
    const street = snapshot.streets.find((s) => s.osmId === update.osmId);
    if (street) {
      if (update.percentage > street.percentage) {
        street.percentage = update.percentage;
        street.lastRunDate = update.lastRunDate;
        street.completed = update.percentage >= 90;
      }
    }
  }

  const completedStreets = snapshot.streets.filter((s) => s.completed).length;
  const progress =
    snapshot.streets.length > 0
      ? (completedStreets / snapshot.streets.length) * 100
      : 0;

  await prisma.project.update({
    where: { id: projectId },
    data: {
      streetsSnapshot: snapshot as object,
      completedStreets,
      progress,
    },
  });
}

// ============================================
// Helper Functions
// ============================================

function buildStreetSnapshot(streets: OsmStreet[]): StreetSnapshot {
  const snapshotStreets: SnapshotStreet[] = streets.map((street) => ({
    osmId: street.osmId,
    name: street.name,
    lengthMeters: Math.round(street.lengthMeters * 100) / 100,
    highwayType: street.highwayType,
    completed: false,
    percentage: 0,
    lastRunDate: null,
  }));

  return {
    streets: snapshotStreets,
    snapshotDate: new Date().toISOString(),
  };
}

function mergeSnapshots(
  oldSnapshot: StreetSnapshot,
  freshStreets: OsmStreet[]
): { newSnapshot: StreetSnapshot; diff: SnapshotDiff } {
  const oldMap = new Map(oldSnapshot.streets.map((s) => [s.osmId, s]));
  const freshMap = new Map(freshStreets.map((s) => [s.osmId, s]));

  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];
  const newStreets: SnapshotStreet[] = [];

  for (const freshStreet of freshStreets) {
    const existing = oldMap.get(freshStreet.osmId);

    if (existing) {
      unchanged.push(freshStreet.osmId);
      newStreets.push({
        ...existing,
        name: freshStreet.name,
        lengthMeters: Math.round(freshStreet.lengthMeters * 100) / 100,
        highwayType: freshStreet.highwayType,
        isNew: false,
      });
    } else {
      added.push(freshStreet.osmId);
      newStreets.push({
        osmId: freshStreet.osmId,
        name: freshStreet.name,
        lengthMeters: Math.round(freshStreet.lengthMeters * 100) / 100,
        highwayType: freshStreet.highwayType,
        completed: false,
        percentage: 0,
        lastRunDate: null,
        isNew: true,
      });
    }
  }

  for (const oldStreet of oldSnapshot.streets) {
    if (!freshMap.has(oldStreet.osmId)) {
      removed.push(oldStreet.osmId);
    }
  }

  return {
    newSnapshot: {
      streets: newStreets,
      snapshotDate: new Date().toISOString(),
    },
    diff: { added, removed, unchanged },
  };
}

function mapProjectToListItem(project: {
  id: string;
  name: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  progress: number;
  totalStreets: number;
  completedStreets: number;
  totalLengthMeters: number;
  deadline: Date | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ProjectListItem {
  return {
    id: project.id,
    name: project.name,
    centerLat: project.centerLat,
    centerLng: project.centerLng,
    radiusMeters: project.radiusMeters,
    progress: Math.round(project.progress * 100) / 100,
    totalStreets: project.totalStreets,
    completedStreets: project.completedStreets,
    totalLengthMeters: Math.round(project.totalLengthMeters * 100) / 100,
    deadline: project.deadline?.toISOString() ?? null,
    isArchived: project.isArchived,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function groupByHighwayType(streets: OsmStreet[]): Record<string, number> {
  const groups: Record<string, number> = {};
  for (const street of streets) {
    const type = street.highwayType;
    groups[type] = (groups[type] || 0) + 1;
  }
  return groups;
}

function generatePreviewWarnings(streets: OsmStreet[]): string[] {
  const warnings: string[] = [];

  if (streets.length > PROJECTS.MAX_STREETS_WARNING) {
    warnings.push(
      `Large area: ${streets.length} streets found. Consider reducing radius for a more manageable goal.`
    );
  }

  const nonRunnable = streets.filter((s) =>
    PROJECTS.NON_RUNNABLE_HIGHWAYS.includes(s.highwayType)
  );
  if (nonRunnable.length > 0) {
    warnings.push(
      `Area includes ${nonRunnable.length} major roads (motorway/trunk) that may not be runnable.`
    );
  }

  if (streets.length === 0) {
    warnings.push("No streets found in this area. Try a different location.");
  }

  return warnings;
}

function getDaysSinceDate(date: Date): number {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// ============================================
// Custom Error Classes
// ============================================

/**
 * Error thrown when project is not found
 */
export class ProjectNotFoundError extends Error {
  public projectId: string;

  constructor(projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = "ProjectNotFoundError";
    this.projectId = projectId;
  }
}

/**
 * Error thrown when user doesn't have access to project
 */
export class ProjectAccessDeniedError extends Error {
  public projectId: string;

  constructor(projectId: string) {
    super(`Access denied to project: ${projectId}`);
    this.name = "ProjectAccessDeniedError";
    this.projectId = projectId;
  }
}
