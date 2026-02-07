# The Street Keeper Database — A Plain-English Guide

Street Keeper stores all its data in a **PostgreSQL** database. We use **Prisma** to talk to it from the backend. This guide explains every table (we call them "entities" or "models"), what each column stores, why we store it, and how the tables link together.

**Analogy:** Think of the database as a set of spreadsheets that can reference each other. Each table is one spreadsheet. A column in one table can hold an ID that points to a row in another table — that is a "relation." When you delete a user, we can automatically delete their projects and activities (that is "cascade") so nothing is left orphaned.

---

## 1. Entity Relationship Overview

```mermaid
erDiagram
  User ||--o{ Project : "owns"
  User ||--o{ Activity : "has"
  User ||--o{ UserStreetProgress : "has"
  User ||--o{ UserEdge : "has"
  Project ||--o{ ProjectActivity : "links"
  Activity ||--o{ ProjectActivity : "links"
  Project }o--|| ProjectActivity : "projectId"
  Activity }o--|| ProjectActivity : "activityId"
  WayCache ||--o| WayTotalEdges : "references by wayId"
  UserStreetProgress }o--|| User : "userId"
  UserEdge }o--|| User : "userId"
  GeometryCache : standalone cache
```

---

## 2. User

**What it is:** The person using Street Keeper. One row per account.

**Analogy:** Your profile card. It holds who you are and how we can talk to Strava on your behalf.

| Column | Type | What it stores | Why |
|--------|------|----------------|-----|
| `id` | UUID | Unique identifier for this user | Primary key; used everywhere we need "which user?" |
| `stravaId` | string (optional, unique) | Your Strava athlete ID | So we can match Strava webhooks and API responses to you |
| `garminId` | string (optional, unique) | Garmin user ID (reserved) | For future Garmin integration |
| `email` | string (optional, unique) | Email address | Account recovery, optional login |
| `name` | string | Display name | Shown in the app (e.g. from Strava) |
| `profilePic` | string (optional) | URL to profile image | From Strava or upload |
| `stravaAccessToken` | string (optional) | Strava OAuth access token | So we can call Strava APIs (e.g. list activities) without you re-logging in |
| `stravaRefreshToken` | string (optional) | Strava OAuth refresh token | When the access token expires, we use this to get a new one |
| `stravaTokenExpiresAt` | datetime (optional) | When the access token expires | We refresh before this time so sync keeps working |
| `createdAt` / `updatedAt` | datetime | When the row was created or last updated | Auditing and debugging |

**Relations:** A user **owns** many Projects, has many Activities, has many UserStreetProgress rows (V1 map), and has many UserEdge rows (V2 map). If a user is deleted, all of those are deleted too (cascade).

**Design choice:** We store Strava tokens so we can sync your activities in the background and when you tap "Sync." Without storing them, you would have to log in with Strava every time.

---

## 3. Project

**What it is:** A geographic area you want to track — a circle on the map (center + radius). "Portsmouth 2km" or "Winchester 5km" are examples.

**Analogy:** A checklist for one area. The checklist is a snapshot of every street in that circle; we tick them off as you run.

| Column | Type | What it stores | Why |
|--------|------|----------------|-----|
| `id` | UUID | Unique identifier for this project | Primary key |
| `userId` | UUID | Who owns this project | Links to User; cascade delete when user is deleted |
| `name` | string | Project name (e.g. "Portsmouth 2km") | What you see in the app |
| `centerLat` / `centerLng` | float | Center of the circle (latitude, longitude) | Defines where the project is on the map |
| `radiusMeters` | int | Radius of the circle (500, 1000, 2000, 5000, 10000) | How big the area is; we only allow these values |
| `streetsSnapshot` | JSON | List of streets in the area plus completion state | See below |
| `snapshotDate` | datetime | When the street list was last fetched from the map | So we know if we need to refresh from OpenStreetMap |
| `totalStreets` | int | Number of streets in the snapshot | Cached so we do not recalculate every time |
| `totalLengthMeters` | float | Sum of all street lengths | For display (e.g. "45 km total") |
| `completedStreets` | int | How many streets are "done" (e.g. ≥ 90%) | Cached for progress bar and list view |
| `progress` | float | Overall completion 0–100% | Cached; computed from completedStreets / totalStreets |
| `deadline` | datetime (optional) | Optional target date | For personal goals |
| `isArchived` | boolean | Whether the project is hidden | Soft delete; you can bring it back |
| `createdAt` / `updatedAt` | datetime | When created / last updated | Auditing |

**What is inside `streetsSnapshot`?**  
A JSON object: `{ streets: [ ... ], snapshotDate: "..." }`. Each street in `streets` has: `osmId` (e.g. `"way/12345"`), `name`, `lengthMeters`, `highwayType`, `completed` (true/false), `percentage` (0–100), `lastRunDate`. So we store both "which streets are in this area" and "how much of each you have run." We do not re-query the map server every time you open the project; we use this snapshot and only refresh when it is stale (e.g. after 30 days).

**Relations:** A project belongs to one User and has many ProjectActivity rows (each row links one run to this project and stores the impact of that run).

**Design choice:** Storing the street list as JSON in one column keeps one project = one snapshot. We could have a separate "ProjectStreet" table, but then every project view would need to join many rows; the snapshot is faster for "load my project and show progress."

---

## 4. Activity

**What it is:** A single run (or walk) synced from Strava. One row per activity.

**Analogy:** One page in your training diary. It has the route (GPS points), distance, time, and whether we have already "processed" it to update your street progress.

| Column | Type | What it stores | Why |
|--------|------|----------------|-----|
| `id` | UUID | Unique identifier for this activity | Primary key |
| `userId` | UUID | Who did this run | Links to User |
| `stravaId` | string (unique) | Strava activity ID | So we do not import the same run twice; used when Strava sends webhooks |
| `name` | string | Activity name (from Strava) | e.g. "Morning run" |
| `distanceMeters` | float | Total distance | From Strava |
| `durationSeconds` | int | Total time | From Strava |
| `startDate` | datetime | When the run started | Used for "which projects does this run overlap?" and for ordering |
| `activityType` | string | e.g. "Run" | From Strava |
| `coordinates` | JSON | GPS points: array of { lat, lng, elevation?, timestamp? } | The raw breadcrumb trail; we need it to match you to streets (V1 or V2) |
| `isProcessed` | boolean | Whether we have already run street-matching and updated progress | So we do not process the same activity twice; sync can re-insert and we only process new ones |
| `processedAt` | datetime (optional) | When we last processed it | For debugging and reprocessing |
| `createdAt` | datetime | When we imported it | Auditing |

**Relations:** An activity belongs to one User and has many ProjectActivity rows (each row links this run to one project and stores how many streets it completed or improved).

**Design choice:** We store `coordinates` in the database because street matching (both V1 and V2) needs the full GPS trace. We do not re-fetch it from Strava for every process; we fetch once when we import and then reuse.

---

## 5. ProjectActivity (junction table)

**What it is:** A link between one Project and one Activity, plus "what did this run do for this project?"

**Analogy:** A line on a chart: "This run contributed to this project: 3 streets completed, 5 improved."

| Column | Type | What it stores | Why |
|--------|------|----------------|-----|
| `id` | UUID | Unique identifier for this link | Primary key |
| `projectId` | UUID | Which project | Foreign key to Project; cascade when project is deleted |
| `activityId` | UUID | Which run | Foreign key to Activity; cascade when activity is deleted |
| `streetsCompleted` | int | How many streets in this project became "completed" (e.g. crossed 90%) because of this run | For the "impact" summary (e.g. "This run completed 3 streets") |
| `streetsImproved` | int | How many streets got more progress but did not reach 90% | So we can show "you improved 5 streets" |
| `impactDetails` | JSON (optional) | Fine-grained breakdown (e.g. which osmIds completed, which improved and from what % to what %) | For detailed activity/project views |
| `createdAt` | datetime | When the link was created | When we first processed this activity for this project |

**Unique constraint:** One row per (projectId, activityId). The same run cannot be linked to the same project twice.

**Relations:** ProjectActivity belongs to one Project and one Activity. Both relations use cascade delete: delete the project or the activity and the link is removed.

**Design choice:** We use a junction table because one run can overlap several projects (e.g. you run through two different circles). So we need "many activities per project" and "many projects per activity" — that is a many-to-many, and the junction row is where we store the impact of that run on that project.

---

## 6. UserStreetProgress (V1 map)

**What it is:** One row per user per street. Tracks "how much of this street has this user run?" for the **V1** engine. Powers the global map when the app uses the V1 pipeline.

**Analogy:** A single line on a big checklist: "High Street: 72% done." The checklist is for all streets you have ever run, anywhere.

| Column | Type | What it stores | Why |
|--------|------|----------------|-----|
| `id` | UUID | Unique identifier | Primary key |
| `userId` | UUID | Which user | Foreign key to User |
| `osmId` | string | Street identifier (e.g. `"way/12345"`) | From OpenStreetMap; unique per street (way) |
| `name` | string | Street name | Denormalized so we do not have to look it up when showing the map |
| `highwayType` | string | e.g. residential, footway | For filtering and display |
| `lengthMeters` | float | Street length | Denormalized |
| `percentage` | float (0–100) | How much of the street you have run | We use a **MAX rule**: when we reprocess, we only ever increase this, never decrease. So one bad run cannot wipe progress. |
| `spatialCoverage` | JSON (optional) | Intervals of covered portions, e.g. `[[0, 50], [75, 100]]` meaning 0–50% and 75–100% of the street | More accurate than a single number; we merge intervals when you run again |
| `everCompleted` | boolean | Have you ever reached the completion threshold (e.g. 90%)? | Once true, always true; used for "ever completed" stats |
| `runCount` | int | How many times you ran on this street | For "you have run this 5 times" |
| `completionCount` | int | How many of those runs reached ≥ 90% | For stats |
| `firstRunDate` / `lastRunDate` | datetime (optional) | First and last time you ran here | For display and sorting |
| `createdAt` / `updatedAt` | datetime | Row created / updated | Auditing |

**Unique constraint:** One row per (userId, osmId). So one user cannot have two rows for the same street.

**Relations:** Belongs to User. Cascade delete when user is deleted.

**Design choice:** V1 expresses progress as a **percentage**. We denormalize name and length so the map and lists do not need to join to another table. The MAX rule avoids losing progress when matching is slightly different on a later run.

---

## 7. UserEdge (V2 map)

**What it is:** One row per user per **edge**. An edge is the smallest piece of a street (between two consecutive map nodes). The V2 engine stores "you have run this edge" and we derive street completion by counting edges.

**Analogy:** Instead of "High Street 72%," we store "you have run link 1, link 2, … link 8 of High Street (11 links total)." So 8 of 11 = completion. Each row is one link.

| Column | Type | What it stores | Why |
|--------|------|----------------|-----|
| `id` | UUID | Unique identifier | Primary key |
| `userId` | UUID | Which user | Foreign key to User |
| `edgeId` | string | Normalized edge ID, e.g. `"123456-123457"` (nodeA-nodeB, small first) | So the same physical edge always has the same ID; we never store "123457-123456" |
| `nodeA` / `nodeB` | BigInt | The two OSM node IDs that form this edge (nodeA &lt; nodeB) | OpenStreetMap uses big integers for node IDs; we normalize so nodeA is always the smaller one |
| `wayId` | BigInt | Which street (way) this edge belongs to | So we can group edges by street and count "8 of 11" |
| `wayName` | string (optional) | Street name | Denormalized for display |
| `highwayType` | string | e.g. residential, footway | For filtering |
| `lengthMeters` | float | Length of this edge | For stats |
| `firstRunAt` | datetime | When you first ran this edge | For "first run" display |
| `runCount` | int | How many times you have run this edge | We upsert: if the edge exists we increment this; we never duplicate the same edge for the same user |
| `createdAt` / `updatedAt` | datetime | Row created / updated | Auditing |

**Unique constraint:** One row per (userId, edgeId). So the same user cannot have two rows for the same edge — we just increment `runCount` if they run it again.

**Relations:** Belongs to User. Cascade delete when user is deleted.

**Design choice:** Edges are the **source of truth** in V2. Street completion is derived (count edges per way, compare to WayTotalEdges). We use BigInt for node/way IDs because OSM IDs can be very large. Normalizing nodeA &lt; nodeB keeps edgeId stable and avoids duplicate edges in different order.

---

## 8. WayCache

**What it is:** A cache that answers "which streets (ways) does this map node belong to?" So when V2 has a list of node IDs from OSRM, we can look up the way for each segment without calling the Overpass API every time.

**Analogy:** A phone book: given a node number, we look up "this node is on way 12345 and 12346" (a node can be at an intersection of two ways).

| Column | Type | What it stores | Why |
|--------|------|----------------|-----|
| `id` | UUID | Unique identifier | Primary key |
| `nodeId` | BigInt (unique) | OSM node ID | The "phone number" we look up |
| `wayIds` | JSON | Array of way IDs that contain this node | So we know "this node is on these streets" |
| `wayMetadata` | JSON | For each way: name, highwayType, node sequence, etc. | So we do not need a second lookup for name and type |
| `createdAt` | datetime | When we cached it | Auditing |
| `expiresAt` | datetime | When this cache row is considered stale | We can refresh from Overpass or PBF later; typically 30 days |

**Relations:** None. This is a standalone cache keyed by nodeId.

**Design choice:** Overpass (the map API) is rate-limited and slow. By caching node → way data (from a PBF file or from Overpass the first time we see a node), we avoid repeated calls. When `SKIP_OVERPASS=true`, we rely only on this cache (after seeding from a PBF).

---

## 9. WayTotalEdges

**What it is:** One row per street (way). Stores "how many edges does this street have?" (i.e. number of nodes minus one). Used by V2 to compute completion: you have run 8 edges, this street has 11 edges total → 8/11 ≈ 73%.

**Analogy:** The "total possible" column: "High Street has 11 links; you have run 8."

| Column | Type | What it stores | Why |
|--------|------|----------------|-----|
| `wayId` | BigInt | OSM way ID (primary key) | Identifies the street |
| `totalEdges` | int | Number of edges (nodes.length − 1) for this way | So we can compute percentage: edgesCompleted / totalEdges |
| `name` | string (optional) | Street name | Denormalized for display |
| `highwayType` | string | e.g. residential, footway | For display/filtering |
| `createdAt` | datetime | When we added this row | Usually when we seed from a PBF or first resolve this way |

**Relations:** None. Other code looks up by wayId.

**Design choice:** We need the total number of edges per way to know when a street is "100% complete." This table is filled by the PBF seed script or when we resolve ways during V2 processing.

---

## 10. GeometryCache

**What it is:** Cached street geometries (the actual lines on the map) for a given area. Keyed by a cache key like "radius:50.78:-1.09:2000" so we do not re-query Overpass every time the map loads.

**Analogy:** A drawer of maps: "Map of Portsmouth 2km radius" — we pull it out instead of drawing it again from the map server.

| Column | Type | What it stores | Why |
|--------|------|----------------|-----|
| `id` | UUID | Unique identifier | Primary key |
| `cacheKey` | string (unique) | e.g. `"radius:50.788:-1.089:2000"` or `"bbox:s:w:n:e"` | Identifies the area; same area = same key = cache hit |
| `geometries` | JSON | Array of street geometries (coordinates for each street) | What we send to the frontend to draw the map |
| `createdAt` | datetime | When we cached it | Auditing |
| `expiresAt` | datetime | When we consider the cache stale | Map data changes slowly; we refresh after a set time (e.g. 30 days) |

**Relations:** None. Standalone cache.

**Design choice:** Fetching street geometries from Overpass is slow. Caching by area (radius or bbox) lets the map load quickly on repeat visits. We expire so that if streets change in OSM, we eventually refresh.

---

## 11. Relationships Summary

| From | To | Relation | Cascade |
|------|-----|----------|---------|
| User | Project | One user has many projects | Delete user → delete their projects |
| User | Activity | One user has many activities | Delete user → delete their activities |
| User | UserStreetProgress | One user has many progress rows | Delete user → delete their progress |
| User | UserEdge | One user has many edges | Delete user → delete their edges |
| Project | ProjectActivity | One project has many links to activities | Delete project → delete those links |
| Activity | ProjectActivity | One activity can link to many projects | Delete activity → delete those links |
| ProjectActivity | Project | Many-to-one | Delete project → delete ProjectActivity rows |
| ProjectActivity | Activity | Many-to-one | Delete activity → delete ProjectActivity rows |

WayCache, WayTotalEdges, and GeometryCache have no foreign keys; they are lookup/cache tables.

---

## 12. Design Choices in Short

- **JSON for snapshots (Project.streetsSnapshot):** One place to store the full street list and progress for a project. Avoids a separate table and many joins when loading a project.
- **Denormalized fields (e.g. wayName on UserEdge, name on UserStreetProgress):** We duplicate the street name (and sometimes length/type) so that list and map views do not need extra lookups. Writes are a bit heavier; reads are simpler and faster.
- **BigInt for OSM node/way IDs:** OpenStreetMap uses large integers; JavaScript number would lose precision. BigInt is exact.
- **Spatial coverage (intervals) in UserStreetProgress:** More accurate than a single percentage when you have run different parts of a street at different times. We merge intervals so "0–50% and 75–100%" means 75% total.
- **V1 vs V2 storage:** V1 stores **percentage per street** (UserStreetProgress). V2 stores **edges** (UserEdge) and derives street completion. Both feed the app; which one the map uses is controlled by the frontend and backend engine version. Projects can now be updated from either V1 matching or V2-derived completion depending on `GPX_ENGINE_VERSION`.
