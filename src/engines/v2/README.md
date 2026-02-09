# V2 Engine (CityStrides-Style Node Proximity)

Node-based street coverage system. Mounted at `/api/v1/engine-v2`. Tracks which OSM nodes a user has been within 25 m of; street completion is derived at query time using a 90% node rule.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v1/engine-v2` | Engine info |
| GET    | `/api/v1/engine-v2/streets` | User's street list from UserNodeHit (auth required) |
| GET    | `/api/v1/engine-v2/map/streets` | Map streets with geometry + V2 progress (auth; query: lat, lng, radius) |
| POST   | `/api/v1/engine-v2/analyze` | Analyze GPX and persist node hits (query: `userId` required; multipart: `gpxFile`) |

## Pipeline

1. Parse GPX or use Activity coordinates → list of GPS points (lat, lng).
2. **Mark hit nodes:** For each GPS point, query NodeCache for nodes within a 25 m bounding box; compute haversine distance; if distance ≤ 25 m, upsert (userId, nodeId) into **UserNodeHit**.
3. **Street completion (at query time):** For each way, get node IDs from **WayNode** and total nodes from **WayTotalEdges**; count how many of those nodes appear in **UserNodeHit** for the user; if (nodesHit / totalNodes) ≥ 90% (or 100% for streets with ≤10 nodes), the street is complete.

## Setup

- **NodeCache, WayNode, WayTotalEdges, WayCache (required):** Seed from a regional PBF: `npm run seed:way-cache -- path/to/region.pbf`. This populates NodeCache, WayCache, WayTotalEdges, and WayNode. Use `--node-cache-only` or `--way-nodes-only` to run in stages. Then set `SKIP_OVERPASS=true` to avoid Overpass for matching.

## Node completion rule

- **Streets with > 10 nodes:** Street is "complete" when the user has hit ≥ 90% of its nodes.
- **Streets with ≤ 10 nodes:** Street is "complete" only when the user has hit 100% of its nodes.

Config: `NODE_PROXIMITY_CONFIG` in `config.ts` (snapRadiusM: 25, shortStreetNodeThreshold: 10, standardCompletionThreshold: 0.9).

See [../../docs/ENGINE_COMPARISON.md](../../docs/ENGINE_COMPARISON.md) for comparison with V1 and [../../docs/HOW_ENGINES_WORK.md](../../docs/HOW_ENGINES_WORK.md) for the full pipeline.
