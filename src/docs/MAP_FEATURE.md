# Map Feature

This document describes the home page map feature: user-level street progress with geometry and stats for map display.

## Table of Contents

1. [Feature Overview](#feature-overview)
2. [Data Model](#data-model)
3. [API Endpoint](#api-endpoint)
4. [Stats Tracked](#stats-tracked)
5. [Completion Status (Two-Tier Logic)](#completion-status-two-tier-logic)
6. [Activity Processing Integration](#activity-processing-integration)
7. [Backfill](#backfill)

---

## Feature Overview

The map feature lets users see all streets they have run on in a given area on a map. Each street is shown with:

- **Geometry** – LineString coordinates for drawing the street on the map
- **Status** – **Completed** (green) or **Partial** (yellow)
- **Stats** – Run count, completion count, first/last run dates, current percentage (for the info icon popup)

Data is stored in **UserStreetProgress**: one row per user per street (osmId). This table is updated whenever an activity is processed, so the map can query it directly without aggregating across routes.

---

## Data Model

### UserStreetProgress Table

| Column               | Type      | Description                            |
| -------------------- | --------- | -------------------------------------- |
| id                   | uuid      | Primary key                            |
| userId               | uuid      | FK to User                             |
| osmId                | string    | OpenStreetMap way ID (unique per user) |
| name                 | string    | Street name (denormalized)             |
| highwayType          | string    | e.g. residential, footway              |
| lengthMeters         | float     | Street length (denormalized)           |
| percentage           | float     | 0–100, MAX rule applies                |
| everCompleted        | boolean   | Once true, always true                 |
| runCount             | int       | Times user ran on this street          |
| completionCount      | int       | Times user achieved >= 90%             |
| firstRunDate         | datetime? | First run on this street               |
| lastRunDate          | datetime? | Most recent run                        |
| createdAt, updatedAt | datetime  | Audit fields                           |

**Unique constraint:** `(userId, osmId)` – one record per user per street.

**Indexes:** `userId`, `(userId, percentage)` for efficient map queries.

---

## API Endpoint

### GET /api/v1/map/streets

Returns streets the user has run on in a given area, with geometry and stats.

**Query parameters:**

| Param  | Required | Type    | Description                                |
| ------ | -------- | ------- | ------------------------------------------ |
| lat    | Yes      | number  | Center latitude (-90 to 90)                |
| lng    | Yes      | number  | Center longitude (-180 to 180)             |
| radius | No       | integer | Radius in meters (100–10000, default 2000) |

**Response:** `MapStreetsResponse` – see [TYPES_REFERENCE.md](TYPES_REFERENCE.md#map-types).

**Auth:** Required. User ID from session/header.

**Flow:**

1. Fetch street geometries in the area (geometry cache or Overpass).
2. Fetch UserStreetProgress for the user where osmId is in that set and percentage > 0.
3. Build segment-level list: merge geometry with progress.
4. Aggregate by street name: compute length-weighted completion (connectors weighted at 0.5); set street status to completed if **weighted ratio ≥ 95%**, else partial.
5. Propagate aggregated status back to segments so all segments of a street share the same visual style on the map.
6. Return `streets` (aggregated), `segments` (for polylines), center, radius, and counts.

---

## Stats Tracked

Per street, the following are stored and returned for the info icon:

| Stat                        | Description                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **runCount**                | Number of times the user has run on this street (any coverage).                                                 |
| **completionCount**         | Number of runs where the user achieved >= 90% coverage.                                                         |
| **firstRunDate**            | Date of first run on this street.                                                                               |
| **lastRunDate**             | Date of most recent run on this street.                                                                         |
| **totalLengthMeters**       | Street length in meters.                                                                                        |
| **currentPercentage**       | Current coverage 0–100 (MAX across all runs).                                                                   |
| **everCompleted**           | True if the user has ever reached >= 90% on this street.                                                        |
| **weightedCompletionRatio** | Length-weighted completion 0–1 (connectors count at CONNECTOR_WEIGHT). Used for street-level completed/partial. |
| **segmentCount**            | Number of OSM segments (parts on map) that make up this street.                                                 |
| **connectorCount**          | Number of short segments (≤ 20 m) weighted less in completion.                                                  |

---

## Completion Status (Two-Tier Logic)

Completion uses two tiers so the map is accurate: **segment-level** (per OSM way) and **street-level** (aggregated by name).

### Segment-level (per polyline)

- **Completed (green):** current `percentage` ≥ 90% (`STREET_MATCHING.COMPLETION_THRESHOLD`).
- **Partial (yellow):** current `percentage` < 90%.

So each segment’s color reflects **current** coverage, not “ever” completed.

### Street-level (aggregated list and counts)

Streets with the same name are grouped. Completion is **length-weighted** so one short gap doesn’t mark the whole street partial:

- **Connectors:** segments with length ≤ 20 m (`CONNECTOR_MAX_LENGTH_METERS`) count at 50% weight (`CONNECTOR_WEIGHT`).
- **Weighted ratio:** `sum((percentage/100) × weight) / sum(weight)` where weight = length × (0.5 if connector, 1 otherwise).
- **Street status:** **Completed** if `weightedCompletionRatio` ≥ 95% (`STREET_COMPLETION_THRESHOLD`), else **Partial**.

Constants live in `config/constants.ts`: `STREET_AGGREGATION.*` and `STREET_MATCHING.COMPLETION_THRESHOLD`.

**Data rule:** When percentage is updated (during activity processing), if the new percentage is >= 90%, `everCompleted` is set to true and never set back to false (used for stats only; display uses the rules above).

---

## Activity Processing Integration

When an activity is processed (see [ARCHITECTURE.md](ARCHITECTURE.md) – Activity Processing Pipeline):

1. Overlap detection finds routes that the activity touches.
2. For each route, street matching and coverage calculation produce a list of streets with updated percentages.
3. **Route progress** is updated (Route.streetsSnapshot) as before.
4. **User street progress** is updated: for each covered street, `upsertStreetProgress(userId, streetData[])` is called. This:
   - Creates a UserStreetProgress row if none exists.
   - Updates percentage (MAX rule), everCompleted, runCount, completionCount, lastRunDate; sets firstRunDate if null.

So every processed activity keeps UserStreetProgress in sync. The map reads only from UserStreetProgress (and geometry cache/Overpass), not from route snapshots.

---

## Backfill

Existing users may have route snapshots with progress but no UserStreetProgress rows. A one-time backfill script populates UserStreetProgress from route snapshots:

**Script:** `backend/src/scripts/backfill-user-street-progress.ts`

**Run (from backend directory):**

```bash
npm run backfill:street-progress
```

The script:

1. For each user, loads all their routes and `streetsSnapshot`.
2. For each street with percentage > 0, aggregates by osmId (MAX percentage, everCompleted if any route has it).
3. Upserts into UserStreetProgress. New rows get runCount/completionCount 0; they accumulate on future activity processing.

After backfill, the map shows all historically run streets; new runs continue to update UserStreetProgress via the activity processor.
