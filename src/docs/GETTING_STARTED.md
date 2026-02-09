# Getting Started

This guide walks you through setting up the Street Keeper backend locally: prerequisites, environment variables, database setup, optional PBF seeding for V2, and how to verify everything works.

---

## Prerequisites

| Requirement | Version / Notes |
|-------------|-----------------|
| **Node.js** | v18 or later (LTS recommended) |
| **PostgreSQL** | 14+ (used for app data and pg-boss queue) |
| **Strava API** | Create an app at [strava.com/settings/api](https://www.strava.com/settings/api) to get Client ID and Client Secret |

### Strava API credentials

1. Go to [Strava API Settings](https://www.strava.com/settings/api).
2. Create an application (or use an existing one).
3. Note the **Client ID** and **Client Secret**.
4. Set **Authorization Callback Domain** to your frontend origin (e.g. `localhost` for dev, or your production domain). The backend does not host the callback; the frontend does, so this must match where the OAuth redirect lands.
5. For webhooks (optional): set up a subscription and note the **Verify Token** you choose.

---

## Step-by-step setup

### 1. Clone and install

```bash
git clone <repository-url>
cd street-keeper/backend
npm install
```

### 2. Environment variables

Create a `.env` file in the backend root. The app loads it via `dotenv`. Below are all variables used by the codebase.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string, e.g. `postgresql://user:password@localhost:5432/streetkeeper` |
| `PORT` | No | Server port (default `3000`) |
| `NODE_ENV` | No | `development` or `production`; affects CORS and logging |
| `FRONTEND_URL` | No | Frontend origin for CORS and OAuth redirect (default `http://localhost:5173`) |
| `STRAVA_CLIENT_ID` | Yes (for auth) | Strava application Client ID |
| `STRAVA_CLIENT_SECRET` | Yes (for auth) | Strava application Client Secret |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | No | Token used to verify Strava webhook subscription (default `street-keeper-verify-token`) |
| `BASE_URL` | No | Public base URL of this backend (e.g. `https://api.streetkeeper.app`); used for webhook subscription (default `http://localhost:8000`) |
| `GPX_ENGINE_VERSION` | No | Which engine(s) run when processing activities: `v1`, `v2`, or `both` (default `v1`) |
| `MAPBOX_ACCESS_TOKEN` | No | If set, V1 uses Mapbox Map Matching for higher accuracy (~98%); otherwise Overpass-only (~85%) |
| `SKIP_OVERPASS` | No | Set to `true` to avoid Overpass calls in V2 (requires PBF seed; use after seeding) |
| `DISABLE_QUEUE` | No | Set to `true` to disable pg-boss (activity processing runs inline; useful for tests) |

**Example `.env` (minimal):**

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/streetkeeper
STRAVA_CLIENT_ID=your_client_id
STRAVA_CLIENT_SECRET=your_client_secret
FRONTEND_URL=http://localhost:5173
```

### 3. Database

```bash
npx prisma migrate deploy
```

Or for development with automatic migration creation:

```bash
npx prisma migrate dev
```

This applies all migrations and generates the Prisma client. The client is emitted under `src/generated/prisma` (see `schema.prisma`).

### 4. PBF seed (for V2 engine)

If you use the **V2** engine (`GPX_ENGINE_VERSION=v2` or `both`), you must populate **NodeCache**, **WayCache**, **WayNode**, and **WayTotalEdges** from an OpenStreetMap PBF extract.

1. **Download a PBF** for your region (e.g. from [Geofabrik](https://download.geofabrik.de/)).
2. **Run the seed script:**

   ```bash
   npm run seed:way-cache -- path/to/region.osm.pbf
   ```

   This can take a long time and use significant memory for large regions. Optional flags:

   - `--node-cache-only` — Only populate NodeCache (first pass).
   - `--way-nodes-only` — Only populate WayNode and WayTotalEdges from existing WayCache (run after a full seed that wrote WayCache).

3. **Optional:** Set `SKIP_OVERPASS=true` in `.env` so V2 does not call Overpass (all data comes from the seeded tables).

See [SCRIPTS](/docs/scripts) for full script documentation.

### 5. Run the server

```bash
npm run dev
```

The server starts (default port 3000). Nodemon watches for file changes and restarts.

---

## Verify the system

1. **Health:** `GET http://localhost:3000/health` — should return 200 and a simple status.
2. **Docs UI:** Open `http://localhost:3000/docs` in a browser — documentation landing page and links to Markdown docs and Swagger.
3. **Swagger API:** `http://localhost:3000/docs/api` — interactive OpenAPI documentation.
4. **V2 engine info (if using V2):** `GET http://localhost:3000/api/v1/engine-v2` — returns engine metadata and endpoints (no auth).

After connecting the frontend and completing Strava OAuth, use “Sync with Strava” to pull activities; the activity worker will process them with the configured engine(s).
