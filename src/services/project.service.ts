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
import {
  PROJECTS,
  GEOMETRY_CACHE,
  isValidRadius,
  getCompletionThreshold,
} from "../config/constants.js";
import {
  queryStreetsInRadius,
  queryStreetsInPolygon,
  OverpassError,
} from "./overpass.service.js";
// Note: reverseGeocode will be enabled after migration
// import { reverseGeocode } from "./geocoding.service.js";
import {
  generateRadiusCacheKey,
  getCachedGeometries,
  setCachedGeometries,
  findLargerCachedRadius,
  filterStreetsToRadius,
  filterStreetsToRadiusStrict,
  filterStreetsToPolygon,
  filterStreetsToPolygonStrict,
  polygonCentroid,
  pointInPolygon,
} from "./geometry-cache.service.js";
import type { OsmStreet } from "../types/run.types.js";
import { getNextMilestone } from "./milestone.service.js";
import type {
  CreateProjectInput,
  PreviewProjectInput,
  ProjectPreview,
  ProjectListItem,
  ProjectDetail,
  ProjectMapData,
  ProjectMapStreet,
  ProjectHeatmapData,
  HeatmapPoint,
  SnapshotStreet,
  StreetSnapshot,
  SnapshotDiff,
  CompletionBins,
} from "../types/project.types.js";
import type { GpxPoint } from "../types/run.types.js";
import { deriveProjectProgressV2Scoped } from "../engines/v2/street-completion.js";
import { normalizeStreetName } from "../utils/normalize-street-name.js";

// ============================================
// Project Preview (Before Creation)
// ============================================

/**
 * Preview streets in an area before creating a project
 *
 * Allows users to see street count, total length, and warnings
 * before committing to create a project. Uses smart caching for circle;
 * polygon always queries Overpass (no polygon cache in v1).
 *
 * @param input - PreviewProjectInput (boundaryType + circle or polygon fields)
 * @returns Preview data including street count, length, and warnings
 * @throws OverpassError if API query fails and no cache available
 */
export async function previewProject(
  input: PreviewProjectInput
): Promise<ProjectPreview> {
  const {
    boundaryType,
    boundaryMode = "centroid",
    includeStreets = false,
  } = input;

  let filteredStreets: OsmStreet[];
  let cacheKey: string;
  let cachedRadiusMeters: number | undefined;
  let centerLat: number | undefined;
  let centerLng: number | undefined;
  let radiusMeters: number | undefined;
  let polygonCoordinates: [number, number][] | undefined;

  if (boundaryType === "circle") {
    const centerLatIn = input.centerLat;
    const centerLngIn = input.centerLng;
    const radiusMetersIn = input.radiusMeters;
    if (
      centerLatIn == null ||
      centerLngIn == null ||
      radiusMetersIn == null
    ) {
      throw new Error(
        "Circle preview requires centerLat, centerLng, and radiusMeters."
      );
    }
    const { streets, cacheKey: key, cachedRadius } = await getStreetsWithCache(
      centerLatIn,
      centerLngIn,
      radiusMetersIn
    );
    const filterFn =
      boundaryMode === "strict"
        ? filterStreetsToRadiusStrict
        : filterStreetsToRadius;
    filteredStreets = filterFn(
      streets,
      centerLatIn,
      centerLngIn,
      radiusMetersIn
    );
    cacheKey = key;
    cachedRadiusMeters = cachedRadius;
    centerLat = centerLatIn;
    centerLng = centerLngIn;
    radiusMeters = radiusMetersIn;
  } else {
    const coords = input.polygonCoordinates;
    if (!coords || coords.length < 3) {
      throw new Error(
        "Polygon preview requires polygonCoordinates with at least 3 points."
      );
    }
    const streets = await queryStreetsInPolygon(coords);
    const filterFn =
      boundaryMode === "strict"
        ? filterStreetsToPolygonStrict
        : filterStreetsToPolygon;
    filteredStreets = filterFn(streets, coords);
    cacheKey = `geo:polygon:${coords.length}:${coords
      .map((p) => p.join(","))
      .join("|")}`.slice(0, 500);
    polygonCoordinates = coords;
  }

  const totalLengthMeters = filteredStreets.reduce(
    (sum, s) => sum + s.lengthMeters,
    0
  );
  const streetsByType = groupByHighwayType(filteredStreets);
  const warnings = generatePreviewWarnings(filteredStreets);

  const byName = new Map<string, { segments: OsmStreet[]; displayName: string }>();
  for (const street of filteredStreets) {
    const key = normalizeStreetName(street.name || "Unnamed");
    if (!byName.has(key)) {
      byName.set(key, { segments: [], displayName: street.name || "Unnamed" });
    }
    byName.get(key)!.segments.push(street);
  }
  const totalStreetNames = byName.size;

  let streetsList: ProjectPreview["streets"] | undefined;
  if (includeStreets) {
    streetsList = Array.from(byName.values())
      .map((data) => {
        const firstSegment = data.segments[0];
        const mergedCoordinates = data.segments.flatMap(
          (s) => s.geometry?.coordinates ?? []
        );
        return {
          name: data.displayName,
          segmentCount: data.segments.length,
          totalLengthMeters: data.segments.reduce(
            (sum, s) => sum + s.lengthMeters,
            0
          ),
          highwayType: firstSegment?.highwayType || "unknown",
          osmId: firstSegment?.osmId,
          geometry: mergedCoordinates.length > 0
            ? { type: "LineString" as const, coordinates: mergedCoordinates }
            : undefined,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    boundaryType,
    centerLat,
    centerLng,
    radiusMeters,
    cachedRadiusMeters,
    polygonCoordinates,
    cacheKey,
    totalStreets: filteredStreets.length,
    totalStreetNames,
    totalLengthMeters: Math.round(totalLengthMeters * 100) / 100,
    streetsByType,
    warnings,
    ...(includeStreets && streetsList ? { streets: streetsList } : {}),
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
 * Create a new project for a user (circle or polygon boundary).
 */
export async function createProject(
  userId: string,
  input: CreateProjectInput,
  cacheKey?: string
): Promise<ProjectListItem> {
  const {
    name,
    boundaryType = "circle",
    boundaryMode = "centroid",
    deadline,
  } = input;

  let streets: OsmStreet[];
  let createData: {
    userId: string;
    name: string;
    boundaryType: string;
    centerLat: number | null;
    centerLng: number | null;
    radiusMeters: number | null;
    polygonCoordinates: unknown;
    boundaryMode: string;
    streetsSnapshot: object;
    snapshotDate: Date;
    totalStreets: number;
    totalLengthMeters: number;
    completedStreets: number;
    progress: number;
    deadline: Date | null;
  };

  if (boundaryType === "circle") {
    const centerLat = input.centerLat;
    const centerLng = input.centerLng;
    const radiusMeters = input.radiusMeters;
    if (
      centerLat == null ||
      centerLng == null ||
      radiusMeters == null
    ) {
      throw new Error(
        "Circle project requires centerLat, centerLng, and radiusMeters."
      );
    }
    if (!isValidRadius(radiusMeters)) {
      throw new Error(
        "Invalid radius. Must be 100–10000 meters in 100 m increments."
      );
    }
    const filterFn =
      boundaryMode === "strict"
        ? filterStreetsToRadiusStrict
        : filterStreetsToRadius;

    if (cacheKey) {
      const cached = await getCachedGeometries(cacheKey);
      if (cached) {
        streets = filterFn(cached, centerLat, centerLng, radiusMeters);
        console.log(`[Project] Using cached data from: ${cacheKey}`);
      } else {
        streets = await queryStreetsInRadius(centerLat, centerLng, radiusMeters);
        streets = filterFn(streets, centerLat, centerLng, radiusMeters);
      }
    } else {
      const result = await getStreetsWithCache(
        centerLat,
        centerLng,
        radiusMeters
      );
      streets = filterFn(result.streets, centerLat, centerLng, radiusMeters);
    }

    createData = {
      userId,
      name,
      boundaryType: "circle",
      centerLat,
      centerLng,
      radiusMeters,
      polygonCoordinates: null,
      boundaryMode,
      streetsSnapshot: {} as object,
      snapshotDate: new Date(),
      totalStreets: 0,
      totalLengthMeters: 0,
      completedStreets: 0,
      progress: 0,
      deadline: deadline ? new Date(deadline) : null,
    };
  } else {
    const polygonCoordinates = input.polygonCoordinates;
    if (!polygonCoordinates || polygonCoordinates.length < 3) {
      throw new Error(
        "Polygon project requires polygonCoordinates with at least 3 points."
      );
    }
    streets = await queryStreetsInPolygon(polygonCoordinates);
    const filterFn =
      boundaryMode === "strict"
        ? filterStreetsToPolygonStrict
        : filterStreetsToPolygon;
    streets = filterFn(streets, polygonCoordinates);

    createData = {
      userId,
      name,
      boundaryType: "polygon",
      centerLat: null,
      centerLng: null,
      radiusMeters: null,
      polygonCoordinates: polygonCoordinates as unknown,
      boundaryMode,
      streetsSnapshot: {} as object,
      snapshotDate: new Date(),
      totalStreets: 0,
      totalLengthMeters: 0,
      completedStreets: 0,
      progress: 0,
      deadline: deadline ? new Date(deadline) : null,
    };
  }

  if (streets.length === 0) {
    throw new Error(
      "No streets found in this area. Try a different location or larger area."
    );
  }

  const snapshot = buildStreetSnapshot(streets);
  const totalLengthMeters = streets.reduce((sum, s) => sum + s.lengthMeters, 0);
  const uniqueStreetNames = new Set(
    streets.map((s) => normalizeStreetName(s.name || "Unnamed"))
  );
  const totalStreetNames = uniqueStreetNames.size;

  createData.streetsSnapshot = snapshot as object;
  createData.totalStreets = streets.length;
  createData.totalLengthMeters = totalLengthMeters;

  const project = await prisma.project.create({
    data: createData,
  });

  console.log(
    `[Project] Created ${boundaryType} project "${name}" with ${streets.length} segments (${totalStreetNames} unique names) for user ${userId}`
  );

  return {
    ...mapProjectToListItem(project),
    totalStreetNames,
    completedStreetNames: 0,
  };
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

  // Calculate totalStreetNames and completedStreetNames for each project
  return projects.map((project) => {
    const snapshot = project.streetsSnapshot as StreetSnapshot;
    const { totalStreetNames, completedStreetNames } = groupSnapshotByStreetName(snapshot);
    
    return {
      ...mapProjectToListItem(project),
      totalStreetNames,
      completedStreetNames,
    };
  });
}

/**
 * Get project detail by ID.
 * @param options.includeStreets - If false (default), streets array is empty to reduce payload. Use ?include=streets to get full list.
 */
export async function getProjectById(
  projectId: string,
  userId: string,
  options?: { includeStreets?: boolean },
): Promise<{ project: ProjectDetail; warning?: string }> {
  const includeStreets = options?.includeStreets ?? false;
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

  const distanceCoveredMeters = snapshot.streets
    .filter((s) => s.percentage >= 90)
    .reduce((sum, s) => sum + s.lengthMeters, 0);

  const [activityCount, lastActivityDate, activityDates] = await Promise.all([
    prisma.projectActivity.count({ where: { projectId } }),
    prisma.projectActivity
      .findFirst({
        where: { projectId },
        orderBy: { activity: { startDate: "desc" } },
        select: { activity: { select: { startDate: true } } },
      })
      .then((pa) => pa?.activity?.startDate?.toISOString() ?? null),
    prisma.projectActivity.findMany({
      where: { projectId },
      select: { activity: { select: { startDate: true } } },
      orderBy: { activity: { startDate: "asc" } },
    }),
  ]);

  const uniqueDates = Array.from(
    new Set(
      activityDates
        .filter((pa) => pa.activity != null)
        .map((pa) => {
          const d = (pa.activity as { startDate: Date }).startDate;
          return new Date(d).toISOString().slice(0, 10);
        }),
    ),
  ).sort();

  const { currentStreak, longestStreak } = computeStreaks(uniqueDates);

  const currentProgressPct =
    project.totalStreets > 0
      ? (project.completedStreets / project.totalStreets) * 100
      : 0;
  const milestones = [25, 50, 75, 100];
  const nextTarget = milestones.find((m) => m > currentProgressPct);
  const nextMilestone =
    nextTarget != null && project.totalStreets > 0
      ? {
          target: nextTarget,
          streetsNeeded: Math.ceil(
            ((nextTarget - currentProgressPct) / 100) * project.totalStreets
          ),
          currentProgress: Math.round(currentProgressPct * 100) / 100,
        }
      : null;

  const realNextMilestone = await getNextMilestone(userId, projectId);

  const streetsByTypeMap = new Map<
    string,
    { total: number; completed: number }
  >();
  for (const s of snapshot.streets) {
    const key = s.highwayType || "unknown";
    const cur = streetsByTypeMap.get(key) ?? { total: 0, completed: 0 };
    cur.total += 1;
    if (s.percentage >= 90) cur.completed += 1;
    streetsByTypeMap.set(key, cur);
  }
  const streetsByType = Array.from(streetsByTypeMap.entries()).map(
    ([type, v]) => ({ type, total: v.total, completed: v.completed })
  );

  const {
    totalStreetNames,
    completedStreetNames,
    completionBins,
  } = groupSnapshotByStreetName(snapshot);

  // Safe pace and projected finish (avoid near-zero week span bug)
  const now = new Date();
  const createdAt = project.createdAt;
  const weeksActiveMs = now.getTime() - createdAt.getTime();
  const weeksActive = Math.max(
    weeksActiveMs / (7 * 24 * 60 * 60 * 1000),
    1,
  );
  const streetsPerWeek = project.completedStreets / weeksActive;
  const remaining = project.totalStreets - project.completedStreets;
  const weeksLeft =
    streetsPerWeek > 0 && remaining > 0 ? remaining / streetsPerWeek : null;
  const projectedFinishDate =
    weeksLeft != null
      ? new Date(
          now.getTime() + weeksLeft * 7 * 24 * 60 * 60 * 1000,
        ).toISOString()
      : null;

  const projectDetail: ProjectDetail = {
    ...mapProjectToListItem(project),
    streets: includeStreets ? snapshot.streets : [],
    snapshotDate: snapshot.snapshotDate,
    completionBins,
    totalStreetNames,
    completedStreetNames,
    inProgressCount,
    notStartedCount,
    distanceCoveredMeters: Math.round(distanceCoveredMeters * 100) / 100,
    activityCount,
    lastActivityDate,
    nextMilestone,
    realNextMilestone,
    streetsByType,
    refreshNeeded,
    daysSinceRefresh,
    streetsPerWeek: Math.round(streetsPerWeek * 100) / 100,
    projectedFinishDate,
    currentStreak,
    longestStreak,
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
  const snapshotOsmIds = new Set(snapshot.streets.map((s) => s.osmId));

  const boundaryType = (project as { boundaryType?: string }).boundaryType ?? "circle";
  const boundaryMode =
    (project as { boundaryMode?: string }).boundaryMode ?? "centroid";

  let streetsWithGeometry: OsmStreet[];
  let geometryCacheHit: boolean;

  if (boundaryType === "polygon") {
    const polygonCoordinates = (project as { polygonCoordinates?: [number, number][] })
      .polygonCoordinates;
    if (!polygonCoordinates || polygonCoordinates.length < 3) {
      throw new Error("Project has invalid polygon boundary.");
    }
    streetsWithGeometry = await queryStreetsInPolygon(polygonCoordinates);
    const filterFn =
      boundaryMode === "strict"
        ? filterStreetsToPolygonStrict
        : filterStreetsToPolygon;
    streetsWithGeometry = filterFn(streetsWithGeometry, polygonCoordinates);
    streetsWithGeometry = streetsWithGeometry.filter((s) =>
      snapshotOsmIds.has(s.osmId)
    );
    geometryCacheHit = false;
  } else {
    const centerLat = project.centerLat;
    const centerLng = project.centerLng;
    const radiusMeters = project.radiusMeters;
    if (
      centerLat == null ||
      centerLng == null ||
      radiusMeters == null
    ) {
      throw new Error("Project has invalid circle boundary.");
    }
    const filterFn =
      boundaryMode === "strict"
        ? filterStreetsToRadiusStrict
        : filterStreetsToRadius;

    const exactKey = generateRadiusCacheKey(
      centerLat,
      centerLng,
      radiusMeters
    );
    const exactCache = await getCachedGeometries(exactKey);

    if (exactCache) {
      streetsWithGeometry = filterFn(
        exactCache,
        centerLat,
        centerLng,
        radiusMeters
      );
      geometryCacheHit = true;
    } else {
      const larger = await findLargerCachedRadius(
        centerLat,
        centerLng,
        radiusMeters
      );
      if (larger) {
        streetsWithGeometry = filterFn(
          larger.streets,
          centerLat,
          centerLng,
          radiusMeters
        );
        geometryCacheHit = true;
      } else {
        streetsWithGeometry = await queryStreetsInRadius(
          centerLat,
          centerLng,
          radiusMeters
        );
        streetsWithGeometry = filterFn(
          streetsWithGeometry,
          centerLat,
          centerLng,
          radiusMeters
        );
        await setCachedGeometries(exactKey, streetsWithGeometry);
        geometryCacheHit = false;
      }
    }

    streetsWithGeometry = streetsWithGeometry.filter((s) =>
      snapshotOsmIds.has(s.osmId)
    );
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

  // Name-grouped counts so map header matches list ("X streets completed")
  // Use normalized names to handle OSM data inconsistencies
  const byNameMap = new Map<string, { completed: number; total: number }>();
  for (const st of mapStreets) {
    const key = normalizeStreetName(st.name || "Unnamed");
    const cur = byNameMap.get(key) ?? { completed: 0, total: 0 };
    cur.total += 1;
    if (st.status === "completed") cur.completed += 1;
    byNameMap.set(key, cur);
  }
  let completedStreetNames = 0;
  for (const v of byNameMap.values()) {
    if (v.total > 0 && v.completed === v.total) completedStreetNames += 1;
  }
  const totalStreetNames = byNameMap.size;

  // Propagate aggregated street status to segments so all segments of a street
  // share the same visual style on the map (e.g. all "Park Road" segments same color).
  const streetStatusByName = new Map<
    string,
    "completed" | "partial" | "not_started"
  >();
  for (const [key, v] of byNameMap) {
    if (v.total > 0 && v.completed === v.total) {
      streetStatusByName.set(key, "completed");
    } else if (v.completed > 0) {
      streetStatusByName.set(key, "partial");
    } else {
      streetStatusByName.set(key, "not_started");
    }
  }
  for (const segment of mapStreets) {
    const key = normalizeStreetName(segment.name || "Unnamed");
    const aggregatedStatus = streetStatusByName.get(key);
    if (aggregatedStatus) {
      segment.status = aggregatedStatus;
    }
  }

  // Recalculate segment counts and completion % to match propagated statuses
  completedCount = mapStreets.filter((s) => s.status === "completed").length;
  partialCount = mapStreets.filter((s) => s.status === "partial").length;
  notRunCount = mapStreets.filter((s) => s.status === "not_started").length;
  const completionPercentage =
    totalStreets > 0 ? (completedCount / totalStreets) * 100 : 0;

  const isPolygonBoundary = boundaryType === "polygon";
  const boundary = isPolygonBoundary
    ? {
        type: "polygon" as const,
        coordinates: (project as { polygonCoordinates?: [number, number][] })
          .polygonCoordinates ?? [],
      }
    : {
        type: "circle" as const,
        center: {
          lat: project.centerLat!,
          lng: project.centerLng!,
        },
        radiusMeters: project.radiusMeters!,
      };

  const mapData: ProjectMapData = {
    id: project.id,
    name: project.name,
    centerLat: project.centerLat ?? null,
    centerLng: project.centerLng ?? null,
    radiusMeters: project.radiusMeters ?? null,
    progress: Math.round(project.progress * 100) / 100,
    boundary,
    stats: {
      totalStreets,
      completedStreets: completedCount,
      partialStreets: partialCount,
      notRunStreets: notRunCount,
      completionPercentage: Math.round(completionPercentage * 100) / 100,
      totalStreetNames,
      completedStreetNames,
    },
    streets: mapStreets,
    geometryCacheHit,
  };

  return mapData;
}

/** Haversine distance in meters (for heatmap point filter) */
function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const HEATMAP_MAX_POINTS = 3000;
const HEATMAP_SAMPLE_STEP = 3;

/**
 * Get heatmap data for a project: GPS points from activities within the project boundary.
 * Returns points as [lat, lng, intensity] for use with leaflet.heat.
 */
export async function getProjectHeatmapData(
  projectId: string,
  userId: string
): Promise<ProjectHeatmapData> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }

  if (project.userId !== userId) {
    throw new ProjectAccessDeniedError(projectId);
  }

  const boundaryType = (project as { boundaryType?: string }).boundaryType ?? "circle";
  const projectActivities = await prisma.projectActivity.findMany({
    where: { projectId },
    include: {
      activity: {
        select: { coordinates: true },
      },
    },
  });

  const allPoints: HeatmapPoint[] = [];
  for (const pa of projectActivities) {
    const coords = pa.activity?.coordinates as GpxPoint[] | undefined;
    if (!Array.isArray(coords)) continue;
    for (let i = 0; i < coords.length; i += HEATMAP_SAMPLE_STEP) {
      const p = coords[i];
      const lat = typeof p?.lat === "number" ? p.lat : undefined;
      const lng = typeof p?.lng === "number" ? p.lng : undefined;
      if (lat == null || lng == null) continue;
      let inside: boolean;
      if (boundaryType === "polygon") {
        const polygonCoordinates = (project as { polygonCoordinates?: [number, number][] })
          .polygonCoordinates;
        if (!polygonCoordinates || polygonCoordinates.length < 3) continue;
        inside = pointInPolygon(lat, lng, polygonCoordinates);
      } else {
        const centerLat = project.centerLat;
        const centerLng = project.centerLng;
        const radiusMeters = project.radiusMeters;
        if (centerLat == null || centerLng == null || radiusMeters == null) continue;
        inside = haversineMeters(centerLat, centerLng, lat, lng) <= radiusMeters;
      }
      if (inside) allPoints.push([lat, lng, 1]);
    }
  }

  const points =
    allPoints.length <= HEATMAP_MAX_POINTS
      ? allPoints
      : allPoints.filter((_, i) => i % Math.ceil(allPoints.length / HEATMAP_MAX_POINTS) === 0);

  const latList = points.map((p) => p[0]);
  const lngList = points.map((p) => p[1]);
  const bounds = (() => {
    if (latList.length && lngList.length) {
      return {
        north: Math.max(...latList),
        south: Math.min(...latList),
        east: Math.max(...lngList),
        west: Math.min(...lngList),
      };
    }
    if (boundaryType === "polygon") {
      const polygonCoordinates = (project as { polygonCoordinates?: [number, number][] })
        .polygonCoordinates;
      if (polygonCoordinates?.length) {
        const centroid = polygonCentroid(polygonCoordinates);
        return {
          north: centroid.lat + 0.01,
          south: centroid.lat - 0.01,
          east: centroid.lng + 0.01,
          west: centroid.lng - 0.01,
        };
      }
    }
    const clat = project.centerLat ?? 0;
    const clng = project.centerLng ?? 0;
    return {
      north: clat + 0.01,
      south: clat - 0.01,
      east: clng + 0.01,
      west: clng - 0.01,
    };
  })();

  return { points, bounds };
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

  const boundaryType = (project as { boundaryType?: string }).boundaryType ?? "circle";
  let freshStreets: OsmStreet[];

  if (boundaryType === "polygon") {
    const polygonCoordinates = (project as { polygonCoordinates?: [number, number][] })
      .polygonCoordinates;
    if (!polygonCoordinates || polygonCoordinates.length < 3) {
      throw new Error("Project has invalid polygon boundary.");
    }
    const boundaryMode =
      (project as { boundaryMode?: string }).boundaryMode ?? "centroid";
    freshStreets = await queryStreetsInPolygon(polygonCoordinates);
    const filterFn =
      boundaryMode === "strict"
        ? filterStreetsToPolygonStrict
        : filterStreetsToPolygon;
    freshStreets = filterFn(freshStreets, polygonCoordinates);
  } else {
    const centerLat = project.centerLat;
    const centerLng = project.centerLng;
    const radiusMeters = project.radiusMeters;
    if (centerLat == null || centerLng == null || radiusMeters == null) {
      throw new Error("Project has invalid circle boundary.");
    }
    freshStreets = await queryStreetsInRadius(centerLat, centerLng, radiusMeters);
    const boundaryMode =
      (project as { boundaryMode?: string }).boundaryMode ?? "centroid";
    const filterFn =
      boundaryMode === "strict"
        ? filterStreetsToRadiusStrict
        : filterStreetsToRadius;
    freshStreets = filterFn(freshStreets, centerLat, centerLng, radiusMeters);
  }

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

  // Calculate street name-based counts
  const { totalStreetNames, completedStreetNames } =
    groupSnapshotByStreetName(newSnapshot);

  await prisma.project.update({
    where: { id: projectId },
    data: {
      streetsSnapshot: newSnapshot as object,
      snapshotDate: new Date(),
      totalStreets: newSnapshot.streets.length,
      // Note: totalStreetNames, completedStreetNames will be available after migration
      totalLengthMeters,
      completedStreets,
      progress,
    },
  });

  console.log(
    `[Project] Refreshed project "${project.name}": +${diff.added.length} added, -${diff.removed.length} removed, ${totalStreetNames} unique names (${completedStreetNames} completed)`
  );

  const { project: projectDetail } = await getProjectById(projectId, userId, {
    includeStreets: true,
  });

  return { project: projectDetail, changes: diff };
}

// ============================================
// Project Updates
// ============================================

/**
 * Archive a project (soft delete).
 * Only sets isArchived = true. Does not delete ProjectActivity, Activity, or any
 * other data; overlap detection uses includeArchived: false so new runs never
 * attach to archived projects. Use the delete-archived-project-data script to
 * remove related rows (ProjectActivity, UserMilestone) for archived projects.
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
 * Resize project radius. Re-queries streets for the new radius and merges
 * with existing snapshot, preserving progress for streets that remain inside.
 */
export async function resizeProject(
  projectId: string,
  userId: string,
  newRadiusMeters: number,
): Promise<ProjectDetail> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }

  if (project.userId !== userId) {
    throw new ProjectAccessDeniedError(projectId);
  }

  const boundaryType = (project as { boundaryType?: string }).boundaryType ?? "circle";
  if (boundaryType === "polygon") {
    throw new Error(
      "Polygon projects cannot be resized. Edit the polygon shape instead."
    );
  }

  const centerLat = project.centerLat ?? undefined;
  const centerLng = project.centerLng ?? undefined;
  const currentRadius = project.radiusMeters ?? undefined;
  if (centerLat == null || centerLng == null || currentRadius == null) {
    throw new Error("Project has invalid circle boundary.");
  }

  if (!isValidRadius(newRadiusMeters)) {
    throw new Error(
      "Invalid radius. Must be 100–10000 meters in 100 m increments.",
    );
  }

  if (currentRadius === newRadiusMeters) {
    const { project: detail } = await getProjectById(projectId, userId, {
      includeStreets: true,
    });
    return detail;
  }

  const boundaryMode =
    ((project as { boundaryMode?: string }).boundaryMode as
      | "centroid"
      | "strict") ?? "centroid";
  const filterFn =
    boundaryMode === "strict"
      ? filterStreetsToRadiusStrict
      : filterStreetsToRadius;

  const { streets: rawStreets } = await getStreetsWithCache(
    centerLat,
    centerLng,
    newRadiusMeters,
  );
  const freshStreets = filterFn(
    rawStreets,
    centerLat,
    centerLng,
    newRadiusMeters,
  );

  const oldSnapshot = project.streetsSnapshot as StreetSnapshot;
  const { newSnapshot } = mergeSnapshots(oldSnapshot, freshStreets);

  const totalLengthMeters = newSnapshot.streets.reduce(
    (sum, s) => sum + s.lengthMeters,
    0,
  );
  const completedStreets = newSnapshot.streets.filter((s) => s.completed).length;
  const progress =
    newSnapshot.streets.length > 0
      ? (completedStreets / newSnapshot.streets.length) * 100
      : 0;

  // Calculate street name-based counts
  const { totalStreetNames, completedStreetNames } =
    groupSnapshotByStreetName(newSnapshot);

  await prisma.project.update({
    where: { id: projectId },
    data: {
      radiusMeters: newRadiusMeters,
      streetsSnapshot: newSnapshot as object,
      snapshotDate: new Date(),
      totalStreets: newSnapshot.streets.length,
      totalLengthMeters,
      completedStreets,
      progress,
      // Note: totalStreetNames, completedStreetNames will be available after migration
    },
  });

  console.log(
    `[Project] Resized project "${project.name}" to ${newRadiusMeters}m (${totalStreetNames} unique names)`,
  );

  const { project: projectDetail } = await getProjectById(projectId, userId, {
    includeStreets: true,
  });
  return projectDetail;
}

/**
 * Update project progress after activity processing.
 * By default only increases percentage; pass forceUpdate: true to overwrite (e.g. recompute from V2 scoped).
 */
export async function updateProjectProgress(
  projectId: string,
  streetUpdates: Array<{
    osmId: string;
    percentage: number;
    lastRunDate: string;
  }>,
  options?: { forceUpdate?: boolean }
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }

  const snapshot = project.streetsSnapshot as StreetSnapshot;
  const forceUpdate = options?.forceUpdate === true;

  for (const update of streetUpdates) {
    const street = snapshot.streets.find((s) => s.osmId === update.osmId);
    if (street) {
      const shouldUpdate =
        forceUpdate || update.percentage > street.percentage;
      if (shouldUpdate) {
        street.percentage = update.percentage;
        street.lastRunDate = update.lastRunDate;
        // Use length-based threshold instead of hardcoded 90%
        const threshold = getCompletionThreshold(street.lengthMeters);
        street.completed = update.percentage >= threshold * 100;
      }
    }
  }

  const completedStreets = snapshot.streets.filter((s) => s.completed).length;
  const progress =
    snapshot.streets.length > 0
      ? (completedStreets / snapshot.streets.length) * 100
      : 0;

  // Calculate street name-based counts for milestones (used by milestone service)
  const { totalStreetNames, completedStreetNames } =
    groupSnapshotByStreetName(snapshot);

  await prisma.project.update({
    where: { id: projectId },
    data: {
      streetsSnapshot: snapshot as object,
      completedStreets,
      progress,
      // Note: totalStreetNames, completedStreetNames will be available after migration
    },
  });
}

/**
 * Recompute project progress from V2 scoped to runs on or after project creation.
 * Use this to fix false completions (streets that were run before the project existed).
 * Overwrites snapshot percentages and completed flags from UserNodeHit (hitAt >= project.createdAt).
 */
export async function recomputeProjectProgressFromV2(
  projectId: string,
  userId: string
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true, createdAt: true, streetsSnapshot: true },
  });

  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }

  if (project.userId !== userId) {
    throw new ProjectAccessDeniedError(projectId);
  }

  const snapshot = project.streetsSnapshot as StreetSnapshot;
  if (!snapshot?.streets?.length) {
    return;
  }

  const v2Results = await deriveProjectProgressV2Scoped(
    userId,
    snapshot.streets.map((s) => ({
      osmId: s.osmId,
      lengthMeters: s.lengthMeters ?? 0,
    })),
    project.createdAt
  );

  const snapshotByOsmId = new Map(
    snapshot.streets.map((s) => [s.osmId, s])
  );
  const streetUpdates = v2Results.map((r) => ({
    osmId: r.osmId,
    percentage: r.percentage,
    lastRunDate:
      snapshotByOsmId.get(r.osmId)?.lastRunDate ?? new Date().toISOString(),
  }));

  await updateProjectProgress(projectId, streetUpdates, {
    forceUpdate: true,
  });

  console.log(
    `[Project] Recomputed V2 scoped progress for project ${projectId}: ${streetUpdates.length} streets`
  );
}

// ============================================
// Helper Functions
// ============================================

/** Group snapshot streets by name; return counts and bins so UI matches "street" (name) not segment. */
export function groupSnapshotByStreetName(snapshot: StreetSnapshot): {
  totalStreetNames: number;
  completedStreetNames: number;
  completionBins: CompletionBins;
} {
  const byName = new Map<string, SnapshotStreet[]>();
  for (const s of snapshot.streets) {
    // Use normalized name for grouping key
    const key = normalizeStreetName(s.name || "Unnamed");
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(s);
  }
  let completed = 0;
  let almostThere = 0;
  let inProgress = 0;
  let notStarted = 0;
  for (const ways of byName.values()) {
    const totalLength = ways.reduce((sum, w) => sum + w.lengthMeters, 0);
    const weightedPct =
      totalLength > 0
        ? ways.reduce((sum, w) => sum + w.percentage * w.lengthMeters, 0) /
          totalLength
        : 0;
    if (ways.every((w) => w.completed)) {
      completed += 1;
    } else if (weightedPct >= 50 && weightedPct < 90) {
      almostThere += 1;
    } else if (weightedPct > 0 && weightedPct < 50) {
      inProgress += 1;
    } else {
      notStarted += 1;
    }
  }
  return {
    totalStreetNames: byName.size,
    completedStreetNames: completed,
    completionBins: {
      completed,
      almostThere,
      inProgress,
      notStarted,
    },
  };
}

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
  boundaryType?: string;
  centerLat: number | null;
  centerLng: number | null;
  radiusMeters: number | null;
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
    boundaryType: (project.boundaryType === "polygon" ? "polygon" : "circle") as "circle" | "polygon",
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

/**
 * Compute current streak (consecutive days ending today or yesterday) and longest streak.
 * @param uniqueDates - Sorted array of "YYYY-MM-DD" date strings
 */
function computeStreaks(
  uniqueDates: string[],
): { currentStreak: number; longestStreak: number } {
  if (uniqueDates.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const set = new Set(uniqueDates);

  let currentStreak = 0;
  let checkDate = today;
  if (set.has(today)) {
    checkDate = today;
  } else if (set.has(yesterdayStr)) {
    checkDate = yesterdayStr;
  } else {
    checkDate = "";
  }
  if (checkDate) {
    let d = new Date(checkDate + "T12:00:00Z");
    while (set.has(d.toISOString().slice(0, 10))) {
      currentStreak++;
      d.setDate(d.getDate() - 1);
    }
  }

  let longestStreak = 1;
  let run = 1;
  for (let i = 1; i < uniqueDates.length; i++) {
    const prev = new Date(uniqueDates[i - 1]! + "T12:00:00Z").getTime();
    const curr = new Date(uniqueDates[i]! + "T12:00:00Z").getTime();
    const oneDay = 24 * 60 * 60 * 1000;
    if (curr - prev === oneDay) {
      run++;
      longestStreak = Math.max(longestStreak, run);
    } else {
      run = 1;
    }
  }

  return { currentStreak, longestStreak };
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
