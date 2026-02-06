# V2 Engine (Edge-Based)

Edge-based street coverage system. Mounted at `/api/v1/engine-v2`.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v1/engine-v2` | Engine info |
| GET    | `/api/v1/engine-v2/streets` | User's street list from UserEdge (auth required) |
| GET    | `/api/v1/engine-v2/map/streets` | Map streets with geometry + V2 progress (auth; query: lat, lng, radius) |
| POST   | `/api/v1/engine-v2/analyze` | Analyze GPX (query: `userId` required) |

## Pipeline

1. Parse GPX → coordinates
2. OSRM map match → OSM node IDs
3. Way resolver → node pairs to ways (WayCache / Overpass)
4. Edge builder → validate edges, persist to UserEdge

## Setup

- **OSRM:** Set `OSRM_BASE_URL` in `.env` or use public demo.
- **WayCache (optional):** Place an OSM PBF (e.g. `hampshire-260204.osm.pbf`) in this folder or pass its path: `npx tsx src/scripts/seed-way-cache-from-pbf.ts [path/to/file.osm.pbf]`. Then set `SKIP_OVERPASS=true` to avoid Overpass.

See `../ENGINE_COMPARISON.md` for comparison with V1.
