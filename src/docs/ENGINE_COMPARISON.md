# Engine comparison: V1 vs V2

Street Keeper exposes two GPX analysis engines. Both produce street-level coverage; they differ in how they match tracks to the map and how progress is stored.

## V1 engine (Overpass + Mapbox)

- **Mount:** `/api/v1/engine-v1` (and legacy `/api/v1/runs/analyze-gpx`)
- **Flow:** Parse GPX → bounding box → Overpass (streets in area) → Mapbox or Overpass point-to-street matching → aggregate segments into logical streets.
- **Progress:** Not persisted by this endpoint. The **home map** (`GET /api/v1/map/streets`) and **activity processor** use a separate pipeline (UserStreetProgress / MatchedStreet from synced activities).
- **Use when:** You want the classic analysis response (run stats, segment list, aggregated streets) without persistence, or when integrating with the existing map/activity flow.

| Endpoint | Description |
|----------|-------------|
| GET /engine-v1 | Engine info |
| POST /engine-v1/analyze | Analyze GPX (multipart field `gpx`) |

## V2 engine (CityStrides-style node proximity)

- **Mount:** `/api/v1/engine-v2`
- **Flow:** Parse GPX (or use Activity coordinates) → for each GPS point, query **NodeCache** for nodes within 25 m → mark hits in **UserNodeHit** → street completion is **derived** at query time from UserNodeHit + **WayNode** + **WayTotalEdges** (90% node rule: 100% for streets with ≤10 nodes).
- **Progress:** Stored in **UserNodeHit** (one row per user per node hit). Street completion is derived when needed: (nodes hit / total nodes) per way.
- **Use when:** You want node-based, deterministic progress and a single source of truth (UserNodeHit) for “which nodes has this user been near?” with completion comparable to CityStrides.

| Endpoint | Description |
|----------|-------------|
| GET /engine-v2 | Engine info |
| GET /engine-v2/streets | User's street list from UserNodeHit (auth required) |
| GET /engine-v2/map/streets | Map streets with geometry + V2 progress (auth; lat, lng, radius) |
| POST /engine-v2/analyze | Analyze GPX and persist node hits (query `userId` required; multipart field `gpxFile`) |

## Comparison

| Aspect | V1 | V2 |
|--------|----|----|
| Matching | Bounding box + Overpass + Mapbox (or Overpass-only) | Node proximity: 25 m snap radius; NodeCache lookup per point; UserNodeHit persistence |
| Progress storage | Separate (activities / UserStreetProgress) | UserNodeHit (this engine); completion derived at query time |
| Street list | From analysis response only | GET /engine-v2/streets (from UserNodeHit + WayNode + WayTotalEdges) |
| Map geometry | GET /map/streets (v1 pipeline) | GET /engine-v2/map/streets (same shape, V2 progress) |
| Auth | Optional for analyze | analyze: `userId` query; streets: requireAuth |

## Backend: activity processing (Strava sync)

- **GPX_ENGINE_VERSION**: `v1` (default), `v2`, or `both`. Controls which pipeline(s) run when processing Strava activities (sync, worker, or manual process).
  - **v1**: Only the v1 pipeline runs (Overpass/Mapbox → UserStreetProgress). Map data comes from GET /map/streets.
  - **v2**: Only the v2 pipeline runs (mark hit nodes → UserNodeHit; derive completion from UserNodeHit + WayNode + WayTotalEdges). Map data comes from GET /engine-v2/map/streets.
  - **both**: Both pipelines run; dual-write to UserStreetProgress and UserNodeHit. Use during migration or to compare.
- Set in `.env`: `GPX_ENGINE_VERSION=v2` or `GPX_ENGINE_VERSION=both`.
- If v2 fails (e.g. NodeCache not seeded), the activity is still marked processed; v1 is not affected. V2 errors are logged as warnings.

## Frontend

- **VITE_GPX_ENGINE**: `v1` (default) or `v2`. Controls which endpoints the UI calls:
  - When `v2`: `gpxService.analyze(file, userId)` calls POST /engine-v2/analyze; the home map calls GET /engine-v2/map/streets.
  - When `v1`: GPX analysis uses POST /runs/analyze-gpx; the home map uses GET /map/streets.
- **Interaction**: Backend `GPX_ENGINE_VERSION` determines what data gets written when activities are synced. Frontend `VITE_GPX_ENGINE` determines which API the client reads from. For a full v2 experience: set `GPX_ENGINE_VERSION=v2` (or `both`) and `VITE_GPX_ENGINE=v2`. During migration, `GPX_ENGINE_VERSION=both` with `VITE_GPX_ENGINE=v2` keeps v1 data updated while you use the v2 map.

## What is a PBF file? (in simple terms)

A **PBF file** (Protocol Buffer Binary) is OpenStreetMap's compact, efficient format for storing map data for a region (e.g. a country or state). Think of it as a snapshot of roads, paths, and their IDs and geometry in that area.

- **What it's used for here:** In V2 we need **NodeCache** (node coordinates), **WayNode** (way→node list), and **WayTotalEdges** (total nodes per way). We preload these from a regional PBF via the seed script. That lets us avoid live Overpass calls for matching and run fully offline (e.g. with `SKIP_OVERPASS=true`).

**Similar products and the same accuracy challenge:** Apps like **CityStrides** use a similar approach: they track which nodes you've been near (e.g. 25 m buffer) and consider a street complete when you've hit a high percentage of its nodes (e.g. 90%). We follow that model in V2. GPS points are imprecise, so street coverage is always an approximation—the 25 m buffer and 90% rule help balance accuracy and tolerance.

## WayCache, NodeCache, WayNode (V2)

To run V2 without Overpass, seed the database from a regional PBF: **NodeCache** (node coordinates), **WayCache** (node→way mapping), **WayNode** (way→node list), and **WayTotalEdges** (total nodes per way). See the V2 engine README in the repo and [Scripts](/docs/scripts) (`seed-way-cache-from-pbf.ts`).
