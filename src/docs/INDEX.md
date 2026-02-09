# Street Keeper Backend — Documentation Index

**Street Keeper** is a running companion API that connects to Strava, pulls GPS activity data, and determines which streets a user has run by matching their path against OpenStreetMap data. Progress can be computed with two engines: **V1** (Overpass + optional Mapbox) or **V2** (CityStrides-style node proximity).

---

## What is Street Keeper?

In plain English: you run with your phone or watch. Strava records where you went. Street Keeper takes that recording and answers: **Which streets did you run on, and how much of each have you completed?** You can define **projects** (e.g. "Portsmouth 2 km") and see a map of streets you have run, with completion percentages. The system supports **GPX upload** for one-off analysis and **Strava sync** (including webhooks) for automatic updates.

---

## Table of Contents

| Document | Description |
|----------|-------------|
| [Getting Started](/docs/getting-started) | Setup, environment variables, running locally, PBF seeding |
| [Architecture](/docs/architecture) | System layers, external services, data flows |
| [Database](/docs/database) | All 12 tables, columns, relationships, ERD |
| [API Reference](/docs/api-reference) | Every route, method, parameters, responses |
| [Engines](/docs/engines) | V1 vs V2 overview and comparison |
| [How Engines Work](/docs/how-engines-work) | Step-by-step pipelines in plain English |
| [GPX Street Analysis](/docs/gpx-street-analysis) | GPX upload and analysis (V1 and V2) |
| [Map Feature](/docs/map-feature) | Map endpoint, geometry, completion display |
| [Strava Integration](/docs/strava-integration) | OAuth, token refresh, webhooks |
| [Background Jobs](/docs/background-jobs) | pg-boss queue and activity processing |
| [Scripts](/docs/scripts) | Seed, reset, wipe, backfill, and utility scripts |
| [Coding Patterns](/docs/coding-patterns) | Conventions, error handling, structure |
| [Type Reference](/docs/types) | TypeScript types and interfaces |
| [Error Reference](/docs/errors) | Error codes and HTTP status mapping |
| [Glossary](/docs/glossary) | Definitions and abbreviations |
| [Frontend Guide](/docs/frontend) | How the frontend consumes the API |
| [Troubleshooting](/docs/troubleshooting) | Common issues and FAQ |

---

## Quick Start

1. **Prerequisites:** Node.js (v18+), PostgreSQL, and a [Strava API application](https://www.strava.com/settings/api) (Client ID and Secret).
2. **Clone and install:** `git clone <repo> && cd backend && npm install`
3. **Environment:** Copy `.env.example` to `.env` and set `DATABASE_URL`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, and optionally `MAPBOX_ACCESS_TOKEN`. See [Getting Started](/docs/getting-started) for the full list.
4. **Database:** Run `npx prisma migrate deploy` (or `db push` for dev). For V2, run the [PBF seed script](/docs/scripts) to populate NodeCache, WayNode, WayTotalEdges, and WayCache.
5. **Run:** `npm run dev` — server runs at `http://localhost:3000`. Hit `GET /health`, `GET /docs` for the doc UI, and `GET /api/v1/engine-v2` for V2 engine info.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js + TypeScript (tsx) |
| Framework | Express 5 |
| Database | PostgreSQL (Prisma ORM) |
| Job queue | pg-boss (same PostgreSQL) |
| APIs | Strava, Overpass, optional Mapbox |
| Docs | Markdown (marked), Swagger UI (OpenAPI) |

Test framework: **Vitest** and **supertest**.
