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

## V2 engine (OSRM edge-based)

- **Mount:** `/api/v1/engine-v2`
- **Flow:** Parse GPX → OSRM map-match (GPX → OSM node IDs) → way resolver (node pairs → ways, WayCache/Overpass) → edge builder → persist to **UserEdge**.
- **Progress:** Stored in **UserEdge**; street completion is derived from edges (cumulative across all runs).
- **Use when:** You want edge-based, deterministic progress and a single source of truth (UserEdge) for “what has this user run?”.

| Endpoint | Description |
|----------|-------------|
| GET /engine-v2 | Engine info |
| GET /engine-v2/streets | User’s street list from UserEdge (auth required) |
| GET /engine-v2/map/streets | Map streets with geometry + V2 progress (auth; lat, lng, radius) |
| POST /engine-v2/analyze | Analyze GPX and persist edges (query `userId` required; multipart field `gpxFile`) |

## Comparison

| Aspect | V1 | V2 |
|--------|----|----|
| Matching | Bounding box + Overpass + Mapbox (or Overpass-only) | OSRM map-match (node sequence) |
| Progress storage | Separate (activities / UserStreetProgress) | UserEdge (this engine) |
| Street list | From analysis response only | GET /engine-v2/streets (from UserEdge) |
| Map geometry | GET /map/streets (v1 pipeline) | GET /engine-v2/map/streets (same shape, V2 progress) |
| Auth | Optional for analyze | analyze: `userId` query; streets: requireAuth |

## Backend: activity processing (Strava sync)

- **GPX_ENGINE_VERSION**: `v1` (default), `v2`, or `both`. Controls which pipeline(s) run when processing Strava activities (sync, worker, or manual process).
  - **v1**: Only the v1 pipeline runs (Overpass/Mapbox → UserStreetProgress). Map data comes from GET /map/streets.
  - **v2**: Only the v2 pipeline runs (OSRM → way resolve → edge build → UserEdge). Map data comes from GET /engine-v2/map/streets.
  - **both**: Both pipelines run; dual-write to UserStreetProgress and UserEdge. Use during migration or to compare.
- Set in `.env`: `GPX_ENGINE_VERSION=v2` or `GPX_ENGINE_VERSION=both`.
- If v2 fails (e.g. OSRM unavailable), the activity is still marked processed; v1 is not affected. V2 errors are logged as warnings.

## Frontend

- **VITE_GPX_ENGINE**: `v1` (default) or `v2`. Controls which endpoints the UI calls:
  - When `v2`: `gpxService.analyze(file, userId)` calls POST /engine-v2/analyze; the home map calls GET /engine-v2/map/streets.
  - When `v1`: GPX analysis uses POST /runs/analyze-gpx; the home map uses GET /map/streets.
- **Interaction**: Backend `GPX_ENGINE_VERSION` determines what data gets written when activities are synced. Frontend `VITE_GPX_ENGINE` determines which API the client reads from. For a full v2 experience: set `GPX_ENGINE_VERSION=v2` (or `both`) and `VITE_GPX_ENGINE=v2`. During migration, `GPX_ENGINE_VERSION=both` with `VITE_GPX_ENGINE=v2` keeps v1 data updated while you use the v2 map.

## WayCache (V2)

To avoid Overpass for way resolution in v2, precompute WayCache from a regional PBF and set `SKIP_OVERPASS=true`. See `engines/v2/README.md` and `src/scripts/seed-way-cache-from-pbf.ts`.
