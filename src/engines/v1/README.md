# V1 Engine (Overpass + Mapbox)

Legacy GPX analysis pipeline. Mounted at `/api/v1/engine-v1`. Same behavior as `POST /api/v1/runs/analyze-gpx`.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v1/engine-v1` | Engine info |
| POST   | `/api/v1/engine-v1/analyze` | Analyze GPX (multipart field: `gpx`) |

## Pipeline

1. Parse GPX → points  
2. Bounding box → Overpass streets in area  
3. Mapbox (if configured) or Overpass-only point-to-street matching  
4. Aggregate segments into logical streets  
5. Return enhanced analysis (time breakdown, track quality, street coverage)

## Comparison

- **V1:** Overpass + Mapbox hybrid; segment/aggregate streets; no persistence.  
- **V2:** OSRM map-match → edges; WayCache/Overpass way resolution; UserEdge persistence.

The main app still uses `/runs/analyze-gpx` (same implementation). This mount provides a consistent engine path for comparison and future switching.
