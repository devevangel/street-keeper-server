# Glossary

Definitions of terms, abbreviations, and concepts used in the Street Keeper backend and documentation.

---

## Domain terms

**Activity** — A single run or walk recorded on Strava. We store its metadata (name, distance, duration, start date) and GPS coordinates. Each activity can be “processed” to update street and project progress.

**Bounding box** — A rectangle on the map defined by minimum and maximum latitude and longitude. Used to limit Overpass and map queries to the area of a run or project.

**Buffer** — In V2, the 25-metre radius around each GPS point. Any OSM node whose distance from the point is ≤ 25 m is considered “hit.” Sometimes called “snap” distance.

**Completion threshold** — The rule for when a street is considered “complete.” In V2: 90% of nodes hit for streets with more than 10 nodes; 100% (all nodes) for streets with 10 or fewer nodes.

**Edge** — In OSM, the segment between two consecutive **nodes** on a **way**. Legacy V2 used edges; current V2 uses **node** hits only.

**GPS drift** — Inaccuracy in GPS position (often 5–15 m) due to signal, buildings, or device limits. The 25 m buffer in V2 helps absorb drift.

**Hit** — A **UserNodeHit** record: the user has been within 25 m of this OSM node at least once. “Marking a node as hit” means upserting (userId, nodeId) into UserNodeHit.

**LifeMap** — A term (from CityStrides) for a map showing all streets a user has run. We provide this via the map endpoints (V1 or V2).

**Node** — In OpenStreetMap, a single point (lat/lon). Streets (ways) are sequences of nodes. We store node coordinates in **NodeCache** and “hits” in **UserNodeHit**.

**Project** — A user-defined circular area (center + radius) for tracking street completion. Streets inside the circle are listed in a snapshot; progress is updated when activities overlap the circle.

**Snap** — The process of matching a GPS point to the map. In V2 this means “which nodes are within 25 m?”; in V1 it can mean Mapbox map-matching or nearest-street within a distance.

**Way** — In OpenStreetMap, a linear feature (e.g. a street segment) defined by an ordered list of **nodes**. A street name can span multiple ways.

---

## Abbreviations

**API** — Application Programming Interface.

**CRUD** — Create, Read, Update, Delete.

**ERD** — Entity Relationship Diagram; a diagram of database tables and relationships.

**GPX** — GPS Exchange Format; an XML format for GPS tracks (waypoints, tracks). We parse GPX to get (lat, lng) points.

**GPS** — Global Positioning System.

**JWT** — JSON Web Token; a compact way to represent claims (e.g. user id) for auth. We may use header-based auth in dev (e.g. x-user-id) instead.

**OAuth** — An authorization protocol. We use it for Strava login: user authorizes our app, Strava gives us tokens to act on their behalf.

**OSM** — OpenStreetMap.

**PBF** — Protocol Buffer Binary Format; a compact format for OSM data. Geofabrik and others provide regional “.osm.pbf” extracts.

**ORM** — Object-Relational Mapping. We use Prisma as the ORM for PostgreSQL.

**TTL** — Time to live; how long a cached value is valid (e.g. GeometryCache expires after 24 hours).

---

## Services and APIs

**Overpass API** — A read-only API for querying OpenStreetMap data. We use it to fetch streets (ways) inside a bounding box for V1 and for geometry.

**Mapbox Map Matching API** — A paid API that snaps a GPS trace to the road network. Used optionally in V1 for higher accuracy.

**Strava API** — Used for OAuth (login), listing activities, and fetching activity streams (GPS). Rate limits: 100 req/15 min, 1000/day.

---

## Internal concepts

**Engine** — The pipeline that turns GPS data into street completion. We have two: **V1** (Overpass + Mapbox, UserStreetProgress) and **V2** (node proximity, UserNodeHit).

**MAX rule** — For V1 UserStreetProgress, we only ever **increase** the stored percentage for a street; we never decrease it when reprocessing.

**Node proximity** — The V2 approach: mark every OSM node within 25 m of a GPS point as “hit,” then derive street completion from (nodes hit / total nodes) per way.

**90% rule** — A street is “complete” in V2 when the user has hit at least 90% of its nodes (or 100% if the street has ≤10 nodes).

**Seeded data** — Data loaded once from a PBF (NodeCache, WayCache, WayNode, WayTotalEdges) so V2 can run without calling Overpass for matching.
