# Projects Feature – Detailed Implementation Plan

> **Goal:** Rename "Routes" to "Projects" across the entire codebase and implement the project-scoped map view feature. A **Project** is a user-defined area (circle or polygon) containing streets the user intends to run. The system tracks progress per project and displays a road-centric map showing completion status.

---

## Table of Contents

1. [User Stories](#1-user-stories)
2. [Acceptance Criteria](#2-acceptance-criteria)
3. [Database Changes](#3-database-changes)
4. [Backend Changes](#4-backend-changes)
5. [Frontend Changes](#5-frontend-changes)
6. [Documentation Changes](#6-documentation-changes)
7. [Implementation Phases](#7-implementation-phases)
8. [Testing Checklist](#8-testing-checklist)

---

## 1. User Stories

### 1.1 Project List

> **As a user**, I want to see a list of all my projects, so that I can quickly view my progress across different areas I'm tracking.

**Details:**

- Each project shows: name, area description (e.g. "2km radius"), completion percentage, total streets, completed streets.
- Projects are sorted by most recently updated.
- Archived projects are hidden by default (with option to show).

---

### 1.2 Create Project (Circle)

> **As a user**, I want to create a new project by placing a pin on the map and selecting a radius, so that I can define an area I want to run all streets in.

**Details:**

- User clicks "New Project" button.
- User sees a map; clicks to place centre point.
- User selects radius from allowed values (500m, 1km, 2km, 5km, 10km).
- System shows preview: street count, total length, area outline.
- User enters a project name (e.g. "Portsmouth South").
- User clicks "Create" → project is saved with street snapshot.

---

### 1.3 Create Project (Polygon) – Future Enhancement

> **As a user**, I want to create a project by drawing a polygon on the map, so that I can define a custom-shaped area (e.g. a neighbourhood boundary).

**Details:**

- User clicks "Draw polygon" mode.
- User clicks points on the map to draw boundary; double-click to finish.
- System calculates all streets within polygon.
- Same preview and naming flow as circle.

**Note:** This is a future enhancement. Initial implementation supports circle only.

---

### 1.4 View Project Detail

> **As a user**, I want to view a project's detail page, so that I can see my overall progress and recent activity impact.

**Details:**

- Shows: project name, area info, "You have run down X% of [name]".
- Shows: total streets, completed streets, in-progress streets, not-started streets.
- Shows: "Last run added N new streets (Y% of project)" (from most recent activity that touched this project).
- Link to "View project map".

---

### 1.5 Project Map View ("Map Becomes the Roads")

> **As a user**, I want to see a project-scoped map showing only the streets in that project, coloured by completion status, so that I can plan runs and see my progress visually.

**Details:**

- Map displays **only streets within the project boundary** (no streets outside).
- Base map is **minimal or hidden** ("map becomes the roads").
- Streets are coloured by status:
  - **Not run** (0%): grey or light colour
  - **Partial** (1–94%): yellow/orange
  - **Completed** (≥95%): green
- User can click a street to see: name, percentage, last run date.
- User can toggle base map on/off if desired.
- Map centres on project area and fits bounds.

---

### 1.6 Activity Processing Updates Project Progress

> **As a user**, when I complete a Strava run, I want my project progress to update automatically, so that I always see accurate completion data.

**Details:**

- Existing webhook flow: Strava → backend → activity processing.
- Overlap detection finds which projects the activity touches.
- Street matching calculates coverage for each street.
- Project snapshot and stats are updated (MAX rule: never lose progress).
- `UserStreetProgress` is updated (for global map).
- No user action required; happens in background.

---

### 1.7 Archive / Delete Project

> **As a user**, I want to archive a project I no longer want to track, so that it doesn't clutter my project list.

**Details:**

- User clicks "Archive" on project detail or list.
- Project is soft-deleted (isArchived = true).
- User can view archived projects and restore if needed.

---

### 1.8 Refresh Project Streets

> **As a user**, I want to refresh a project's street list, so that new roads added to OpenStreetMap are included.

**Details:**

- User clicks "Refresh streets" on project detail.
- System re-queries OSM for streets in the project area.
- New streets are added to snapshot (marked as "new"); existing streets retain progress.
- Stats are recalculated.

---

## 2. Acceptance Criteria

### 2.1 Naming

- [ ] All references to "Route" (feature/domain sense) are renamed to "Project" in:
  - Database tables and columns
  - Backend code (types, services, routes, constants, error codes)
  - Frontend code (types, services, components, pages, constants)
  - Documentation (all .md files, JSDoc comments, Swagger)
- [ ] React Router path constants remain named `ROUTES` (since they refer to URL routing, not the domain feature).
- [ ] Feature URL path changes from `/routes` to `/projects`.

### 2.2 Project List

- [ ] `GET /api/v1/projects` returns list of user's projects with stats.
- [ ] UI shows project cards with name, progress %, street counts.

### 2.3 Project Creation

- [ ] `GET /api/v1/projects/preview?lat=...&lng=...&radius=...` returns street preview.
- [ ] `POST /api/v1/projects` creates project with name, centre, radius, snapshot.
- [ ] UI allows placing pin, selecting radius, naming, and creating.

### 2.4 Project Detail

- [ ] `GET /api/v1/projects/:id` returns full project with streets and stats.
- [ ] UI shows progress summary and street breakdown.

### 2.5 Project Map View

- [ ] UI displays project-scoped map with streets coloured by status.
- [ ] Base map can be toggled to minimal/hidden.
- [ ] Only streets within project boundary are shown.

### 2.6 Activity Processing

- [ ] Activity processing updates `Project` (née Route) snapshots.
- [ ] Activity processing updates `UserStreetProgress`.
- [ ] Webhook flow unchanged (just renamed types/services).

### 2.7 Archive / Refresh

- [ ] `DELETE /api/v1/projects/:id` archives project.
- [ ] `POST /api/v1/projects/:id/refresh` refreshes street snapshot.

---

## 3. Database Changes

### 3.1 Table Renames

| Current Name    | New Name          |
| --------------- | ----------------- |
| `Route`         | `Project`         |
| `RouteActivity` | `ProjectActivity` |

### 3.2 Column Renames

| Table             | Current Column | New Column  |
| ----------------- | -------------- | ----------- |
| `User`            | (relation)     | `projects`  |
| `ProjectActivity` | `routeId`      | `projectId` |
| `Activity`        | (relation)     | `projects`  |

### 3.3 Index Renames

| Current Index                          | New Index                                  |
| -------------------------------------- | ------------------------------------------ |
| `Route_userId_idx`                     | `Project_userId_idx`                       |
| `Route_userId_isArchived_idx`          | `Project_userId_isArchived_idx`            |
| `RouteActivity_routeId_idx`            | `ProjectActivity_projectId_idx`            |
| `RouteActivity_activityId_idx`         | `ProjectActivity_activityId_idx`           |
| `RouteActivity_routeId_activityId_key` | `ProjectActivity_projectId_activityId_key` |

### 3.4 Prisma Schema Changes

```prisma
// Before
model Route { ... }
model RouteActivity { ... }

// After
model Project {
  id              String    @id @default(uuid())
  userId          String
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  name            String
  centerLat       Float
  centerLng       Float
  radiusMeters    Int

  streetsSnapshot Json
  snapshotDate    DateTime

  totalStreets      Int
  totalLengthMeters Float
  completedStreets  Int       @default(0)
  progress          Float     @default(0)

  deadline        DateTime?
  isArchived      Boolean   @default(false)

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  activities      ProjectActivity[]

  @@index([userId])
  @@index([userId, isArchived])
}

model ProjectActivity {
  id              String    @id @default(uuid())
  projectId       String
  activityId      String
  project         Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  activity        Activity  @relation(fields: [activityId], references: [id], onDelete: Cascade)

  streetsCompleted  Int
  streetsImproved   Int
  impactDetails     Json?

  createdAt       DateTime  @default(now())

  @@unique([projectId, activityId])
  @@index([projectId])
  @@index([activityId])
}
```

### 3.5 Migration Strategy

1. Create migration to rename tables and columns.
2. Prisma migration command: `npx prisma migrate dev --name rename_route_to_project`
3. If production data exists, use `ALTER TABLE ... RENAME TO ...` carefully.

---

## 4. Backend Changes

### 4.1 File Renames

| Current File                    | New File                          |
| ------------------------------- | --------------------------------- |
| `src/types/route.types.ts`      | `src/types/project.types.ts`      |
| `src/services/route.service.ts` | `src/services/project.service.ts` |
| `src/routes/routes.routes.ts`   | `src/routes/projects.routes.ts`   |

### 4.2 Type Renames (`src/types/project.types.ts`)

| Current Type             | New Type                   |
| ------------------------ | -------------------------- | ----------- |
| `SnapshotStreet`         | `SnapshotStreet`           | (no change) |
| `StreetSnapshot`         | `StreetSnapshot`           | (no change) |
| `CreateRouteInput`       | `CreateProjectInput`       |
| `RouteListItem`          | `ProjectListItem`          |
| `RouteDetail`            | `ProjectDetail`            |
| `RoutePreview`           | `ProjectPreview`           |
| `RouteNotFoundError`     | `ProjectNotFoundError`     |
| `RouteAccessDeniedError` | `ProjectAccessDeniedError` |

### 4.3 Service Renames (`src/services/project.service.ts`)

| Current Function          | New Function                |
| ------------------------- | --------------------------- |
| `previewRoute`            | `previewProject`            |
| `createRoute`             | `createProject`             |
| `listRoutes`              | `listProjects`              |
| `getRouteById`            | `getProjectById`            |
| `archiveRoute`            | `archiveProject`            |
| `refreshRouteSnapshot`    | `refreshProjectSnapshot`    |
| `updateRouteProgress`     | `updateProjectProgress`     |
| `detectOverlappingRoutes` | `detectOverlappingProjects` |
| `saveRouteActivity`       | `saveProjectActivity`       |

### 4.4 API Endpoint Changes (`src/routes/projects.routes.ts`)

| Current Endpoint                    | New Endpoint                          |
| ----------------------------------- | ------------------------------------- |
| `GET /api/v1/routes/preview`        | `GET /api/v1/projects/preview`        |
| `GET /api/v1/routes`                | `GET /api/v1/projects`                |
| `POST /api/v1/routes`               | `POST /api/v1/projects`               |
| `GET /api/v1/routes/:id`            | `GET /api/v1/projects/:id`            |
| `DELETE /api/v1/routes/:id`         | `DELETE /api/v1/projects/:id`         |
| `POST /api/v1/routes/:id/refresh`   | `POST /api/v1/projects/:id/refresh`   |
| `GET /api/v1/routes/:id/activities` | `GET /api/v1/projects/:id/activities` |

### 4.5 Constants Changes (`src/config/constants.ts`)

| Current Constant                   | New Constant                         |
| ---------------------------------- | ------------------------------------ |
| `ROUTES` (config object)           | `PROJECTS`                           |
| `ERROR_CODES.ROUTE_NOT_FOUND`      | `ERROR_CODES.PROJECT_NOT_FOUND`      |
| `ERROR_CODES.ROUTE_INVALID_RADIUS` | `ERROR_CODES.PROJECT_INVALID_RADIUS` |
| `ERROR_CODES.ROUTE_NO_STREETS`     | `ERROR_CODES.PROJECT_NO_STREETS`     |
| `ERROR_CODES.ROUTE_ACCESS_DENIED`  | `ERROR_CODES.PROJECT_ACCESS_DENIED`  |

### 4.6 Activity Processor Changes (`src/services/activity-processor.service.ts`)

| Current Reference       | New Reference             |
| ----------------------- | ------------------------- |
| `RouteProcessingResult` | `ProjectProcessingResult` |
| `routesProcessed`       | `projectsProcessed`       |
| `routes` (result array) | `projects`                |
| `routeId`               | `projectId`               |
| `routeName`             | `projectName`             |
| `pointsInRoute`         | `pointsInProject`         |
| All JSDoc references    | Updated                   |

### 4.7 Overlap Detection Changes (`src/services/overlap-detection.service.ts`)

| Current Reference           | New Reference               |
| --------------------------- | --------------------------- |
| `detectOverlappingRoutes`   | `detectOverlappingProjects` |
| Function parameters/returns | `Project[]` not `Route[]`   |
| JSDoc comments              | Updated                     |

### 4.8 Swagger Changes (`src/config/swagger.ts`)

| Current Schema         | New Schema               |
| ---------------------- | ------------------------ |
| `RouteListItem`        | `ProjectListItem`        |
| `RouteDetail`          | `ProjectDetail`          |
| `RoutePreview`         | `ProjectPreview`         |
| `CreateRouteRequest`   | `CreateProjectRequest`   |
| `RouteListResponse`    | `ProjectListResponse`    |
| `RouteDetailResponse`  | `ProjectDetailResponse`  |
| `RoutePreviewResponse` | `ProjectPreviewResponse` |
| Tag: `Routes`          | Tag: `Projects`          |
| All endpoint paths     | `/projects/...`          |

### 4.9 Route Index Changes (`src/routes/index.ts`)

```typescript
// Before
import routesRoutes from "./routes.routes.js";
router.use("/routes", routesRoutes);

// After
import projectsRoutes from "./projects.routes.js";
router.use("/projects", projectsRoutes);
```

### 4.10 New Feature: Project Map Endpoint

Add new endpoint to return project-scoped map data:

```typescript
/**
 * GET /api/v1/projects/:id/map
 * Returns streets for the project with status and geometry for map rendering.
 */
router.get("/:id/map", async (req, res) => {
  const project = await getProjectById(req.params.id, req.user.id);
  const mapData = await getProjectMapData(project);
  res.json({ success: true, map: mapData });
});
```

**Response shape:**

```typescript
interface ProjectMapResponse {
  success: true;
  map: {
    projectId: string;
    projectName: string;
    boundary: {
      type: "circle";
      center: { lat: number; lng: number };
      radiusMeters: number;
    };
    streets: Array<{
      osmId: string;
      name: string;
      status: "completed" | "partial" | "not_run";
      percentage: number;
      geometry: Array<{ lat: number; lng: number }>;
    }>;
    stats: {
      totalStreets: number;
      completedStreets: number;
      partialStreets: number;
      notRunStreets: number;
      completionPercentage: number;
    };
  };
}
```

---

## 5. Frontend Changes

### 5.1 File Renames

| Current File                           | New File                           |
| -------------------------------------- | ---------------------------------- |
| `src/types/api.types.ts` (Route types) | (inline renames)                   |
| `src/services/routes.service.ts`       | `src/services/projects.service.ts` |
| `src/pages/RoutesPage.tsx`             | `src/pages/ProjectsPage.tsx`       |

### 5.2 Type Renames (`src/types/api.types.ts`)

| Current Type           | New Type                 |
| ---------------------- | ------------------------ |
| `RouteListItem`        | `ProjectListItem`        |
| `RouteDetail`          | `ProjectDetail`          |
| `RoutePreview`         | `ProjectPreview`         |
| `CreateRouteRequest`   | `CreateProjectRequest`   |
| `RoutesListResponse`   | `ProjectsListResponse`   |
| `RouteDetailResponse`  | `ProjectDetailResponse`  |
| `RoutePreviewResponse` | `ProjectPreviewResponse` |
| `routesAffected`       | `projectsAffected`       |
| `routeImpacts`         | `projectImpacts`         |
| `routeId`              | `projectId`              |
| `routeName`            | `projectName`            |

### 5.3 Service Renames (`src/services/projects.service.ts`)

| Current Function        | New Function              |
| ----------------------- | ------------------------- |
| `routesService.getAll`  | `projectsService.getAll`  |
| `routesService.getById` | `projectsService.getById` |
| `routesService.preview` | `projectsService.preview` |
| `routesService.create`  | `projectsService.create`  |
| `routesService.delete`  | `projectsService.delete`  |
| `routesService.refresh` | `projectsService.refresh` |

All API paths change from `/routes/...` to `/projects/...`.

### 5.4 Constants Changes (`src/config/constants.ts`)

```typescript
// Before
export const ROUTES = {
  HOME: "/",
  LOGIN: "/login",
  AUTH_CALLBACK: "/auth/callback",
  ROUTES_LIST: "/routes",
  ROUTE_DETAIL: "/routes/:id",
  // ...
};

export const ERROR_CODES = {
  // ...
  ROUTE_NOT_FOUND: "ROUTE_NOT_FOUND",
  ROUTE_INVALID_RADIUS: "ROUTE_INVALID_RADIUS",
  ROUTE_NO_STREETS: "ROUTE_NO_STREETS",
  ROUTE_ACCESS_DENIED: "ROUTE_ACCESS_DENIED",
};

// After
export const ROUTES = {
  HOME: "/",
  LOGIN: "/login",
  AUTH_CALLBACK: "/auth/callback",
  PROJECTS_LIST: "/projects",
  PROJECT_DETAIL: "/projects/:id",
  PROJECT_MAP: "/projects/:id/map",
  // ...
};

export const ERROR_CODES = {
  // ...
  PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
  PROJECT_INVALID_RADIUS: "PROJECT_INVALID_RADIUS",
  PROJECT_NO_STREETS: "PROJECT_NO_STREETS",
  PROJECT_ACCESS_DENIED: "PROJECT_ACCESS_DENIED",
};
```

### 5.5 Router Changes (`src/App.tsx`)

```tsx
// Before
<Route path="routes" element={<RoutesPage />} />

// After
<Route path="projects" element={<ProjectsPage />} />
<Route path="projects/:id" element={<ProjectDetailPage />} />
<Route path="projects/:id/map" element={<ProjectMapPage />} />
```

### 5.6 Tab Navigation Changes (`src/components/layout/TabNav.tsx`)

```tsx
// Before
{ to: ROUTES.ROUTES_LIST, label: "Routes" },

// After
{ to: ROUTES.PROJECTS_LIST, label: "Projects" },
```

### 5.7 New Pages

#### `src/pages/ProjectsPage.tsx`

- Lists all user projects.
- Shows: name, progress %, street counts.
- Button: "New Project" → opens creation flow.
- Click project → navigates to detail.

#### `src/pages/ProjectDetailPage.tsx`

- Shows project summary: name, progress, stats.
- Shows: "Last run added N new streets".
- Button: "View Map" → navigates to project map.
- Button: "Refresh Streets", "Archive".

#### `src/pages/ProjectMapPage.tsx`

- Full-screen (or large) map of project streets.
- Streets coloured by status (not_run, partial, completed).
- Minimal or no base map (toggle available).
- Fits to project bounds.
- Click street → tooltip with name, percentage.

### 5.8 New Components

#### `src/components/projects/ProjectCard.tsx`

- Card for project list.
- Shows: name, progress bar, "X/Y streets", area info.

#### `src/components/projects/ProjectCreateModal.tsx`

- Modal or page for creating a project.
- Map for placing pin.
- Radius selector.
- Name input.
- Preview (street count, area).
- Create button.

#### `src/components/projects/ProjectMap.tsx`

- Map component for project-scoped view.
- Props: `projectId`, `streets`, `boundary`.
- Renders streets with status colours.
- Optional: base map toggle.

#### `src/components/projects/ProjectStats.tsx`

- Stats panel for project detail.
- Shows: total, completed, partial, not run counts.
- Shows: completion percentage.

### 5.9 Barrel Exports

Update `src/pages/index.ts`:

```typescript
export { ProjectsPage } from "./ProjectsPage";
export { ProjectDetailPage } from "./ProjectDetailPage";
export { ProjectMapPage } from "./ProjectMapPage";
// Remove: export { RoutesPage } from "./RoutesPage";
```

Update `src/services/index.ts`:

```typescript
export { projectsService } from "./projects.service";
// Remove: export { routesService } from "./routes.service";
```

Update `src/types/index.ts`:

```typescript
export type {
  ProjectListItem,
  ProjectDetail,
  ProjectPreview,
  CreateProjectRequest,
  ProjectsListResponse,
  ProjectDetailResponse,
  ProjectPreviewResponse,
  // Remove all Route* types
} from "./api.types";
```

---

## 6. Documentation Changes

### 6.1 Backend Docs (`backend/src/docs/`)

#### `ARCHITECTURE.md`

- Replace all "Route" → "Project" (domain sense).
- Update diagrams (Route box → Project box).
- Update "Routes Layer" section (clarify: "Routes" = HTTP endpoints, "Projects" = feature).
- Update data model diagram.
- Update ADR #4 ("JSON Snapshots in Route Table" → "...in Project Table").
- Update ADR #7 ("Radius-Based Routes" → "Radius-Based Projects").

#### `CODING_PATTERNS.md`

- Update file structure (routes.routes.ts → projects.routes.ts, route.service.ts → project.service.ts).
- Update naming conventions examples.
- Update error handling examples (RouteNotFoundError → ProjectNotFoundError).
- Update example code snippets.

#### `TYPES_REFERENCE.md`

- Rename all Route types → Project types.
- Update code examples.
- Update ActivityImpact type (routesAffected → projectsAffected, routeImpacts → projectImpacts).

#### `MAP_FEATURE.md`

- Update references to "route snapshots" → "project snapshots".
- Update flow diagrams.
- Add section on project-scoped map view.

#### `FRONTEND_GUIDE.md`

- Update API endpoint paths (/routes → /projects).
- Update example requests/responses.

#### `ERROR_REFERENCE.md`

- Rename error codes (ROUTE*\* → PROJECT*\*).
- Update descriptions.

### 6.2 Frontend Docs (`frontend/src/docs/`)

#### `CODING_PATTERNS.md`

- Update file structure (RoutesPage → ProjectsPage, routes.service → projects.service).
- Update ROUTES constant examples.
- Update type examples.

#### `COMPONENT_GUIDE.md`

- Update TabNav section (Routes → Projects).
- Add new component docs (ProjectCard, ProjectMap, etc.).

#### `AUTH_FLOW.md`

- Update route examples (RoutesPage → ProjectsPage).

### 6.3 Root Docs

#### `backend/FEATURES.md`

- Add note: "Routes" feature renamed to "Projects".
- Update references.

#### `backend/PROJECTS_FEATURE_PLAN.md` (this file)

- Keep as implementation reference.

### 6.4 Swagger (`backend/src/config/swagger.ts`)

- Update all schema names.
- Update all endpoint paths.
- Update tag from "Routes" to "Projects".
- Update descriptions and examples.

---

## 7. Implementation Phases

### Phase 1: Backend Rename (No New Features)

**Goal:** Rename Route → Project in backend without breaking functionality.

**Steps:**

1. [ ] Create Prisma migration to rename tables/columns.
2. [ ] Rename `src/types/route.types.ts` → `src/types/project.types.ts`.
3. [ ] Update all type names in `project.types.ts`.
4. [ ] Rename `src/services/route.service.ts` → `src/services/project.service.ts`.
5. [ ] Update all function names in `project.service.ts`.
6. [ ] Rename `src/routes/routes.routes.ts` → `src/routes/projects.routes.ts`.
7. [ ] Update all endpoint paths in `projects.routes.ts`.
8. [ ] Update `src/routes/index.ts` to import `projects.routes.ts`.
9. [ ] Update `src/config/constants.ts` (ROUTES → PROJECTS config, error codes).
10. [ ] Update `src/services/activity-processor.service.ts` (all references).
11. [ ] Update `src/services/overlap-detection.service.ts` (all references).
12. [ ] Update `src/services/activity.service.ts` (listActivitiesForRoute → listActivitiesForProject).
13. [ ] Update `src/config/swagger.ts` (all schemas, paths, tags).
14. [ ] Update all JSDoc comments in affected files.
15. [ ] Run `npx prisma generate` to update Prisma client.
16. [ ] Run tests to verify nothing broke.

**Estimated changes:** ~15 files, ~500 lines.

---

### Phase 2: Frontend Rename (No New Features)

**Goal:** Rename Route → Project in frontend to match backend.

**Steps:**

1. [ ] Update `src/types/api.types.ts` (all Route types → Project types).
2. [ ] Rename `src/services/routes.service.ts` → `src/services/projects.service.ts`.
3. [ ] Update all function names and API paths in `projects.service.ts`.
4. [ ] Rename `src/pages/RoutesPage.tsx` → `src/pages/ProjectsPage.tsx`.
5. [ ] Update component name and content in `ProjectsPage.tsx`.
6. [ ] Update `src/config/constants.ts` (ROUTES paths, ERROR_CODES).
7. [ ] Update `src/App.tsx` (route path, import).
8. [ ] Update `src/components/layout/TabNav.tsx` (label: "Projects").
9. [ ] Update `src/pages/index.ts` (export ProjectsPage).
10. [ ] Update `src/services/index.ts` (export projectsService).
11. [ ] Update `src/types/index.ts` (export Project types).
12. [ ] Verify app compiles and runs.

**Estimated changes:** ~10 files, ~200 lines.

---

### Phase 3: Documentation Update

**Goal:** Update all docs to reflect rename.

**Steps:**

1. [x] Update `backend/src/docs/ARCHITECTURE.md`.
2. [x] Update `backend/src/docs/CODING_PATTERNS.md`.
3. [x] Update `backend/src/docs/TYPES_REFERENCE.md`.
4. [x] Update `backend/src/docs/MAP_FEATURE.md`.
5. [x] Update `backend/src/docs/FRONTEND_GUIDE.md`.
6. [x] Update `backend/src/docs/ERROR_REFERENCE.md`.
7. [x] Update `frontend/src/docs/CODING_PATTERNS.md`.
8. [x] Update `frontend/src/docs/COMPONENT_GUIDE.md`.
9. [x] Update `frontend/src/docs/AUTH_FLOW.md`.
10. [x] Update `backend/FEATURES.md`.

**Estimated changes:** ~10 files, ~300 lines.

---

### Phase 4: Project Map Endpoint (Backend)

**Goal:** Add `GET /api/v1/projects/:id/map` endpoint.

**Steps:**

1. [ ] Add `ProjectMapResponse` type to `project.types.ts`.
2. [ ] Add `getProjectMapData` function to `project.service.ts`.
3. [ ] Add `/projects/:id/map` endpoint to `projects.routes.ts`.
4. [ ] Add Swagger documentation for new endpoint.
5. [ ] Write tests for new endpoint.

**Estimated changes:** ~3 files, ~150 lines.

---

### Phase 5: Project List & Detail Pages (Frontend)

**Goal:** Implement ProjectsPage and ProjectDetailPage.

**Steps:**

1. [ ] Create `src/components/projects/ProjectCard.tsx`.
2. [ ] Create `src/components/projects/ProjectStats.tsx`.
3. [ ] Implement `src/pages/ProjectsPage.tsx` (list view).
4. [ ] Create `src/pages/ProjectDetailPage.tsx`.
5. [ ] Add route to `App.tsx`.
6. [ ] Style and test.

**Estimated changes:** ~5 files, ~400 lines.

---

### Phase 6: Project Map Page (Frontend)

**Goal:** Implement ProjectMapPage with road-centric view.

**Steps:**

1. [ ] Create `src/components/projects/ProjectMap.tsx`.
2. [ ] Create `src/pages/ProjectMapPage.tsx`.
3. [ ] Add `getProjectMap` function to `projects.service.ts`.
4. [ ] Add route to `App.tsx`.
5. [ ] Implement street colouring (not_run, partial, completed).
6. [ ] Implement minimal base map toggle.
7. [ ] Implement street click → tooltip.
8. [ ] Style and test.

**Estimated changes:** ~4 files, ~350 lines.

---

### Phase 7: Project Creation Flow (Frontend)

**Goal:** Implement project creation UI.

**Steps:**

1. [ ] Create `src/components/projects/ProjectCreateModal.tsx` (or page).
2. [ ] Implement map with pin placement.
3. [ ] Implement radius selector.
4. [ ] Implement preview display.
5. [ ] Implement name input and create button.
6. [ ] Connect to `projectsService.preview` and `projectsService.create`.
7. [ ] Navigate to new project on success.
8. [ ] Style and test.

**Estimated changes:** ~3 files, ~400 lines.

---

## 8. Testing Checklist

### 8.1 Backend Tests

- [ ] `GET /api/v1/projects` returns user's projects.
- [ ] `GET /api/v1/projects/preview` returns street preview.
- [ ] `POST /api/v1/projects` creates project with snapshot.
- [ ] `GET /api/v1/projects/:id` returns project detail.
- [ ] `DELETE /api/v1/projects/:id` archives project.
- [ ] `POST /api/v1/projects/:id/refresh` refreshes snapshot.
- [ ] `GET /api/v1/projects/:id/map` returns map data.
- [ ] Activity processing updates project progress.
- [ ] Overlap detection works with renamed models.

### 8.2 Frontend Tests

- [ ] Projects tab navigates to `/projects`.
- [ ] Projects list loads and displays.
- [ ] Project card shows correct data.
- [ ] Project detail page loads.
- [ ] Project map page loads with streets.
- [ ] Streets are coloured correctly by status.
- [ ] Project creation flow works end-to-end.
- [ ] Strava sync updates project progress.

### 8.3 Integration Tests

- [ ] Full flow: auth → create project → sync activity → view updated progress.
- [ ] Project map shows correct status after activity processing.

---

## Summary

| Phase     | Description                 | Files  | Lines (est.) |
| --------- | --------------------------- | ------ | ------------ |
| 1         | Backend rename              | 15     | 500          |
| 2         | Frontend rename             | 10     | 200          |
| 3         | Documentation update        | 10     | 300          |
| 4         | Project map endpoint        | 3      | 150          |
| 5         | Project list & detail pages | 5      | 400          |
| 6         | Project map page            | 4      | 350          |
| 7         | Project creation flow       | 3      | 400          |
| **Total** |                             | **50** | **~2300**    |

---

## Next Steps

1. Review and approve this plan.
2. Start with **Phase 1: Backend Rename**.
3. Proceed phase by phase, testing after each.
4. Update this document as implementation progresses.
