# V1 Engine (Overpass + Mapbox)

Legacy GPX analysis pipeline. Mounted at `/api/v1/engine-v1`. Same behavior as `POST /api/v1/runs/analyze-gpx`.

## Files in this directory

| File | Purpose |
|------|---------|
| `handlers.ts` | Engine info + analyze GPX handler |
| `v1.routes.ts` | Route definitions |
| `index.ts` | Public exports |
| `street-matching.ts` | Match GPS points to streets (Overpass + optional Mapbox) |
| `street-aggregation.ts` | Aggregate segments into logical streets, unnamed buckets |
| `mapbox.ts` | Mapbox Map Matching API client |
| `gpx-analysis.ts` | GPX quality metrics (moving/stopped time, track quality) |

The old `services/street-matching.service.ts` (and aggregation, mapbox, gpx-analysis) now re-export from here so existing imports still resolve.

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
- **V2:** CityStrides-style node proximity (25 m snap); UserNodeHit persistence; completion derived from node hits (90% rule).

The main app still uses `/runs/analyze-gpx` (same implementation). This mount provides a consistent engine path for comparison and future switching.
