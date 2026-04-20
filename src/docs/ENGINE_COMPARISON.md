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

## V2 data: on-demand city sync (no PBF required)

V2 gets **NodeCache**, **WayNode**, and **WayTotalEdges** from the **Overpass API per city** when a user creates a project (CityStrides model). We detect the city from the project center (Overpass `is_in`), check **CitySync**, and if the city is not yet synced we query Overpass for all streets in that city and upsert into the same tables. No PBF file or seed script is required. Optional: run `npm run sync:city -- --lat <lat> --lng <lng>` to pre-sync a city. See [Scripts](/docs/scripts) and [How Engines Work](/docs/how-engines-work) (section 8).

**Similar products:** CityStrides uses the same idea—query OSM per city, cache, reuse. We track which nodes you've been near (25 m buffer) and consider a street complete when you've hit 90% of its nodes (100% for streets with ≤10 nodes). GPS points are imprecise, so street coverage is always an approximation; the 25 m buffer and 90% rule help balance accuracy and tolerance.

## WayCache, NodeCache, WayNode (V2)

**Current approach:** NodeCache, WayNode, and WayTotalEdges are filled **per city** from the Overpass API when a user creates a project (see above). **Legacy:** You can still seed from a regional PBF with `npm run seed:way-cache -- path/to/region.pbf` (see [Scripts](/docs/scripts)). WayCache is deprecated for V2 runtime (V2 does not use it at query time).
