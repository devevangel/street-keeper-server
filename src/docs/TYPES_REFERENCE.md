# Type Reference

This document provides a complete reference of all TypeScript types used in the Street Keeper API responses.

## Table of Contents

1. [Common Types](#common-types)
2. [Authentication Types](#authentication-types)
3. [Project Types](#project-types)
4. [Activity Types](#activity-types)
5. [GPX Analysis Types](#gpx-analysis-types)
6. [Webhook Types](#webhook-types)
7. [Map Types](#map-types)

---

## Common Types

### ApiErrorResponse

Standard error response returned by all endpoints.

```typescript
interface ApiErrorResponse {
  /** Always false for errors */
  success: false;

  /** Human-readable error message */
  error: string;

  /** Machine-readable error code (see Error Reference) */
  code?: string;
}
```

**Example:**

```json
{
  "success": false,
  "error": "Project not found",
  "code": "PROJECT_NOT_FOUND"
}
```

---

## Authentication Types

### AuthUser

User data returned after authentication.

```typescript
interface AuthUser {
  /** User UUID */
  id: string;

  /** Display name */
  name: string;

  /** Email address (may be null if not shared) */
  email?: string | null;

  /** Strava athlete ID */
  stravaId?: string | null;

  /** Garmin user ID (future use) */
  garminId?: string | null;

  /** Profile picture URL */
  profilePic?: string | null;
}
```

**Example:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "John Runner",
  "email": "john@example.com",
  "stravaId": "12345678",
  "profilePic": "https://dgalywyr863hv.cloudfront.net/pictures/athletes/12345678/large.jpg"
}
```

### AuthSuccessResponse

Successful authentication response.

```typescript
interface AuthSuccessResponse {
  success: true;
  message: string;
  user: AuthUser;
}
```

---

## Project Types

### SnapshotStreet

Individual street in a project snapshot with progress tracking.

```typescript
interface SnapshotStreet {
  /** OSM way ID (e.g., "way/123456789") */
  osmId: string;

  /** Street name from OpenStreetMap */
  name: string;

  /** Total street length in meters */
  lengthMeters: number;

  /** OSM highway type (residential, footway, primary, etc.) */
  highwayType: string;

  /** True if percentage >= 90% (completion threshold) */
  completed: boolean;

  /** Coverage percentage (0-100) */
  percentage: number;

  /** ISO date string of last activity on this street */
  lastRunDate: string | null;

  /** True if this street was added during a recent refresh */
  isNew?: boolean;
}
```

**Example:**

```json
{
  "osmId": "way/123456789",
  "name": "High Street",
  "lengthMeters": 450.5,
  "highwayType": "residential",
  "completed": true,
  "percentage": 95.2,
  "lastRunDate": "2024-01-15T08:30:00.000Z"
}
```

### ProjectListItem

Project summary for list views (without full street data).

```typescript
interface ProjectListItem {
  /** Project UUID */
  id: string;

  /** User-defined project name */
  name: string;

  /** Center latitude */
  centerLat: number;

  /** Center longitude */
  centerLng: number;

  /** Radius in meters (500, 1000, 2000, 5000, or 10000) */
  radiusMeters: number;

  /** Overall progress percentage (0-100) */
  progress: number;

  /** Total number of streets in project */
  totalStreets: number;

  /** Number of completed streets (>= 90%) */
  completedStreets: number;

  /** Total length of all streets in meters */
  totalLengthMeters: number;

  /** Optional deadline date */
  deadline: string | null;

  /** Whether project is archived */
  isArchived: boolean;

  /** Creation timestamp */
  createdAt: string;

  /** Last update timestamp */
  updatedAt: string;
}
```

### ProjectDetail

Full project detail including all streets.

```typescript
interface ProjectDetail extends ProjectListItem {
  /** Array of all streets with progress */
  streets: SnapshotStreet[];

  /** Date when street snapshot was created/refreshed */
  snapshotDate: string;

  /** Number of streets with 1-89% coverage */
  inProgressCount: number;

  /** Number of streets with 0% coverage */
  notStartedCount: number;

  /** Sum of completed street lengths (meters) */
  distanceCoveredMeters: number;

  /** Number of activities that touched this project */
  activityCount: number;

  /** ISO date of most recent activity in project */
  lastActivityDate: string | null;

  /** Next milestone (25/50/75/100) and streets needed */
  nextMilestone: NextMilestone | null;

  /** Street counts by highway type (for charts) */
  streetsByType: StreetsByTypeItem[];

  /** Whether refresh is recommended (snapshot > 30 days old) */
  refreshNeeded: boolean;

  /** Days since last snapshot refresh */
  daysSinceRefresh: number;

  /** Number of new streets detected (after refresh) */
  newStreetsDetected?: number;
}
```

### NextMilestone

```typescript
interface NextMilestone {
  target: number;        // 25, 50, 75, or 100
  streetsNeeded: number;
  currentProgress: number;
}
```

### StreetsByTypeItem

```typescript
interface StreetsByTypeItem {
  type: string;   // e.g. "residential", "primary"
  total: number;
  completed: number;
}
```

### ProjectPreview

Preview data returned before creating a project.

```typescript
interface ProjectPreview {
  /** Center latitude */
  centerLat: number;

  /** Center longitude */
  centerLng: number;

  /** Requested radius in meters */
  radiusMeters: number;

  /** Actual radius in cache (may be larger than requested) */
  cachedRadiusMeters: number;

  /** Cache key to pass to create endpoint */
  cacheKey: string;

  /** Total number of streets in project area */
  totalStreets: number;

  /** Total length of all streets in meters */
  totalLengthMeters: number;

  /** Street count by highway type */
  streetsByType: Record<string, number>;

  /** Warning messages (e.g., "Large area: 500+ streets") */
  warnings: string[];
}
```

### CreateProjectRequest

Request body for creating a new project.

```typescript
interface CreateProjectRequest {
  /** Project name (1-100 characters) */
  name: string;

  /** Center latitude (-90 to 90) */
  centerLat: number;

  /** Center longitude (-180 to 180) */
  centerLng: number;

  /** Radius in meters (must be 500, 1000, 2000, 5000, or 10000) */
  radiusMeters: 500 | 1000 | 2000 | 5000 | 10000;

  /** Optional deadline date (ISO string) */
  deadline?: string;

  /** Optional cache key from preview (speeds up creation) */
  cacheKey?: string;

  /** Boundary mode: "centroid" (default) or "strict" */
  boundaryMode?: "centroid" | "strict";
}
```

### ProjectMapData, ProjectMapStreet

Map data for project map view (GET `/projects/:id/map`).

```typescript
interface ProjectMapStreet {
  osmId: string;
  name: string;
  highwayType: string;
  lengthMeters: number;
  percentage: number;
  status: "completed" | "partial" | "not_started";
  geometry: { type: "LineString"; coordinates: [number, number][] };
}

interface ProjectMapData {
  id: string;
  name: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  progress: number;
  boundary: { type: "circle"; center: { lat: number; lng: number }; radiusMeters: number };
  stats: { totalStreets: number; completedStreets: number; partialStreets: number; notRunStreets: number; completionPercentage: number };
  streets: ProjectMapStreet[];
  geometryCacheHit: boolean;
}
```

### ProjectHeatmapData

Heatmap data (GET `/projects/:id/heatmap`).

```typescript
interface ProjectHeatmapData {
  /** [lat, lng, intensity] per point */
  points: [number, number, number][];
  bounds: { north: number; south: number; east: number; west: number };
}
```

### StreetSuggestion, SuggestionsResponse

Next-run suggestions (GET `/projects/:id/suggestions`).

```typescript
interface StreetSuggestion {
  osmId: string;
  name: string;
  lengthMeters: number;
  currentProgress: number;
  remainingMeters?: number;
  distanceFromPoint?: number;
  reason: string;
  geometry: Array<{ lat: number; lng: number }>;
}

interface SuggestionsResponse {
  almostComplete: StreetSuggestion[];
  nearest: StreetSuggestion[];
  milestone: {
    target: number;
    currentProgress: number;
    streetsNeeded: number;
    streets: StreetSuggestion[];
  } | null;
  clusters: Array<{
    centroid: { lat: number; lng: number };
    streets: StreetSuggestion[];
    totalLength: number;
    streetCount: number;
  }>;
}
```

---

## Activity Types

### ActivityListItem

Activity summary for list views.

```typescript
interface ActivityListItem {
  /** Activity UUID */
  id: string;

  /** Strava activity ID */
  stravaId: string;

  /** Activity name from Strava */
  name: string;

  /** Distance in meters */
  distanceMeters: number;

  /** Duration in seconds */
  durationSeconds: number;

  /** Activity start time (ISO string) */
  startDate: string;

  /** Activity type (Run, Walk, Hike, Trail Run) */
  activityType: string;

  /** Whether activity has been processed for street matching */
  isProcessed: boolean;

  /** Creation timestamp */
  createdAt: string;

  /** Number of projects affected by this activity */
  projectsAffected?: number;

  /** Number of streets completed (crossed 90% threshold) */
  streetsCompleted?: number;

  /** Number of streets with improved coverage */
  streetsImproved?: number;
}
```

### ActivityImpact

Impact of an activity on a specific project.

```typescript
interface ActivityImpact {
  /** OSM IDs of streets that crossed 90% threshold */
  completed: string[];

  /** Streets with improved coverage */
  improved: Array<{
    /** OSM ID of the street */
    osmId: string;
    /** Previous percentage */
    from: number;
    /** New percentage */
    to: number;
  }>;
}
```

### ActivityDetail

Full activity detail including GPS coordinates.

```typescript
interface ActivityDetail extends ActivityListItem {
  /** GPS coordinates from activity */
  coordinates: GpxPoint[];

  /** When activity was processed (null if not yet processed) */
  processedAt: string | null;

  /** Impact on each affected project */
  projectImpacts: Array<{
    projectId: string;
    projectName: string;
    streetsCompleted: number;
    streetsImproved: number;
    impactDetails: ActivityImpact | null;
  }>;
}
```

### GpxPoint

Single GPS coordinate point.

```typescript
interface GpxPoint {
  /** Latitude */
  lat: number;

  /** Longitude */
  lng: number;

  /** Elevation in meters (optional) */
  elevation?: number;

  /** Timestamp (optional) */
  timestamp?: string;
}
```

---

## GPX Analysis Types

### MatchedStreet

Raw OSM segment match result.

```typescript
interface MatchedStreet {
  /** OSM way ID */
  osmId: string;

  /** Street name */
  name: string;

  /** OSM highway type */
  highwayType: string;

  /** Total street length in meters */
  lengthMeters: number;

  /** Distance covered in meters */
  distanceCoveredMeters: number;

  /** Coverage ratio (0-1) */
  coverageRatio: number;

  /** FULL (>= 90%) or PARTIAL (< 90%) */
  completionStatus: "FULL" | "PARTIAL";

  /** Number of GPS points matched to this street */
  matchedPointsCount: number;
}
```

### AggregatedStreet

Logical street aggregating multiple OSM segments.

```typescript
interface AggregatedStreet {
  /** Street name */
  name: string;

  /** Normalized name (lowercase, trimmed) */
  normalizedName: string;

  /** OSM highway type */
  highwayType: string;

  /** Total length of all segments */
  totalLengthMeters: number;

  /** Unique coverage (clamped to street length) */
  totalDistanceCoveredMeters: number;

  /** Actual distance run (can exceed length if ran back/forth) */
  totalDistanceRunMeters: number;

  /** Coverage ratio (0-1, clamped) */
  coverageRatio: number;

  /** Raw ratio (unclamped, for debugging) */
  rawCoverageRatio: number;

  /** FULL or PARTIAL */
  completionStatus: "FULL" | "PARTIAL";

  /** Number of OSM segments in this street */
  segmentCount: number;

  /** OSM IDs of all segments */
  segmentOsmIds: string[];
}
```

### UnnamedRoadBucket

Grouped unnamed roads by highway type.

```typescript
interface UnnamedRoadBucket {
  /** OSM highway type */
  highwayType: string;

  /** Display name (e.g., "Footpath (Unnamed)") */
  displayName: string;

  /** Total length of all segments */
  totalLengthMeters: number;

  /** Distance covered (clamped) */
  totalDistanceCoveredMeters: number;

  /** Actual distance run */
  totalDistanceRunMeters: number;

  /** Coverage ratio */
  coverageRatio: number;

  /** Number of segments */
  segmentCount: number;

  /** Segments with >= 90% coverage */
  fullCount: number;

  /** Segments with < 90% coverage */
  partialCount: number;
}
```

### GpxAnalysisResponse

Full GPX analysis response.

```typescript
interface GpxAnalysisResponse {
  success: true;

  analysis: {
    gpxName?: string;
    totalDistanceMeters: number;
    durationSeconds: number;
    pointsCount: number;
    startTime?: string;
    endTime?: string;
    movingTimeSeconds?: number;
    stoppedTimeSeconds?: number;
    avgPointSpacingMeters: number;
    maxSegmentDistanceMeters: number;
    gpsJumpCount: number;
    streetsTotal: number;
    streetsFullCount: number;
    streetsPartialCount: number;
    percentageFullStreets: number;
  };

  /** Raw segment-level data */
  segments: {
    total: number;
    fullCount: number;
    partialCount: number;
    list: MatchedStreet[];
  };

  /** Aggregated street-level data */
  streets: {
    total: number;
    fullCount: number;
    partialCount: number;
    list: AggregatedStreet[];
  };

  /** Unnamed roads grouped by type */
  unnamedRoads: {
    totalSegments: number;
    buckets: UnnamedRoadBucket[];
  };
}
```

---

## Webhook Types

### StravaWebhookPayload

Strava webhook event payload.

```typescript
interface StravaWebhookPayload {
  /** Object type (activity or athlete) */
  object_type: "activity" | "athlete";

  /** Strava object ID */
  object_id: number;

  /** Event type */
  aspect_type: "create" | "update" | "delete";

  /** Strava athlete ID (owner) */
  owner_id: number;

  /** Strava subscription ID */
  subscription_id: number;

  /** Unix timestamp of event */
  event_time: number;

  /** Updates object (for update events) */
  updates?: Record<string, unknown>;
}
```

### WebhookResponse

Response from webhook endpoint.

```typescript
interface WebhookResponse {
  /** Always "received" */
  status: "received";

  /** What action was taken */
  action: "queued" | "skipped" | "error";

  /** Job ID if queued */
  jobId?: string;

  /** Reason if skipped */
  reason?: string;

  /** Processing time in milliseconds */
  processingTimeMs?: number;
}
```

---

## Map Types

Types for the home page map view (GET /api/v1/map/streets). See [MAP_FEATURE.md](MAP_FEATURE.md) for full feature documentation.

### MapStreetStats

Stats for a single street, shown in the map info icon popup.

```typescript
interface MapStreetStats {
  /** Times the user has run on this street */
  runCount: number;
  /** Times the user achieved >= 90% coverage on this street */
  completionCount: number;
  /** Date of first run (ISO string) */
  firstRunDate: string | null;
  /** Date of most recent run (ISO string) */
  lastRunDate: string | null;
  /** Street length in meters */
  totalLengthMeters: number;
  /** Current coverage percentage (0-100) */
  currentPercentage: number;
  /** True if user has ever completed this street (>= 90%) */
  everCompleted: boolean;
  /** Length-weighted completion ratio (0–1); connectors count at CONNECTOR_WEIGHT. Used for street-level completed/partial. */
  weightedCompletionRatio: number;
  /** Number of OSM segments (parts on map) that make up this street */
  segmentCount: number;
  /** Number of segments classified as connectors (length <= CONNECTOR_MAX_LENGTH_METERS) */
  connectorCount: number;
}
```

### MapStreet

Single street for map rendering with geometry and stats.

```typescript
interface MapStreet {
  /** OpenStreetMap way ID */
  osmId: string;
  /** Street name */
  name: string;
  /** Highway type (e.g. residential, footway) */
  highwayType: string;
  /** Street length in meters */
  lengthMeters: number;
  /** Current coverage percentage (0-100) */
  percentage: number;
  /** Display status: completed (green) or partial (yellow) */
  status: "completed" | "partial";
  /** GeoJSON LineString for drawing the street on the map */
  geometry: {
    type: "LineString";
    coordinates: [number, number][]; // [lng, lat] pairs
  };
  /** Stats for the info icon popup */
  stats: MapStreetStats;
}
```

### MapStreetsResponse

Response for GET /api/v1/map/streets.

```typescript
interface MapStreetsResponse {
  success: true;
  /** Aggregated logical streets (for list and stats; one row per street name) */
  streets: MapStreet[];
  /** Segment-level streets (for map polylines; one entry per OSM way) */
  segments: MapStreet[];
  /** Request center (lat, lng) */
  center: { lat: number; lng: number };
  /** Request radius in meters */
  radiusMeters: number;
  /** Total logical streets returned */
  totalStreets: number;
  /** Count of completed streets (green) */
  completedCount: number;
  /** Count of partial streets (yellow) */
  partialCount: number;
}
```
