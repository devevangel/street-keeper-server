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
  isValidRadius,
  getCompletionThreshold,
} from "../config/constants.js";
import { ensureCitySynced } from "./city-sync.service.js";
import {
  getLocalStreetsInRadius,
  getLocalStreetsInPolygonFiltered,
} from "./local-streets.service.js";
import {
  generateRadiusCacheKey,
  resolveRadiusFilter,
  resolvePolygonFilter,
  polygonCentroid,
  pointInPolygon,
} from "./geometry-cache.service.js";
import type { OsmStreet } from "../types/run.types.js";
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
import { deriveProjectProgressV2Scoped, osmIdToWayId, deriveStreetCompletionForArea } from "../engines/v2/street-completion.js";
import { normalizeStreetName } from "../utils/normalize-street-name.js";
import { isUnnamedStreet } from "../engines/v1/street-aggregation.js";
import { STREET_AGGREGATION } from "../config/constants.js";

// In-memory cache for project map geometry to avoid duplicate Overpass calls
// (React StrictMode fires effects twice; users revisiting a project reuse cached geometry)
const projectGeometryCache = new Map<string, { streets: OsmStreet[]; timestamp: number }>();
const PROJECT_GEO_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PROJECT_GEO_CACHE_MAX = 20;

// Deduplication: if a map data request is already in-flight for a project, reuse it
const inflightMapRequests = new Map<string, Promise<ProjectMapData>>();

function getProjectGeoCache(projectId: string): OsmStreet[] | null {
  const entry = projectGeometryCache.get(projectId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > PROJECT_GEO_CACHE_TTL_MS) {
    projectGeometryCache.delete(projectId);
    return null;
  }
  return entry.streets;
}

function setProjectGeoCache(projectId: string, streets: OsmStreet[]): void {
  if (projectGeometryCache.size >= PROJECT_GEO_CACHE_MAX) {
    const oldest = projectGeometryCache.keys().next().value;
    if (oldest) projectGeometryCache.delete(oldest);
  }
  projectGeometryCache.set(projectId, { streets, timestamp: Date.now() });
}

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
    boundaryMode = "intersects",
    includeStreets = false,
    userId,
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
    await ensureCitySynced(centerLatIn, centerLngIn);
    const { streets, cacheKey: key, cachedRadius } = await getStreetsWithCache(
      centerLatIn,
      centerLngIn,
      radiusMetersIn
    );
    const filterFn = resolveRadiusFilter(boundaryMode);
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
    const c = polygonCentroid(coords);
    await ensureCitySynced(c.lat, c.lng);
    const streets = await getLocalStreetsInPolygonFiltered(
      coords,
      boundaryMode,
      { namedOnly: true },
    );
    const filterFn = resolvePolygonFilter(boundaryMode);
    filteredStreets = filterFn(streets, coords);
    cacheKey = `geo:polygon:${coords.length}:${coords
      .map((p) => p.join(","))
      .join("|")}`.slice(0, 500);
    polygonCoordinates = coords;
  }

  // When "Include streets that cross your area" is checked (intersects mode),
  // expand to include ALL segments of streets that touch the boundary
  if (boundaryMode === "intersects") {
    filteredStreets = await expandStreetsToFullByName(
      filteredStreets,
      boundaryType,
      centerLat,
      centerLng,
      radiusMeters,
      polygonCoordinates
    );
  }

  filteredStreets = filteredStreets.filter(
    (s) => s.name && !isUnnamedStreet(s.name)
  );

  const totalLengthMeters = filteredStreets.reduce(
    (sum, s) => sum + s.lengthMeters,
    0
  );
  const streetsByType = groupByHighwayType(filteredStreets);

  const byName = new Map<string, { segments: OsmStreet[]; displayName: string }>();
  for (const street of filteredStreets) {
    const key = normalizeStreetName(street.name!);
    if (!byName.has(key)) {
      byName.set(key, { segments: [], displayName: street.name! });
    }
    byName.get(key)!.segments.push(street);
  }
  const totalStreetNames = byName.size;

  const warnings = generatePreviewWarnings(totalStreetNames, filteredStreets);

  let streetsList: ProjectPreview["streets"] | undefined;
  if (includeStreets) {
    const allOsmIds = filteredStreets.map((s) => s.osmId);
    const progressMap = new Map<string, number>();
    if (userId && allOsmIds.length > 0) {
      const wayIds = allOsmIds.map((id) => osmIdToWayId(id));
      const completion = await deriveStreetCompletionForArea(userId, wayIds);
      for (const c of completion) {
        const osmId = `way/${String(c.wayId)}`;
        const pct = c.edgesTotal > 0
          ? Math.min(100, Math.round((c.edgesCompleted / c.edgesTotal) * 100))
          : 0;
        progressMap.set(osmId, pct);
      }
    }

    streetsList = Array.from(byName.values())
      .map((data) => {
        const firstSegment = data.segments[0];
        const mergedCoordinates = data.segments.flatMap(
          (s) => s.geometry?.coordinates ?? []
        );
        const streetTotalLen = data.segments.reduce(
          (sum, s) => sum + s.lengthMeters, 0,
        );

        let weightedPct = 0;
        if (streetTotalLen > 0) {
          weightedPct = data.segments.reduce((sum, s) => {
            const pct = progressMap.get(s.osmId) ?? 0;
            return sum + pct * s.lengthMeters;
          }, 0) / streetTotalLen;
        }
        const percentage = Math.round(weightedPct * 100) / 100;
        const status: "completed" | "partial" | "not_started" =
          percentage >= getCompletionThreshold()
            ? "completed"
            : percentage > 0
              ? "partial"
              : "not_started";

        return {
          name: data.displayName,
          segmentCount: data.segments.length,
          totalLengthMeters: streetTotalLen,
          highwayType: firstSegment?.highwayType || "unknown",
          osmId: firstSegment?.osmId,
          geometry: mergedCoordinates.length > 0
            ? { type: "LineString" as const, coordinates: mergedCoordinates }
            : undefined,
          percentage,
          status,
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
  radiusMeters: number,
): Promise<{ streets: OsmStreet[]; cacheKey: string; cachedRadius: number }> {
  const exactKey = generateRadiusCacheKey(centerLat, centerLng, radiusMeters);
  const streets = await getLocalStreetsInRadius(
    centerLat,
    centerLng,
    radiusMeters,
    { namedOnly: true },
  );
  return {
    streets,
    cacheKey: exactKey,
    cachedRadius: radiusMeters,
  };
}

// ============================================
// Expand Streets by Name (for "intersects" mode)
// ============================================

/**
 * Expand streets to include ALL segments of streets that intersect the boundary.
 * 
 * When a user checks "Include streets that cross your area", we want to include
 * the ENTIRE street (all segments), not just the parts that touch the boundary.
 * 
 * Example: If "St John Street" has 4 segments (A, B, C, D) and only segment B
 * touches the boundary, we want to include ALL segments A, B, C, D - the entire street.
 * 
 * This function:
 * 1. Gets unique street names from streets that touch the boundary
 * 2. Queries a MUCH larger area (10x radius for circle, 10x expanded bbox for polygon)
 *    to capture streets that extend far beyond the boundary
 * 3. Finds ALL segments with matching street names (normalized)
 * 4. Returns the expanded list (original segments + all other segments of same streets)
 * 
 * @param filteredStreets - Streets that already intersect the boundary
 * @param boundaryType - "circle" or "polygon"
 * @param centerLat - Circle center (if circle)
 * @param centerLng - Circle center (if circle)
 * @param radiusMeters - Circle radius (if circle)
 * @param polygonCoordinates - Polygon coordinates (if polygon)
 * @returns Expanded list of streets including ALL segments by name
 */
async function expandStreetsToFullByName(
  filteredStreets: OsmStreet[],
  boundaryType: "circle" | "polygon",
  centerLat?: number,
  centerLng?: number,
  radiusMeters?: number,
  polygonCoordinates?: [number, number][]
): Promise<OsmStreet[]> {
  if (filteredStreets.length === 0) return filteredStreets;

  // Get unique normalized street names from filtered streets
  const existingNames = new Set(
    filteredStreets.map((s) => normalizeStreetName(s.name || "Unnamed"))
  );
  const existingOsmIds = new Set(filteredStreets.map((s) => s.osmId));

  // Query a MUCH larger area to find ALL segments of streets that touch the boundary
  // Streets can extend far beyond the boundary, so we need to search a wide area
  let expandedStreets: OsmStreet[] = [];

  if (boundaryType === "circle") {
    if (centerLat == null || centerLng == null || radiusMeters == null) {
      return filteredStreets;
    }
    // Query 10x the radius (or max 50km) to capture entire streets
    // Example: 1km radius → 10km search; 5km radius → 50km search
    const expandedRadius = Math.min(radiusMeters * 10, PROJECTS.RADIUS_MAX);
    console.log(
      `[Project] Expanding streets: querying ${expandedRadius}m radius (${(expandedRadius / 1000).toFixed(1)}km) to find all segments`
    );
    expandedStreets = await getLocalStreetsInRadius(
      centerLat,
      centerLng,
      expandedRadius,
      { namedOnly: true },
    );
  } else {
    if (!polygonCoordinates || polygonCoordinates.length < 3) {
      return filteredStreets;
    }
    // For polygon, expand the bounding box by 10x to capture entire streets
    const bbox = polygonCoordinates.reduce(
      (acc, [lng, lat]) => ({
        minLat: Math.min(acc.minLat, lat),
        maxLat: Math.max(acc.maxLat, lat),
        minLng: Math.min(acc.minLng, lng),
        maxLng: Math.max(acc.maxLng, lng),
      }),
      { minLat: Infinity, maxLat: -Infinity, minLng: Infinity, maxLng: -Infinity }
    );
    const latSpan = bbox.maxLat - bbox.minLat;
    const lngSpan = bbox.maxLng - bbox.minLng;
    // Expand by 10x (5x on each side) to capture entire streets
    const latPadding = latSpan * 5;
    const lngPadding = lngSpan * 5;
    const expandedPolygon: [number, number][] = [
      [bbox.minLng - lngPadding, bbox.minLat - latPadding],
      [bbox.maxLng + lngPadding, bbox.minLat - latPadding],
      [bbox.maxLng + lngPadding, bbox.maxLat + latPadding],
      [bbox.minLng - lngPadding, bbox.maxLat + latPadding],
    ];
    console.log(
      `[Project] Expanding streets: querying expanded polygon (${latSpan.toFixed(4)}° × ${lngSpan.toFixed(4)}° → ${(latSpan + latPadding * 2).toFixed(4)}° × ${(lngSpan + lngPadding * 2).toFixed(4)}°) to find all segments`
    );
    expandedStreets = await getLocalStreetsInPolygonFiltered(
      expandedPolygon,
      "intersects",
      { namedOnly: true },
    );
  }

  // Filter to only streets with matching names that aren't already in the list
  const newSegments: OsmStreet[] = expandedStreets.filter((s) => {
    const normalizedName = normalizeStreetName(s.name || "Unnamed");
    return existingNames.has(normalizedName) && !existingOsmIds.has(s.osmId);
  });

  if (newSegments.length === 0) {
    return filteredStreets;
  }

  console.log(
    `[Project] Expanding streets: ${filteredStreets.length} → ${filteredStreets.length + newSegments.length} segments (+${newSegments.length})`
  );

  // Return original streets + new segments
  return [...filteredStreets, ...newSegments];
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
    boundaryMode = "intersects",
    includePreviousRuns = false,
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
    includePreviousRuns: boolean;
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
    await ensureCitySynced(centerLat, centerLng);
    const filterFn = resolveRadiusFilter(boundaryMode);

    if (cacheKey) {
      const raw = await getLocalStreetsInRadius(
        centerLat,
        centerLng,
        radiusMeters,
        { namedOnly: true },
      );
      streets = filterFn(raw, centerLat, centerLng, radiusMeters);
      console.log(`[Project] Using local streets for cacheKey path: ${cacheKey}`);
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
      includePreviousRuns,
      streetsSnapshot: {} as object,
      snapshotDate: new Date(),
      totalStreets: 0,
      totalStreetNames: 0,
      completedStreetNames: 0,
      totalLengthMeters: 0,
      completedStreets: 0,
      progress: 0,
      deadline: deadline ? new Date(deadline) : null,
    };

    // When "Include streets that cross your area" is checked (intersects mode),
    // expand to include ALL segments of streets that touch the boundary
    if (boundaryMode === "intersects") {
      streets = await expandStreetsToFullByName(
        streets,
        "circle",
        centerLat,
        centerLng,
        radiusMeters
      );
    }
  } else {
    const polygonCoordinates = input.polygonCoordinates;
    if (!polygonCoordinates || polygonCoordinates.length < 3) {
      throw new Error(
        "Polygon project requires polygonCoordinates with at least 3 points."
      );
    }
    const polyCenter = polygonCentroid(polygonCoordinates);
    await ensureCitySynced(polyCenter.lat, polyCenter.lng);
    streets = await getLocalStreetsInPolygonFiltered(
      polygonCoordinates,
      boundaryMode,
      { namedOnly: true },
    );
    const filterFn = resolvePolygonFilter(boundaryMode);
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
      includePreviousRuns,
      streetsSnapshot: {} as object,
      snapshotDate: new Date(),
      totalStreets: 0,
      totalStreetNames: 0,
      completedStreetNames: 0,
      totalLengthMeters: 0,
      completedStreets: 0,
      progress: 0,
      deadline: deadline ? new Date(deadline) : null,
    };

    // When "Include streets that cross your area" is checked (intersects mode),
    // expand to include ALL segments of streets that touch the boundary
    if (boundaryMode === "intersects") {
      streets = await expandStreetsToFullByName(
        streets,
        "polygon",
        undefined,
        undefined,
        undefined,
        polygonCoordinates
      );
    }
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
  createData.totalStreetNames = totalStreetNames;
  createData.completedStreetNames = 0;

  const project = await prisma.project.create({
    data: createData as Parameters<typeof prisma.project.create>[0]["data"],
  });

  console.log(
    `[Project] Created ${boundaryType} project "${name}" with ${streets.length} segments (${totalStreetNames} unique names) for user ${userId}`
  );

  if (includePreviousRuns) {
    void (async () => {
      try {
        const v2Results = await deriveProjectProgressV2Scoped(
          userId,
          snapshot.streets.map((s) => ({
            osmId: s.osmId,
            lengthMeters: s.lengthMeters ?? 0,
          })),
          null
        );
        const snapshotByOsmId = new Map(
          snapshot.streets.map((s) => [s.osmId, s])
        );
        const streetUpdates = v2Results.map((r) => ({
          osmId: r.osmId,
          percentage: r.percentage,
          lastRunDate:
            snapshotByOsmId.get(r.osmId)?.lastRunDate ??
            new Date().toISOString(),
        }));
        await updateProjectProgress(project.id, streetUpdates, {
          forceUpdate: true,
        });
      } catch (err) {
        console.warn(
          `[Project] Include previous runs backfill failed for project ${project.id}:`,
          err instanceof Error ? err.message : err
        );
      }
    })();
  }

  const finalProject = await prisma.project.findUnique({
    where: { id: project.id },
  });
  const toReturn = finalProject ?? project;
  const snapshotFinal = toReturn.streetsSnapshot as StreetSnapshot | null;
  const { completedStreetNames: completedNames } = snapshotFinal?.streets?.length
    ? groupSnapshotByStreetName(snapshotFinal)
    : { completedStreetNames: 0 };
  return {
    ...mapProjectToListItem(toReturn),
    totalStreetNames,
    completedStreetNames: completedNames,
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
    nextMilestone: null,
    realNextMilestone: null,
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
 * Fetches street geometries from PostGIS (WayTotalEdges), merges with
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
    (project as { boundaryMode?: string }).boundaryMode ?? "intersects";

  let streetsWithGeometry: OsmStreet[];
  let geometryCacheHit: boolean;

  // Check in-memory project geometry cache first (avoids duplicate Overpass calls)
  const cachedGeo = getProjectGeoCache(projectId);
  if (cachedGeo) {
    console.log(`[Project] Map geometry cache hit for project ${projectId.slice(0, 8)}…`);
    streetsWithGeometry = cachedGeo.filter((s) => snapshotOsmIds.has(s.osmId));
    geometryCacheHit = true;
  } else if (boundaryType === "polygon") {
    const polygonCoordinates = (project as { polygonCoordinates?: [number, number][] })
      .polygonCoordinates;
    if (!polygonCoordinates || polygonCoordinates.length < 3) {
      throw new Error("Project has invalid polygon boundary.");
    }
    const polyCenter = polygonCentroid(polygonCoordinates);
    await ensureCitySynced(polyCenter.lat, polyCenter.lng);
    streetsWithGeometry = await getLocalStreetsInPolygonFiltered(
      polygonCoordinates,
      boundaryMode,
      { namedOnly: true },
    );
    const filterFn = resolvePolygonFilter(boundaryMode);
    streetsWithGeometry = filterFn(streetsWithGeometry, polygonCoordinates);

    if (boundaryMode === "intersects") {
      const foundOsmIds = new Set(streetsWithGeometry.map((s) => s.osmId));
      const missingOsmIds = [...snapshotOsmIds].filter((id) => !foundOsmIds.has(id));
      if (missingOsmIds.length > 0) {
        const bbox = polygonCoordinates.reduce(
          (acc, [lng, lat]) => ({
            minLat: Math.min(acc.minLat, lat),
            maxLat: Math.max(acc.maxLat, lat),
            minLng: Math.min(acc.minLng, lng),
            maxLng: Math.max(acc.maxLng, lng),
          }),
          { minLat: Infinity, maxLat: -Infinity, minLng: Infinity, maxLng: -Infinity }
        );
        const latSpan = bbox.maxLat - bbox.minLat;
        const lngSpan = bbox.maxLng - bbox.minLng;
        const latPadding = latSpan * 5;
        const lngPadding = lngSpan * 5;
        const expandedPolygon: [number, number][] = [
          [bbox.minLng - lngPadding, bbox.minLat - latPadding],
          [bbox.maxLng + lngPadding, bbox.minLat - latPadding],
          [bbox.maxLng + lngPadding, bbox.maxLat + latPadding],
          [bbox.minLng - lngPadding, bbox.maxLat + latPadding],
        ];
        const expandedStreets = await getLocalStreetsInPolygonFiltered(
          expandedPolygon,
          "intersects",
          { namedOnly: true },
        );
        const additionalStreets = expandedStreets.filter(
          (s) =>
            snapshotOsmIds.has(s.osmId) && !foundOsmIds.has(s.osmId)
        );
        streetsWithGeometry = [...streetsWithGeometry, ...additionalStreets];
      }
    }

    setProjectGeoCache(projectId, streetsWithGeometry);
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
    await ensureCitySynced(centerLat, centerLng);
    const filterFn = resolveRadiusFilter(boundaryMode);

    streetsWithGeometry = await getLocalStreetsInRadius(
      centerLat,
      centerLng,
      radiusMeters,
      { namedOnly: true },
    );
    streetsWithGeometry = filterFn(
      streetsWithGeometry,
      centerLat,
      centerLng,
      radiusMeters,
    );
    geometryCacheHit = false;

    if (boundaryMode === "intersects") {
      const foundOsmIds = new Set(streetsWithGeometry.map((s) => s.osmId));
      const missingOsmIds = [...snapshotOsmIds].filter((id) => !foundOsmIds.has(id));
      if (missingOsmIds.length > 0) {
        const expandedRadius = Math.min(radiusMeters * 10, PROJECTS.RADIUS_MAX);
        const expandedStreets = await getLocalStreetsInRadius(
          centerLat,
          centerLng,
          expandedRadius,
          { namedOnly: true },
        );
        const additionalStreets = expandedStreets.filter(
          (s) =>
            snapshotOsmIds.has(s.osmId) && !foundOsmIds.has(s.osmId)
        );
        if (additionalStreets.length > 0) {
          console.log(
            `[Project] Map data: found ${additionalStreets.length} expanded segments for project "${project.name}"`
          );
          streetsWithGeometry = [...streetsWithGeometry, ...additionalStreets];
        }
      }
    }

    setProjectGeoCache(projectId, streetsWithGeometry);
    streetsWithGeometry = streetsWithGeometry.filter((s) =>
      snapshotOsmIds.has(s.osmId)
    );
  }

  let completedCount = 0;
  let partialCount = 0;
  let notRunCount = 0;

  const [userProgressRows, projectActivities] = await Promise.all([
    prisma.userStreetProgress.findMany({
      where: { userId, osmId: { in: [...snapshotOsmIds] } },
      select: { osmId: true, runCount: true, firstRunDate: true, lastRunDate: true },
    }),
    prisma.projectActivity.findMany({
      where: { projectId },
      include: { activity: { select: { distanceMeters: true, startDate: true } } },
    }),
  ]);
  const progressByOsmIdWithStats = new Map(
    userProgressRows.map((r) => [
      r.osmId,
      {
        runCount: r.runCount,
        firstRunDate: r.firstRunDate?.toISOString() ?? null,
        lastRunDate: r.lastRunDate?.toISOString() ?? null,
      },
    ])
  );

  streetsWithGeometry = streetsWithGeometry.filter(
    (s) => s.name && !isUnnamedStreet(s.name)
  );

  const mapStreets: ProjectMapStreet[] = streetsWithGeometry.map((osm) => {
    const progress = progressByOsmId.get(osm.osmId);
    const percentage = progress?.percentage ?? 0;
    const stats = progressByOsmIdWithStats.get(osm.osmId);

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
      runCount: stats?.runCount,
      firstRunDate: stats?.firstRunDate ?? null,
      lastRunDate: stats?.lastRunDate ?? null,
    };
  });

  const totalStreets = mapStreets.length;

  // Group segments by street name for aggregation (same logic as map.service)
  const segmentsByName = new Map<string, typeof mapStreets>();
  for (const st of mapStreets) {
    const key = normalizeStreetName(st.name || "Unnamed");
    if (!segmentsByName.has(key)) segmentsByName.set(key, []);
    segmentsByName.get(key)!.push(st);
  }

  // Compute length-weighted percentage and status per street name.
  // Matches map.service: all segments of same street share same color on map.
  const { STREET_COMPLETION_THRESHOLD, CONNECTOR_MAX_LENGTH_METERS, CONNECTOR_WEIGHT } =
    STREET_AGGREGATION;
  const streetDataByName = new Map<
    string,
    { status: "completed" | "partial" | "not_started"; percentage: number }
  >();
  for (const [key, segments] of segmentsByName) {
    let weightedSum = 0;
    let totalWeight = 0;
    for (const s of segments) {
      const isConnector = s.lengthMeters <= CONNECTOR_MAX_LENGTH_METERS;
      const weight = s.lengthMeters * (isConnector ? CONNECTOR_WEIGHT : 1);
      weightedSum += (s.percentage / 100) * weight;
      totalWeight += weight;
    }
    const weightedRatio = totalWeight === 0 ? 0 : weightedSum / totalWeight;
    const weightedPercentage = Math.round(weightedRatio * 100);
    const status: "completed" | "partial" | "not_started" =
      weightedRatio >= STREET_COMPLETION_THRESHOLD
        ? "completed"
        : weightedPercentage > 0
          ? "partial"
          : "not_started";
    streetDataByName.set(key, { status, percentage: weightedPercentage });
  }

  // Propagate aggregated status and percentage to all segments
  for (const segment of mapStreets) {
    const key = normalizeStreetName(segment.name || "Unnamed");
    const aggregated = streetDataByName.get(key);
    if (aggregated) {
      segment.status = aggregated.status;
      segment.percentage = aggregated.percentage;
    }
  }

  // Name-grouped counts for map header ("X streets completed")
  let completedStreetNames = 0;
  let partialStreetNames = 0;
  let notStartedStreetNames = 0;
  for (const [, data] of streetDataByName) {
    if (data.status === "completed") completedStreetNames += 1;
    else if (data.status === "partial") partialStreetNames += 1;
    else notStartedStreetNames += 1;
  }
  const totalStreetNames = streetDataByName.size;

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

  const totalDistanceMeters = projectActivities.reduce(
    (sum, pa) => sum + (pa.activity?.distanceMeters ?? 0),
    0
  );
  const totalDistanceKm = Math.round((totalDistanceMeters / 1000) * 100) / 100;
  const dates = projectActivities
    .map((pa) => pa.activity?.startDate)
    .filter((d): d is Date => d != null);
  const firstRun = dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
  const lastRun = dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;

  const projectStats = {
    totalRuns: projectActivities.length,
    totalDistanceKm,
    firstRunDate: firstRun?.toISOString() ?? null,
    lastRunDate: lastRun?.toISOString() ?? null,
  };

  const quickWins: Array<{ osmId: string; name: string; percentage: number; remainingMeters: number }> = [];
  for (const [key, data] of streetDataByName) {
    if (data.percentage >= 75 && data.percentage < 100) {
      const segments = segmentsByName.get(key) ?? [];
      const remainingMeters = segments.reduce(
        (sum, s) => sum + s.lengthMeters * (1 - s.percentage / 100),
        0
      );
      const firstSegment = segments[0];
      if (firstSegment) {
        quickWins.push({
          osmId: firstSegment.osmId,
          name: firstSegment.name || "Unnamed",
          percentage: data.percentage,
          remainingMeters: Math.round(remainingMeters),
        });
      }
    }
  }
  quickWins.sort((a, b) => b.percentage - a.percentage);
  let quickWinsSlice = quickWins.slice(0, 5);

  if (quickWins.length === 0) {
    let bestKey: string | null = null;
    let bestPct = -1;
    for (const [key, data] of streetDataByName) {
      if (
        data.percentage > 0 &&
        data.percentage < 100 &&
        data.percentage > bestPct
      ) {
        bestPct = data.percentage;
        bestKey = key;
      }
    }
    if (bestKey != null) {
      const segments = segmentsByName.get(bestKey) ?? [];
      const data = streetDataByName.get(bestKey);
      const remainingMeters = segments.reduce(
        (sum, s) => sum + s.lengthMeters * (1 - s.percentage / 100),
        0
      );
      const firstSegment = segments[0];
      if (firstSegment && data) {
        quickWinsSlice = [
          {
            osmId: firstSegment.osmId,
            name: firstSegment.name || "Unnamed",
            percentage: data.percentage,
            remainingMeters: Math.round(remainingMeters),
          },
        ];
      }
    }
  }

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
      partialStreetNames,
      notStartedStreetNames,
    },
    streets: mapStreets,
    geometryCacheHit,
    projectStats,
    quickWins: quickWinsSlice,
  };

  return mapData;
}

/**
 * Deduplicated wrapper for getProjectMapData.
 * If a request for the same project is already in-flight, returns the same promise
 * instead of starting a second Overpass-heavy computation.
 */
export async function getProjectMapDataDeduped(
  projectId: string,
  userId: string
): Promise<ProjectMapData> {
  const key = `${projectId}:${userId}`;
  const inflight = inflightMapRequests.get(key);
  if (inflight) {
    console.log(`[Project] Map request deduped for project ${projectId.slice(0, 8)}…`);
    return inflight;
  }

  const promise = getProjectMapData(projectId, userId).finally(() => {
    inflightMapRequests.delete(key);
  });
  inflightMapRequests.set(key, promise);
  return promise;
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
      (project as { boundaryMode?: string }).boundaryMode ?? "intersects";
    const pc = polygonCentroid(polygonCoordinates);
    await ensureCitySynced(pc.lat, pc.lng);
    freshStreets = await getLocalStreetsInPolygonFiltered(
      polygonCoordinates,
      boundaryMode,
    );
    const filterFn = resolvePolygonFilter(boundaryMode);
    freshStreets = filterFn(freshStreets, polygonCoordinates);
  } else {
    const centerLat = project.centerLat;
    const centerLng = project.centerLng;
    const radiusMeters = project.radiusMeters;
    if (centerLat == null || centerLng == null || radiusMeters == null) {
      throw new Error("Project has invalid circle boundary.");
    }
    await ensureCitySynced(centerLat, centerLng);
    freshStreets = await getLocalStreetsInRadius(centerLat, centerLng, radiusMeters);
    const boundaryMode =
      (project as { boundaryMode?: string }).boundaryMode ?? "intersects";
    const filterFn = resolveRadiusFilter(boundaryMode);
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

  const { totalStreetNames, completedStreetNames } =
    groupSnapshotByStreetName(newSnapshot);

  await prisma.project.update({
    where: { id: projectId },
    data: {
      streetsSnapshot: newSnapshot as object,
      snapshotDate: new Date(),
      totalStreets: newSnapshot.streets.length,
      totalStreetNames,
      completedStreetNames,
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
 * Update editable project metadata that does not affect boundaries/snapshots.
 */
export async function updateProjectMetadata(
  projectId: string,
  userId: string,
  data: { name?: unknown; deadline?: unknown },
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

  const updateData: { name?: string; deadline?: Date | null } = {};

  if (data.name !== undefined) {
    if (typeof data.name !== "string") {
      throw new ProjectValidationError("Project name must be a string.");
    }
    const trimmedName = data.name.trim();
    if (trimmedName.length === 0 || trimmedName.length > 100) {
      throw new ProjectValidationError(
        "Project name must be between 1 and 100 characters.",
      );
    }
    updateData.name = trimmedName;
  }

  if (data.deadline !== undefined) {
    if (data.deadline === null) {
      updateData.deadline = null;
    } else if (typeof data.deadline === "string") {
      const trimmedDeadline = data.deadline.trim();
      if (trimmedDeadline.length === 0) {
        updateData.deadline = null;
      } else {
        const parsed = new Date(trimmedDeadline);
        if (Number.isNaN(parsed.getTime())) {
          throw new ProjectValidationError("Deadline must be a valid date.");
        }
        updateData.deadline = parsed;
      }
    } else {
      throw new ProjectValidationError(
        "Deadline must be an ISO date string or null.",
      );
    }
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.project.update({
      where: { id: projectId },
      data: updateData,
    });
  }

  const { project: projectDetail } = await getProjectById(projectId, userId, {
    includeStreets: false,
  });
  return projectDetail;
}

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
 * Restore an archived project.
 * Sets isArchived = false so project reappears in list.
 */
export async function restoreProject(
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
    data: { isArchived: false },
  });

  console.log(`[Project] Restored project "${project.name}"`);
}

/**
 * Permanently delete a project and all related data.
 * Removes: Project, ProjectActivity (cascade), UserMilestone (cascade).
 * Activities themselves are NOT deleted (they may be shared with other projects).
 */
export async function deleteProjectPermanently(
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

  // Delete the project (ProjectActivity and UserMilestone have onDelete: Cascade)
  await prisma.project.delete({
    where: { id: projectId },
  });

  console.log(`[Project] Permanently deleted project "${project.name}"`);
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
  const filterFn = resolveRadiusFilter(boundaryMode);

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

  const { totalStreetNames, completedStreetNames } =
    groupSnapshotByStreetName(newSnapshot);

  await prisma.project.update({
    where: { id: projectId },
    data: {
      radiusMeters: newRadiusMeters,
      streetsSnapshot: newSnapshot as object,
      snapshotDate: new Date(),
      totalStreets: newSnapshot.streets.length,
      totalStreetNames,
      completedStreetNames,
      totalLengthMeters,
      completedStreets,
      progress,
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

  const { totalStreetNames, completedStreetNames } =
    groupSnapshotByStreetName(snapshot);

  await prisma.project.update({
    where: { id: projectId },
    data: {
      streetsSnapshot: snapshot as object,
      completedStreets,
      progress,
      totalStreetNames,
      completedStreetNames,
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

  const includePreviousRuns = (project as { includePreviousRuns?: boolean })
    .includePreviousRuns;
  const cutoff = includePreviousRuns ? null : project.createdAt;
  const v2Results = await deriveProjectProgressV2Scoped(
    userId,
    snapshot.streets.map((s) => ({
      osmId: s.osmId,
      lengthMeters: s.lengthMeters ?? 0,
    })),
    cutoff
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

function generatePreviewWarnings(totalStreetNames: number, streets: OsmStreet[]): string[] {
  const warnings: string[] = [];

  if (totalStreetNames > PROJECTS.MAX_STREETS_WARNING) {
    warnings.push(
      `Large area: ${totalStreetNames} streets found. Consider reducing radius for a more manageable goal.`
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

  if (totalStreetNames === 0) {
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

/**
 * Error thrown when project metadata fails validation.
 */
export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}
