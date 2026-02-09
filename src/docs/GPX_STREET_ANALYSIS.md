# GPX Street Analysis Feature

## Overview

This feature allows users to upload a GPX file and receive a detailed analysis of all streets they ran on, including accurate coverage data.

**Endpoint:** `POST /api/v1/runs/analyze-gpx`

---

## How It Works

### 1. GPX File Upload
- User uploads a GPX file via multipart form-data
- Field name: `gpx`
- Max file size: 10MB

### 2. GPS Data Extraction
- Parses GPX XML to extract GPS coordinates
- Captures: latitude, longitude, timestamps, elevation
- Extracts track name and metadata

### 3. Street Detection (Hybrid Approach)

#### With Mapbox Configured (~98% accuracy)
- Sends GPS trace to Mapbox Map Matching API
- Mapbox snaps points to actual road network
- Uses routing algorithms considering:
  - Street connectivity
  - Turn restrictions
  - One-way streets
  - Probabilistic path matching

#### Without Mapbox (~85% accuracy)
- Falls back to Overpass-only matching
- Queries OpenStreetMap for streets in area
- Matches each GPS point to nearest street (within 25m threshold)

### 4. Street Data Retrieval
- Queries Overpass API for all streets in bounding box
- Retrieves: street names, OSM IDs, total lengths, geometries, highway types

### 5. Coverage Calculation

For each matched street:

| Metric | Description |
|--------|-------------|
| `totalDistanceCoveredMeters` | Unique street coverage (clamped to street length) |
| `totalDistanceRunMeters` | Actual distance run on street (can exceed length if ran back/forth) |
| `coverageRatio` | Percentage covered (clamped to 1.0 for UX) |
| `rawCoverageRatio` | Actual ratio (preserved for debugging) |
| `completionStatus` | "FULL" (≥90%) or "PARTIAL" (<90%) |

### 6. Street Aggregation
- Groups OSM way segments into logical streets
- Multiple segments with same name → single street entry
- Sums lengths and distances across segments

### 7. Unnamed Road Handling
- Separates unnamed roads from named streets
- Filters tiny segments (<30m length AND <20m covered)
- Groups by highway type (footway, path, cycleway, etc.)
- Displays as buckets: "Footpath (Unnamed)", "Path (Unnamed)"

### 8. Quality Metrics
- Average GPS point spacing
- GPS jump detection (identifies bad data)
- Moving vs stopped time (if timestamps available)

---

## API Response Structure

```json
{
  "success": true,
  
  "analysis": {
    "gpxName": "Morning Run",
    "totalDistanceMeters": 3617.26,
    "durationSeconds": 1800,
    "pointsCount": 110,
    "movingTimeSeconds": 1650,
    "stoppedTimeSeconds": 150,
    "avgPointSpacingMeters": 33.19,
    "maxSegmentDistanceMeters": 96.98,
    "gpsJumpCount": 0,
    "streetsTotal": 7,
    "streetsFullCount": 2,
    "streetsPartialCount": 5,
    "percentageFullStreets": 28.57
  },
  
  "segments": {
    "total": 14,
    "fullCount": 6,
    "partialCount": 8,
    "list": [
      {
        "osmId": "way/223199277",
        "name": "Peascod Street",
        "highwayType": "pedestrian",
        "lengthMeters": 273.51,
        "distanceCoveredMeters": 248.57,
        "coverageRatio": 0.909,
        "completionStatus": "FULL",
        "matchedPointsCount": 7
      }
    ]
  },
  
  "streets": {
    "total": 7,
    "fullCount": 2,
    "partialCount": 5,
    "list": [
      {
        "name": "Peascod Street",
        "normalizedName": "peascod street",
        "highwayType": "pedestrian",
        "totalLengthMeters": 273.51,
        "totalDistanceCoveredMeters": 273.51,
        "totalDistanceRunMeters": 928.5,
        "coverageRatio": 1.0,
        "rawCoverageRatio": 3.395,
        "completionStatus": "FULL",
        "segmentCount": 1,
        "segmentOsmIds": ["way/223199277"]
      }
    ]
  },
  
  "unnamedRoads": {
    "totalSegments": 3,
    "buckets": [
      {
        "highwayType": "footway",
        "displayName": "Footpath (Unnamed)",
        "totalLengthMeters": 50.0,
        "totalDistanceCoveredMeters": 45.0,
        "totalDistanceRunMeters": 45.0,
        "coverageRatio": 0.9,
        "segmentCount": 2,
        "fullCount": 1,
        "partialCount": 1
      }
    ]
  }
}
```

---

## Response Sections Explained

### `analysis`
High-level run statistics and quality metrics.

### `segments`
Raw OSM segment-level data. Each OSM "way" is a separate entry. Useful for debugging and advanced analysis.

### `streets`
Aggregated logical streets. Multiple segments with the same name are combined into one entry. **Primary data for UX.**

### `unnamedRoads`
Unnamed roads grouped by highway type. Kept separate to avoid cluttering the main streets list.

---

## Key Fields Per Street

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Street name from OSM |
| `totalLengthMeters` | number | Total length of the street |
| `totalDistanceCoveredMeters` | number | Unique coverage (clamped to street length) |
| `totalDistanceRunMeters` | number | Actual distance run (unclamped, for workout stats) |
| `coverageRatio` | number | Coverage percentage (0.0 - 1.0, clamped) |
| `rawCoverageRatio` | number | Actual ratio (can exceed 1.0 if ran back/forth) |
| `completionStatus` | string | "FULL" (≥90%) or "PARTIAL" (<90%) |
| `segmentCount` | number | Number of OSM segments making up this street |
| `segmentOsmIds` | string[] | List of OSM way IDs |

---

## Error Responses

| Status | Code | Description |
|--------|------|-------------|
| 400 | `GPX_FILE_REQUIRED` | No file uploaded |
| 400 | `GPX_PARSE_ERROR` | Invalid or malformed GPX file |
| 502 | `OVERPASS_API_ERROR` | OpenStreetMap API unavailable |
| 502 | `MAPBOX_API_ERROR` | Mapbox API error (falls back to Overpass) |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MAPBOX_ACCESS_TOKEN` | No | Enables high-accuracy matching (~98%). Falls back to Overpass-only (~85%) if not set. |

### Thresholds (in `constants.ts`)

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_DISTANCE_METERS` | 25m | Max distance from street to match GPS point |
| `COMPLETION_THRESHOLD` | 0.90 | Coverage ratio for "FULL" status |
| `MIN_POINTS_PER_STREET` | 3 | Min GPS points to count a street |
| `MIN_UNNAMED_LENGTH_METERS` | 30m | Filter threshold for unnamed roads |
| `MIN_UNNAMED_COVERED_METERS` | 20m | Filter threshold for unnamed roads |

---

## Engine V2 GPX Analysis

The **V2 engine** provides a separate analyze endpoint that uses **node proximity** (CityStrides-style) instead of Overpass + Mapbox.

**Endpoint:** `POST /api/v1/engine-v2/analyze`  
**Query param:** `userId` (required) — the user ID so node hits can be persisted to **UserNodeHit**.

### How V2 analysis works

1. **Parse GPX** — Same as above: extract GPS points (lat, lng) from the uploaded file.
2. **Mark hit nodes** — For each GPS point, query **NodeCache** for nodes within a 25-metre radius; compute haversine distance; for each node within 25 m, upsert a row in **UserNodeHit** (userId, nodeId). No Overpass or Mapbox calls.
3. **Derive street completion** — For the bounding box of the run (or all streets the user has progress on), compute completion per way: (nodes hit / totalNodes) from **UserNodeHit**, **WayNode**, and **WayTotalEdges**. Apply the 90% rule (100% for streets with ≤10 nodes).
4. **Build response** — Return run summary (distance, point count, nodes hit) and a list of streets with percentage and completion status, in a shape similar to the legacy response so the frontend can display it the same way.

### V2 response shape

The V2 analyze response includes:

- **nodesHit** — Number of distinct nodes marked as hit in this run.
- **streets** — List of streets with `osmId`, `name`, `percentage`, `isComplete`, etc., derived from node hit counts (not from segment coverage).
- **analysis** — High-level stats (e.g. points count, total distance).

### When to use V1 vs V2 analyze

| | V1 (`POST /runs/analyze-gpx` or `/engine-v1/analyze`) | V2 (`POST /engine-v2/analyze`) |
|--|------------------------------------------------------|-------------------------------|
| **Data source** | Overpass + optional Mapbox | Pre-seeded NodeCache, WayNode, WayTotalEdges |
| **Persistence** | No (one-off analysis unless activity processor runs) | Yes — node hits are saved to UserNodeHit for the given userId |
| **Setup** | No seed required | Requires PBF seed for the region |
| **Accuracy model** | Segment coverage percentage | Node hit count with 90% threshold |

See [How Engines Work](/docs/how-engines-work) for the full V2 pipeline and [Engine Comparison](/docs/engines) for a side-by-side comparison.

---

## Accuracy Comparison

| Approach | Accuracy | Intersection Handling | GPS Drift |
|----------|----------|----------------------|-----------|
| Mapbox + Overpass (V1 hybrid) | ~98% | Excellent | Excellent |
| Overpass only (V1 fallback) | ~85% | Poor | Basic |
| Node proximity (V2, 25 m snap) | CityStrides-style | Good (90% node rule) | 25 m buffer helps |
