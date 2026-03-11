# Engines — Plain-English Overview

Street Keeper uses two **engines** to answer the same question: *Which streets did you run, and how complete is each one?* They differ in where they get map data, how they match your GPS to the map, and how they store progress.

---

## What is an "engine"?

An **engine** is the pipeline that takes your GPS track (from a GPX file or from Strava) and produces **street-level completion**: a list of streets with names and a percentage (or completion flag) for each. The backend can run one or both engines when processing activities; the active engine(s) are controlled by **`GPX_ENGINE_VERSION`** (`v1`, `v2`, or `both`).

---

## V1 engine (Overpass + Mapbox)

**In one sentence:** We ask the map "what streets are in this area?" then see which ones your GPS path touched, and store a **percentage per street**.

- **Data source:** Live **Overpass API** (OpenStreetMap) for street geometry; optional **Mapbox Map Matching** to snap your GPS trace to the road network.
- **Tables:** **UserStreetProgress** — one row per user per street with a percentage (0–100). MAX rule: we only ever increase the percentage.
- **When to use it:** Simplest setup (no PBF seed). Good for prototyping and small areas. Slower per run because of Overpass (and Mapbox if configured) calls. Accuracy ~98% with Mapbox, ~85% without.

See [How Engines Work](/docs/how-engines-work) for the full V1 pipeline and [Engine Comparison](/docs/engines) for a side-by-side table.

---

## V2 engine (CityStrides-style node proximity)

**In one sentence:** For each GPS point we ask "which map nodes are within 25 metres?" We record those as **node hits**; street completion is **derived** at query time using a 90% node rule.

- **Data source:** **On-demand city sync** (CityStrides model): when a user creates a project, we detect the city from their center point (Overpass `is_in`), then query Overpass for all streets in that city and populate **NodeCache**, **WayNode**, and **WayTotalEdges**. One sync per city; subsequent projects in the same city use the DB. No PBF file required. Optional legacy: PBF seed script can still pre-fill a region.
- **Tables:** **UserNodeHit** — one row per user per OSM node that was within 25 m of a GPS point. **CitySync** — which cities have been synced and when. Completion is not stored per street; it is computed when needed: (nodes hit / total nodes) per way, with **90%** threshold (or **100%** for streets with ≤10 nodes).
- **When to use it:** Best accuracy and consistency (comparable to CityStrides). No PBF seed required; cities sync automatically on first project creation. Optional: run `npm run sync:city` to pre-sync a city.

See [How Engines Work](/docs/how-engines-work) for the full V2 pipeline and [Engine Comparison](/docs/engines) for the comparison table.
