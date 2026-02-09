# API Reference

All API routes are under the prefix **`/api/v1`**. Authentication is required for most endpoints; the docs indicate "Auth" per route. Interactive OpenAPI (Swagger) documentation is available at **`GET /docs/api`** and is generated from JSDoc annotations in the route files.

**Health check (no auth):** `GET /health`

---

## Auth (`/api/v1/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/auth/strava` | No | Initiates Strava OAuth; redirects to Strava authorization page. Callback is handled by `/auth/strava/callback`. |
| GET | `/auth/strava/callback` | No | Strava OAuth callback. Exchange code for tokens, create/update user, redirect to frontend with token or user. |
| GET | `/auth/me` | Yes | Returns the current authenticated user (id, name, email, stravaId, profilePic). |

---

## Activities (`/api/v1/activities`)

All activity routes require authentication.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/activities` | List the current user's activities (paginated). Query: `limit`, `offset`, `sort`. |
| POST | `/activities/sync` | Sync recent activities from Strava. Query: optional `after` (Unix timestamp). Returns count of new/updated. |
| GET | `/activities/:id` | Get a single activity by ID (metadata, coordinates, isProcessed, etc.). |
| DELETE | `/activities/:id` | Delete an activity (recalculates project progress). |

---

## Projects (`/api/v1/projects`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/projects` | Yes | List user's projects. Query: `archived` (boolean). |
| GET | `/projects/preview` | Yes | Preview streets in a circle. Query: `lat`, `lng`, `radiusMeters`. Returns street count and cacheKey. |
| POST | `/projects` | Yes | Create project. Body: name, centerLat, centerLng, radiusMeters, cacheKey (from preview), optional deadline. |
| GET | `/projects/:id` | Yes | Get project by ID (including streetsSnapshot, progress). |
| PATCH | `/projects/:id` | Yes | Update project (name, deadline, isArchived). |
| DELETE | `/projects/:id` | Yes | Delete project. |
| POST | `/projects/:id/refresh` | Yes | Refresh project street list and progress from geometry cache / Overpass. |

---

## Map (`/api/v1/map`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/map/streets` | Yes | Streets with geometry and completion for map view. Query: `lat`, `lng`, `radius`. Uses V1 pipeline (UserStreetProgress). |

---

## Runs — legacy GPX (`/api/v1/runs`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/runs/analyze-gpx` | No | Upload GPX (multipart field `gpx`). Returns run stats and street coverage (V1-style analysis). Does not persist progress. |

---

## Engine V1 (`/api/v1/engine-v1`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/engine-v1` | No | Engine info (message, version, endpoints). |
| POST | `/engine-v1/analyze` | No | Analyze GPX (multipart field `gpx`). Same behavior as `/runs/analyze-gpx`. |

---

## Engine V2 (`/api/v1/engine-v2`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/engine-v2` | No | Engine info (node proximity, UserNodeHit). |
| GET | `/engine-v2/streets` | Yes | User's street list derived from UserNodeHit (cumulative). |
| GET | `/engine-v2/map/streets` | Yes | Map streets with geometry and V2 progress. Query: `lat`, `lng`, `radius`. |
| POST | `/engine-v2/analyze` | No* | Analyze GPX and persist node hits. Query: `userId` (required). Multipart field: `gpxFile`. *No auth but userId required in query. |

---

## Webhooks (`/api/v1/webhooks`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/webhooks/strava` | No | Strava webhook subscription verification (hub.challenge). |
| POST | `/webhooks/strava` | No | Strava webhook events (activity create/update). Must respond within 2 seconds; processing is queued. |

---

## Docs (served by backend)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/docs` | Documentation landing page (HTML). |
| GET | `/docs/api` | Swagger UI (interactive OpenAPI). |
| GET | `/docs/architecture` | Architecture Markdown rendered as HTML. |
| GET | `/docs/database` | Database schema doc. |
| GET | `/docs/engines` | Engine comparison. |
| GET | `/docs/how-engines-work` | How engines work (plain English). |
| GET | `/docs/types` | Type reference. |
| GET | `/docs/errors` | Error reference. |
| GET | `/docs/frontend` | Frontend integration guide. |

Additional doc routes (getting-started, api-reference, scripts, etc.) may be added; see the docs router and INDEX for the full list.

---

## Authentication

Protected routes expect the user to be identified via the **`x-user-id`** header (development) or a session/JWT mechanism. The `requireAuth` middleware resolves the user and sets `req.user`. Unauthenticated requests to protected routes return **401** with an error body (e.g. `AUTH_REQUIRED`).

---

## Error responses

Errors follow a common shape:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

See [Error Reference](/docs/errors) for all codes and HTTP status mappings.
