# Background Jobs — pg-boss Queue

Street Keeper uses **pg-boss** for asynchronous activity processing. Jobs are stored in the same **PostgreSQL** database the app uses, so there is no separate queue server (e.g. Redis).

---

## Why pg-boss?

- **Strava webhooks** must be acknowledged within **2 seconds**. Processing an activity (fetching streams, matching streets, updating DB) takes much longer. So we **enqueue** a job and respond 200 immediately; a **worker** processes the job in the background.
- **Single database:** No Redis or other infra. Same `DATABASE_URL`; pg-boss creates its own tables (e.g. `pgboss.*`) for jobs.
- **Reliability:** Jobs persist across restarts. Failed jobs can retry with backoff.

---

## Job lifecycle

1. **Enqueue:** When a webhook arrives or the user clicks “Sync,” the backend calls the activity queue service to **add a job** (e.g. `stravaActivityId`, `userId`, `ownerId`). This is fast (~milliseconds).
2. **Response:** The HTTP handler returns 200 to Strava or to the client without waiting for processing.
3. **Worker:** A long-running **activity worker** (started with the server) polls pg-boss for jobs. When a job is available, the worker:
   - Validates the user and checks for duplicate processing.
   - Refreshes the Strava access token if expired.
   - Fetches the activity and its streams from the Strava API.
   - Saves the activity (and coordinates) to the **Activity** table.
   - Calls the **activity processor service** to run the street-matching pipeline (V1 and/or V2) and update project progress and UserStreetProgress / UserNodeHit.
4. **Complete or fail:** The worker marks the job complete or failed. On failure, pg-boss can retry (e.g. 3 attempts with backoff). After success, the activity is marked `isProcessed = true`.

---

## Key files

- **`queues/activity.queue.ts`** — Enqueues activity processing jobs (e.g. `addActivityProcessingJob`). Uses pg-boss to send a job with payload `{ stravaActivityId, userId, ownerId }`.
- **`workers/activity.worker.ts`** — Subscribes to the activity queue, fetches activity from Strava, saves it, and calls **`services/activity-processor.service.ts`** to run the matching pipeline and update projects and street progress.
- **`services/activity-processor.service.ts`** — Contains the core logic: overlap detection (which projects the activity intersects), V1 matching (Overpass/Mapbox → UserStreetProgress), V2 matching (node proximity → UserNodeHit), and project progress updates.

---

## Retry and failure

- **Temporary errors** (e.g. Strava API timeout): pg-boss retries the job (configurable attempts and backoff).
- **Permanent errors** (e.g. activity deleted on Strava): The worker can mark the job complete (skipped) so it doesn’t retry forever.
- **Token errors:** The worker attempts a token refresh and, if successful, retries the job.

---

## Disabling the queue

For tests or special setups, set **`DISABLE_QUEUE=true`**. The app will then process activities **synchronously** when requested (e.g. sync or webhook), without enqueueing. Useful to avoid starting pg-boss in unit tests.
