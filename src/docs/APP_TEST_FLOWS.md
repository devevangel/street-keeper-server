# Street Keeper — App Test Flows & Feature Reference

> **What this document is:** A complete walkthrough of every feature in Street Keeper, how to test it, what API endpoints are hit, what data is returned, and the current status (implemented vs planned). This is the source of truth for what the app does today.

---

## Table of Contents

1. [Authentication & Login](#authentication--login)
2. [Homepage](#homepage)
3. [Strava Sync](#strava-sync)
4. [Projects List](#projects-list)
5. [Project Creation](#project-creation)
6. [Project Detail Page](#project-detail-page)
7. [Project Map](#project-map)
8. [Project Heatmap](#project-heatmap)
9. [Project Suggestions Map](#project-suggestions-map)
10. [Milestones (MVP)](#milestones-mvp)
11. [Milestones Page (Global)](#milestones-page-global)
12. [GPX Analysis (V1 & V2)](#gpx-analysis-v1--v2)
13. [Activity Processing Pipeline](#activity-processing-pipeline)
14. [Map View (Homepage)](#map-view-homepage)
15. [Analytics](#analytics)
16. [Planned Features (Not Yet Implemented)](#planned-features-not-yet-implemented)

---

## Authentication & Login

### Page: `/login`

**What the user sees:**
- "Login with Strava" button (OAuth flow)
- Dev mode: paste a user UUID to bypass OAuth (development only)

**Test flow:**

| Step | User action | What happens | API endpoint |
|------|-------------|--------------|--------------|
| 1 | Click "Login with Strava" | Redirects to Strava OAuth consent page | `GET /api/v1/auth/strava` → returns `{ url }` (Strava authorization URL) |
| 2 | User approves on Strava | Strava redirects to `/auth/callback?code=...` | — |
| 3 | Callback page loads | Frontend sends code to backend | `GET /api/v1/auth/strava/callback?code=...` → returns `{ success, user: { id, name, stravaId, profilePic }, token }` |
| 4 | Token stored in localStorage | User is redirected to homepage | — |
| 5 | On every page load | Frontend calls `/auth/me` to verify session | `GET /api/v1/auth/me` → returns `{ success, user }` or 401 |

**Dev mode flow:**
1. Paste a UUID into the "User UUID" input
2. Click "Use Dev User"
3. UUID stored in localStorage as `x-user-id` header for all requests
4. No Strava OAuth needed

---

## Homepage

### Page: `/` (root, authenticated)

**What the user sees:**
- Search bar (geocode to fly map to a location)
- "Use my location" button
- Dynamic hero section (changes based on user state)
- Suggestion card ("next street to run")
- Progress ring (next milestone)
- Today's highlights (recent run stats)
- Map with completed/partial streets (green/yellow polylines)
- "Sync from Strava" button
- Streak block (weekly running streak)

**Test flow:**

| Step | User action | What happens | API endpoint |
|------|-------------|--------------|--------------|
| 1 | Page loads | Browser asks for location permission | — |
| 2 | Location granted | Map centers on user location, homepage data loads | `GET /api/v1/homepage?lat=...&lng=...&radius=1000` |
| 3 | — | Map streets load for area | `GET /api/v1/map/streets?lat=...&lng=...&radius=1000` |
| 4 | User pans map | New streets load when panned > 200m | `GET /api/v1/map/streets?lat=...&lng=...&radius=1000` (new center) |
| 5 | User types in search | Geocode results appear | `GET /api/v1/geocode?q=...` |
| 6 | User selects search result | Map flies to location, homepage data refreshes | `GET /api/v1/homepage` + `GET /api/v1/map/streets` (new center) |
| 7 | User clicks "Show on Map" on suggestion | Map scrolls into view, highlights suggested streets | — (frontend only, uses suggestion.focus data) |

**Homepage payload** (`GET /api/v1/homepage`):

```json
{
  "success": true,
  "data": {
    "hero": {
      "stateKey": "active_runner",
      "headline": "You're on a roll!",
      "subline": "3 streets completed this week",
      "emoji": "🔥"
    },
    "streak": {
      "currentWeeks": 4,
      "longestWeeks": 6,
      "lastActivityDate": "2026-02-10T..."
    },
    "primarySuggestion": {
      "type": "nearby_street",
      "title": "High Street",
      "subtitle": "72% complete — finish it!",
      "cooldownKey": "nearby:high-street",
      "focus": {
        "bbox": [50.78, -1.09, 50.80, -1.07],
        "streetIds": ["way/123"],
        "startPoint": { "lat": 50.79, "lng": -1.08 }
      }
    },
    "nextMilestone": {
      "id": "...",
      "name": "10% of Portsmouth",
      "typeSlug": "project_percent",
      "progress": { "currentValue": 8.5, "targetValue": 10, "unit": "percent", "ratio": 0.85, "isCompleted": false }
    },
    "recentHighlights": [...],
    "lastRun": { "date": "2026-02-10T...", "distance": 5200, "streets": 12 },
    "mapContext": { "projectId": "...", "lat": 50.79, "lng": -1.08 }
  }
}
```

---

## Background Sync (Onboarding)

**When:** New user completes Strava OAuth and has no activities; onboarding modal reaches step 3 "Syncing your runs."

**Test flow:**

| Step | User action | What happens | API endpoint |
|------|-------------|--------------|--------------|
| 1 | User reaches sync step | Frontend calls sync with `background=true` | `POST /api/v1/activities/sync?background=true` |
| 2 | Backend | Duplicate guard; paginated Strava fetch (all pages); create SyncJob; enqueue pg-boss job; return immediately | Returns `{ success, syncId, total, status: "queued" }` |
| 3 | After ~4s | Onboarding modal closes; user is navigated to homepage | — |
| 4 | Homepage | SyncBanner appears: "Preparing to sync…" then "Syncing your runs… X of Y processed" with progress bar | Frontend polls `GET /api/v1/activities/sync/status` every 3s while status is queued/running |
| 5 | Worker | Processes activities sequentially (300ms delay); updates SyncJob after each | — |
| 6 | Sync completes | Banner shows "Sync complete! N activities synced."; auto-dismisses after 5s; map refetches streets | Status transitions to `completed`; frontend triggers map + homepage refetch once |

**Empty database test:** Reset DB (e.g. `npm run db:reset`). Log in as new user. Homepage loads with base map and zero streets; no errors. Start onboarding; after background sync starts, homepage shows SyncBanner and streets appear progressively as sync runs.

---

## Returning User Test Flow

**When:** User who already has activities logs in again (e.g. different device, or cleared localStorage).

| Step | User action | What happens | API endpoint |
|------|-------------|--------------|--------------|
| 1 | User completes Strava OAuth | Redirect to `/auth/callback?userId=...` | — |
| 2 | Callback page | Sets user; fetches activity count | `GET /api/v1/activities?page=1&pageSize=1` (uses `total`) |
| 3 | If total > 0 | User is treated as returning; navigate to HOME immediately; onboarding is skipped | — |
| 4 | If total === 0 | Check localStorage; if onboarding not completed, show onboarding; otherwise go HOME | — |

**Test:** Clear localStorage, log in with an account that has synced activities. You should land on the homepage with no onboarding modal.

---

## Strava Sync

### Trigger: "Sync from Strava" button on homepage

**Test flow:**

| Step | User action | What happens | API endpoint |
|------|-------------|--------------|--------------|
| 1 | Click "Sync from Strava" | Button shows "Syncing…" | `POST /api/v1/activities/sync` |
| 2 | Backend fetches recent activities from Strava | New activities saved to DB, processed against projects | — (backend internal) |
| 3 | Processing complete | Response returns counts | Response: `{ success, synced: 5, processed: 5, skipped: 2 }` |
| 4 | Frontend refreshes | Homepage data and map streets re-fetch | `GET /api/v1/homepage` + `GET /api/v1/map/streets` |

**What "processed" means:**
- Each activity's GPS points are matched against user's projects
- Street progress is updated (V1 or V2 engine depending on `GPX_ENGINE_VERSION`)
- Milestone progress is updated (`updateMilestoneProgress`)
- Milestone completions are checked (`checkMilestoneCompletion`) and share messages generated
- Global milestones are auto-created if needed

**Sync endpoint details** (`POST /api/v1/activities/sync`):

| Parameter | Type | Description |
|-----------|------|-------------|
| `after` (query) | integer | Unix timestamp; only activities after this time |
| `perPage` (query) | integer | Max activities to fetch (default 30, max 200) |

Response:
```json
{
  "success": true,
  "synced": 5,
  "processed": 5,
  "skipped": 2,
  "activities": [
    { "id": "...", "stravaId": "...", "name": "Morning Run", "distanceMeters": 5200 }
  ]
}
```

---

## Projects List

### Page: `/projects`

**What the user sees:**
- List of project cards (name, progress %, radius, street count)
- "New Project" button

**Test flow:**

| Step | User action | What happens | API endpoint |
|------|-------------|--------------|--------------|
| 1 | Page loads | Fetches user's projects | `GET /api/v1/projects` |
| 2 | User clicks a project card | Navigates to project detail | — |
| 3 | User clicks "New Project" | Navigates to `/projects/new` | — |

**Projects list response** (`GET /api/v1/projects`):
```json
{
  "success": true,
  "projects": [
    {
      "id": "uuid",
      "name": "Portsmouth",
      "centerLat": 50.79,
      "centerLng": -1.09,
      "radiusMeters": 2000,
      "totalStreets": 120,
      "completedStreets": 45,
      "progress": 37.5,
      "createdAt": "2026-02-01T...",
      "isArchived": false
    }
  ],
  "total": 1
}
```

---

## Project Creation

### Page: `/projects/new`

**What the user sees:**
- Map with click-to-place marker
- Search bar to find a location
- "Use my location" button
- Radius slider (100m–10000m, default 200m)
- Boundary mode toggle ("Include partial streets" checkbox)
- Auto-preview: street count, total length, warnings
- Project name input
- "Create Project" button
- Success modal with project link

**Test flow:**

| Step | User action | What happens | API endpoint |
|------|-------------|--------------|--------------|
| 1 | Click map or search | Marker placed, preview auto-fetches | `GET /api/v1/projects/preview?lat=...&lng=...&radius=...&boundaryMode=...` |
| 2 | Adjust radius slider | Preview re-fetches (debounced 400ms) | `GET /api/v1/projects/preview?lat=...&lng=...&radius=...` |
| 3 | Toggle boundary mode | Preview re-fetches | Same as above |
| 4 | Enter project name | — | — |
| 5 | Click "Create Project" | Project created, milestones auto-generated | `POST /api/v1/projects` body: `{ name, centerLat, centerLng, radiusMeters, boundaryMode }` |
| 6 | Success | Modal shows: "Created with N streets" | Response: `{ success, project: { id, name, totalStreets, ... } }` |

**Preview response** (`GET /api/v1/projects/preview`):
```json
{
  "success": true,
  "preview": {
    "streetCount": 85,
    "totalLengthMeters": 42000,
    "cacheKey": "geo:radius:50.790:-1.090:2000",
    "warnings": []
  }
}
```

**What happens on create (backend):**
1. Streets queried from Overpass (or cache)
2. Snapshot stored in project
3. `createMVPMilestonesForProject()` called → generates 4-7 milestones (first_street, street_count, percentage targets based on project size)
4. `createAutoMilestones()` called → generates legacy percentage milestones (5%, 10%, 25%, etc.)

---

## Project Detail Page

### Page: `/projects/:id`

**What the user sees:**
- Breadcrumb navigation
- Welcome banner (for new projects)
- Project name, radius badge, last run date, activity count
- Refresh streets / Archive buttons
- Progress hero (progress %, completed/total streets, streak)
- "See next streets to run" CTA
- Stat cards (activities, distance, streets/week, projected finish)
- **MVP Milestones Section** (active goals with progress bars)
- Suggestions panel
- Map thumbnail
- Recent runs (activity feed, last 5)
- Collapsible sections: All streets, Milestones (legacy), Progress over time, Progress breakdown, Run impact chart, About this project, Streets by type
- Radius resize modal

**Test flow:**

| Step | User action | What happens | API endpoint |
|------|-------------|--------------|--------------|
| 1 | Page loads | Project detail + activities fetched in parallel | `GET /api/v1/projects/:id?include=streets` + `GET /api/v1/projects/:id/activities` |
| 2 | Milestones section loads | MVP milestones fetched | `GET /api/v1/projects/:id/milestones` |
| 3 | If pending celebration exists | Celebration modal shows with confetti + share message | — (from milestones response `pendingCelebrations`) |
| 4 | User clicks "Keep Going!" on celebration | Celebration acknowledged | `POST /api/v1/milestones/:id/acknowledge` |
| 5 | User clicks "Refresh streets" | Project snapshot refreshed from OSM | `POST /api/v1/projects/:id/refresh` |
| 6 | User clicks "Archive" | Project soft-deleted | `DELETE /api/v1/projects/:id` |
| 7 | User clicks "Change" radius | Radius resize modal opens, user picks new radius | `PATCH /api/v1/projects/:id` body: `{ radiusMeters }` |
| 8 | User clicks "See next streets to run" | Navigates to suggestions map | — |

**Project detail response** (`GET /api/v1/projects/:id?include=streets`):
```json
{
  "success": true,
  "project": {
    "id": "uuid",
    "name": "Portsmouth",
    "progress": 37.5,
    "completedStreets": 45,
    "totalStreets": 120,
    "totalLengthMeters": 42000,
    "radiusMeters": 2000,
    "activityCount": 12,
    "lastActivityDate": "2026-02-10T...",
    "streets": [...],
    "streetsByType": [...],
    "completionBins": { ... },
    "nextMilestone": { ... },
    "currentStreak": 4,
    "longestStreak": 6
  }
}
```

**Project milestones response** (`GET /api/v1/projects/:id/milestones`):
```json
{
  "success": true,
  "active": [
    { "id": "...", "name": "Complete 10 streets", "targetValue": 10, "currentValue": 7, "type": { "slug": "street_count" } }
  ],
  "completed": [
    { "id": "...", "name": "First street!", "targetValue": 1, "currentValue": 1, "completedAt": "2026-02-05T..." }
  ],
  "pendingCelebrations": [
    { "id": "...", "name": "Complete 5 streets", "projectName": "Portsmouth", "completedAt": "2026-02-10T...", "shareMessage": "Complete 5 streets — crushed it! 💪\n— via Street Keeper" }
  ]
}
```

---

## Project Map

### Page: `/projects/:id/map`

**What the user sees:**
- Full-screen Leaflet map
- Color-coded streets: green (completed), yellow (partial), grey (not started)
- Project boundary circle
- Street click shows info popup

**Test flow:**

| Step | User action | What happens | API endpoint |
|------|-------------|--------------|--------------|
| 1 | Page loads | Map data fetched | `GET /api/v1/projects/:id/map` |
| 2 | User clicks a street | Popup shows street name, progress %, run count | — (frontend, from map data) |

**Map data response** (`GET /api/v1/projects/:id/map`):
```json
{
  "success": true,
  "map": {
    "streets": [
      { "osmId": "way/123", "name": "High Street", "status": "completed", "percentage": 100, "geometry": { "type": "LineString", "coordinates": [...] } }
    ],
    "boundary": { "centerLat": 50.79, "centerLng": -1.09, "radiusMeters": 2000 },
    "stats": { "total": 120, "completed": 45, "partial": 30, "notStarted": 45 }
  }
}
```

---

## Project Heatmap

### Page: `/projects/:id/heatmap`

**What the user sees:**
- Heatmap overlay showing activity density in the project area

**Test flow:**

| Step | User action | What happens | API endpoint |
|------|-------------|--------------|--------------|
| 1 | Page loads | Heatmap data fetched | `GET /api/v1/projects/:id/heatmap` |

---

## Project Suggestions Map

### Page: `/projects/:id/suggestions`

**What the user sees:**
- Map highlighting streets to run next (based on proximity, near-completion, clusters)

**Test flow:**

| Step | User action | What happens | API endpoint |
|------|-------------|--------------|--------------|
| 1 | Page loads | Suggestions fetched | `GET /api/v1/projects/:id/suggestions?lat=...&lng=...` |
| 2 | Map shows suggested streets | User can click for details | — |

---

## Milestones (MVP)

### Where it appears: Project Detail Page → "Your Goals" section

**Current implementation (Phase 1 MVP):**

| Feature | Status | Description |
|---------|--------|-------------|
| Auto-generated milestones | **Implemented** | 4-7 milestones created on project creation based on size |
| Progress tracking | **Implemented** | `currentValue` updates after activity sync |
| Completion detection | **Implemented** | `completedAt` set when `currentValue >= targetValue` |
| Message engine (116 templates) | **Implemented** | Random template from 10 categories, fills placeholders |
| Celebration modal | **Implemented** | Shows on project detail page when pending celebration exists |
| Share message copy | **Implemented** | "Copy" button copies generated share message to clipboard |
| Milestone acknowledgment | **Implemented** | "Keep Going!" button marks celebration as shown |
| Pending celebration check on app load | **Implemented** | `PendingCelebrationsChecker` in AppLayout checks all projects |

**MVP milestone types (seeded):**

| Slug | Name | Example milestones generated |
|------|------|------------------------------|
| `first_street` | First Street | "First street!" (target: 1) |
| `street_count` | Streets Completed | "Complete 3/5/10/25/50 streets" |
| `percentage` | Percentage Complete | "25%/50%/75%/100% complete!" |

**Auto-generation logic** (based on project size):

| Project size | Streets | Milestones generated |
|--------------|---------|---------------------|
| Tiny | ≤ 15 | First street, 3 streets, 50%, 100% |
| Small | 16–50 | First street, 5, 10, 50%, 100% |
| Medium | 51–150 | First street, 10, 25, 25%, 50%, 100% |
| Large | 151+ | First street, 10, 25, 50, 25%, 50%, 75%, 100% |

**Message engine categories (116 templates):**

| Category | Count | When used |
|----------|-------|-----------|
| Celebratory | 15 | General milestones |
| Casual | 12 | General milestones |
| Proud | 12 | General milestones |
| First | 10 | First street milestone |
| Completion | 15 | 100% project completion |
| Identity | 12 | General milestones |
| Playful | 12 | General milestones |
| Stats | 10 | General milestones |
| Motivational | 10 | General milestones |
| Percentage | 8 | Percentage milestones |

**Relevant API endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/projects/:id/milestones` | Get active, completed, and pending celebrations for a project |
| `POST` | `/api/v1/milestones/:id/acknowledge` | Mark celebration as shown (`celebrationShownAt = now()`) |
| `GET` | `/api/v1/milestones` | List all user milestones with computed progress |
| `GET` | `/api/v1/milestones/next` | Get the "next" milestone (pinned > closest > small win) |
| `POST` | `/api/v1/milestones` | Create custom milestone |
| `DELETE` | `/api/v1/milestones/:id` | Delete custom milestone |
| `PATCH` | `/api/v1/milestones/:id/pin` | Pin/unpin milestone |
| `GET` | `/api/v1/milestones/milestone-types` | List available (enabled) milestone types |

---

## Milestones Page (Global)

### Page: `/milestones`

**What the user sees:**
- All milestones across all projects + global milestones
- Search by name
- Filter by status: All, Almost there (≥70%), In progress, Not started
- Filter by project or "Global only"
- Pin/unpin milestones (pinned shows on homepage)
- Delete custom milestones
- "Add global milestone" button → CreateMilestoneModal

**Test flow:**

| Step | User action | What happens | API endpoint |
|------|-------------|--------------|--------------|
| 1 | Page loads | All milestones + projects fetched | `GET /api/v1/milestones` + `GET /api/v1/projects` |
| 2 | Type in search | Filters milestones client-side by name | — |
| 3 | Change status filter | Filters by progress ratio | — |
| 4 | Change project filter | Filters by projectId | — |
| 5 | Click pin icon | Toggle pin status | `PATCH /api/v1/milestones/:id/pin` body: `{ isPinned: true/false }` |
| 6 | Click delete (custom only) | Confirm dialog, then delete | `DELETE /api/v1/milestones/:id` |
| 7 | Click "Add global milestone" | Modal opens with type picker and config | `GET /api/v1/milestones/milestone-types` → then `POST /api/v1/milestones` |

---

## GPX Analysis (V1 & V2)

### V1: `POST /api/v1/runs/analyze-gpx` or `POST /api/v1/engine-v1/analyze`

**What it does:** Upload a GPX file, get street coverage analysis using Overpass + optional Mapbox matching.

**Test flow:**
1. Upload GPX file (multipart form data)
2. Backend parses GPS points
3. Queries Overpass for streets in bounding box
4. Matches GPS points to streets (Mapbox hybrid or Overpass-only)
5. Returns matched streets with coverage percentages

### V2: `POST /api/v1/engine-v2/analyze?userId=...`

**What it does:** Upload a GPX file, mark hit nodes (25m proximity), derive street completion from node counts.

**Test flow:**
1. Upload GPX file with `userId` query param
2. Backend parses GPS points
3. For each point, queries NodeCache for nodes within 25m
4. Upserts UserNodeHit rows (persisted!)
5. Derives street completion: (nodes hit / total nodes) per way
6. Returns streets with completion status

**Key difference:** V2 persists node hits. V1 is one-off analysis.

---

## Activity Processing Pipeline

**Trigger:** `POST /api/v1/activities/sync` or Strava webhook

**Pipeline (per activity):**

```
Activity GPS Points
  │
  ├─ Detect overlapping projects (bbox check)
  │
  ├─ For each project:
  │   ├─ V1: Query geometries → match streets → calculate coverage → update project progress
  │   ├─ V2: processActivityV2() → mark node hits → deriveProjectProgressV2Scoped() → update project progress
  │   ├─ Update UserStreetProgress
  │   ├─ Save ProjectActivity
  │   ├─ updateMilestoneProgress() → update currentValue for MVP milestones
  │   └─ checkMilestoneCompletion() → generate shareMessage if completed
  │
  ├─ If no projects: process standalone (map feature only)
  │
  └─ createGlobalAutoMilestonesIfNeeded()
```

---

## Map View (Homepage)

### Endpoint: `GET /api/v1/map/streets`

**Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `lat` | float | Yes | Center latitude |
| `lng` | float | Yes | Center longitude |
| `radius` | int | No | Radius in meters (default 2000, max 10000) |

**Response:**
```json
{
  "success": true,
  "streets": [
    {
      "osmId": "way/123",
      "name": "High Street",
      "percentage": 85,
      "status": "partial",
      "runCount": 3,
      "lengthMeters": 450,
      "geometry": { "type": "LineString", "coordinates": [[lng, lat], ...] }
    }
  ],
  "segments": [...],
  "stats": { "total": 50, "completed": 20, "partial": 15, "totalLengthMeters": 25000 }
}
```

---

## Analytics

### Endpoint: `POST /api/v1/analytics/events`

**What it tracks:** Client-side events for metrics (homepage_viewed, sync_clicked, suggestion_opened, etc.)

---

## Planned Features (Not Yet Implemented)

### From Homepage & Engagement Plan

| Feature | Status | Phase |
|---------|--------|-------|
| Dynamic hero (contextual messages) | **Implemented** | Current |
| Suggestion card (next street to run) | **Implemented** | Current |
| Progress ring (next milestone) | **Implemented** | Current |
| Streak block | **Implemented** | Current |
| Today's highlights | **Implemented** | Current |
| Map with suggestion highlighting | **Implemented** | Current |
| Analytics tracking | **Implemented** | Current |

### From Milestones & Goals Plan

| Feature | Status | Phase |
|---------|--------|-------|
| Auto-generated milestones | **Implemented** | Phase 1 MVP |
| Progress tracking | **Implemented** | Phase 1 MVP |
| Completion detection + share message | **Implemented** | Phase 1 MVP |
| Message engine (116 templates) | **Implemented** | Phase 1 MVP |
| Celebration modal | **Implemented** | Phase 1 MVP |
| Pending celebration check | **Implemented** | Phase 1 MVP |
| Custom goal wizard (2-step) | Not implemented | Phase 2 |
| Smart suggestions (data-driven goals) | Not implemented | Phase 2 |
| Trophy case | Not implemented | Phase 2 |
| Bottom sheet UI (mobile) | Not implemented | Phase 2 |
| Timing variants (recurring, deadline, streak goals) | Not implemented | Phase 3 |
| Actual Strava posting (OAuth scope upgrade) | Not implemented | Phase 4 |
| Confetti animation (react-confetti) | Not implemented (uses emoji) | Nice-to-have |

### Other Planned Features (from Product Roadmap)

| Feature | Status | Description |
|---------|--------|-------------|
| Strava webhook auto-sync | **Implemented** | Activities auto-imported via webhook |
| V2 engine (node proximity) | **Implemented** | CityStrides-style matching |
| PBF seeding | **Implemented** | Offline street data |
| Run summaries & sharing | Not implemented | Generate shareable run summary images |
| Weekly digest emails | Not implemented | Summary of progress each week |
| Challenge system | Not implemented | Compete with others |
| Leaderboards | Not implemented | Per-area leaderboards |
| Multi-region support | Partial | Currently limited to seeded PBF region |

---

## Deviations from Original Plans

### Homepage & Engagement Plan deviations

| Original plan | Current reality |
|---------------|-----------------|
| "Campaign" page for area-based exploration | `CampaignPage` exists but minimal functionality |
| Full "Strava posting" of milestones | Share message generated and copyable; actual Strava post deferred to Phase 4 |
| "Weekly digest" emails | Not implemented |
| "Push notifications" for streak reminders | Not implemented |

### Milestones Plan deviations

| Original plan | Current reality |
|---------------|-----------------|
| MilestoneType has a `milestones` relation | Added in schema; MVP milestones use `typeId` FK. Legacy milestones use `typeSlug` string |
| `UserMilestone` has `targetValue` and `currentValue` | Implemented as optional (nullable) fields for backward compatibility with legacy milestones |
| `react-confetti` for celebration | Using emoji + CSS animation instead |
| Schema uses `typeId` FK to MilestoneType | Implemented; legacy fields (`typeSlug`, `kind`, `config`, `configKey`) kept nullable for backward compatibility |
| 3 MVP types only | 3 MVP types + all legacy types coexist in MilestoneType table |

---

## Quick Reference: All API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/auth/me` | Yes | Get current user |
| `GET` | `/api/v1/auth/strava` | No | Start Strava OAuth |
| `GET` | `/api/v1/auth/strava/callback` | No | OAuth callback |
| `GET` | `/api/v1/homepage` | Yes | Homepage payload (hero, streak, suggestion, milestone) |
| `GET` | `/api/v1/map/streets` | Yes | Streets with geometry for map |
| `GET` | `/api/v1/geocode` | Yes | Geocode search |
| `GET` | `/api/v1/projects` | Yes | List projects |
| `GET` | `/api/v1/projects/preview` | Yes | Preview streets before creating |
| `POST` | `/api/v1/projects` | Yes | Create project |
| `GET` | `/api/v1/projects/:id` | Yes | Project detail |
| `PATCH` | `/api/v1/projects/:id` | Yes | Resize project |
| `DELETE` | `/api/v1/projects/:id` | Yes | Archive project |
| `POST` | `/api/v1/projects/:id/refresh` | Yes | Refresh street data |
| `GET` | `/api/v1/projects/:id/map` | Yes | Project map data |
| `GET` | `/api/v1/projects/:id/heatmap` | Yes | Project heatmap data |
| `GET` | `/api/v1/projects/:id/suggestions` | Yes | Suggested streets |
| `GET` | `/api/v1/projects/:id/activities` | Yes | Project activities |
| `GET` | `/api/v1/projects/:id/milestones` | Yes | MVP milestones for project |
| `POST` | `/api/v1/projects/:id/recompute-progress` | Yes | Recompute from V2 |
| `GET` | `/api/v1/activities` | Yes | List activities |
| `POST` | `/api/v1/activities/sync` | Yes | Sync from Strava |
| `GET` | `/api/v1/activities/:id` | Yes | Activity detail |
| `DELETE` | `/api/v1/activities/:id` | Yes | Delete activity |
| `GET` | `/api/v1/milestones` | Yes | All milestones with progress |
| `GET` | `/api/v1/milestones/next` | Yes | Next milestone for homepage |
| `GET` | `/api/v1/milestones/milestone-types` | Yes | Available milestone types |
| `POST` | `/api/v1/milestones` | Yes | Create custom milestone |
| `DELETE` | `/api/v1/milestones/:id` | Yes | Delete custom milestone |
| `PATCH` | `/api/v1/milestones/:id/pin` | Yes | Pin/unpin milestone |
| `POST` | `/api/v1/milestones/:id/acknowledge` | Yes | Acknowledge celebration |
| `POST` | `/api/v1/analytics/events` | Yes | Track analytics events |
| `POST` | `/api/v1/runs/analyze-gpx` | No | V1 GPX analysis |
| `POST` | `/api/v1/engine-v1/analyze` | No | V1 GPX analysis (engine route) |
| `GET` | `/api/v1/engine-v2` | No | V2 engine info |
| `GET` | `/api/v1/engine-v2/streets` | Yes | V2 user streets |
| `GET` | `/api/v1/engine-v2/map/streets` | Yes | V2 map streets |
| `POST` | `/api/v1/engine-v2/analyze` | No | V2 GPX analysis (persists node hits) |
| `POST` | `/api/v1/webhooks/strava` | No | Strava webhook receiver |

---

## Related Documentation

- **[Milestones & Goals Feature](/docs/features/milestones)** — Full vision, behavioral psychology research, all phases
- **[Homepage & Engagement Plan](/docs/features/homepage-engagement)** — Homepage design rationale and engagement strategy
- **[How Engines Work](/docs/how-engines-work)** — V1 vs V2 pipeline details
- **[Database](/docs/database)** — All Prisma models explained
- **[API Reference](/docs/api)** — Swagger UI with all endpoints
- **[Scripts](/docs/scripts)** — PBF seeding, activity reset, wipe-and-resync
