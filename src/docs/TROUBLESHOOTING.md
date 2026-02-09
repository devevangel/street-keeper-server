# Troubleshooting

Common issues, causes, and what to do.

---

## My run didn’t mark any streets

**Possible causes:**

- **GPS drift / bad signal:** Points may be far from the road. V2 uses a 25 m buffer; if the track is offset more than that, nodes won’t be hit. V1 can misassign to the wrong street or miss segments.
- **Engine or data mismatch:** If the app uses V2 but the backend is set to V1 only (`GPX_ENGINE_VERSION=v1`), only V1 runs; the V2 map won’t show new progress. Match `GPX_ENGINE_VERSION` and frontend engine.
- **Activity not processed:** Check `Activity.isProcessed`. If false, the worker may not have run (queue disabled, worker not started, or job failed). Run sync again or use **reset-processed-activities** and re-sync so the activity is reprocessed.
- **No seeded data (V2):** If using V2, NodeCache (and WayNode, WayTotalEdges) must be seeded for the region. Otherwise no nodes are found. Run the PBF seed script for your area.

**What to do:** Confirm engine version and seed state; ensure the activity is processed; check logs for errors during processing.

---

## A street shows complete but I didn’t run it all

**Possible causes:**

- **90% rule (V2):** In V2 a street is “complete” at 90% of nodes hit (or 100% for ≤10 nodes). You may have hit enough nodes without covering the full length visually.
- **Parallel street:** The 25 m buffer can include nodes on a nearby parallel road. If your GPS drifted, nodes on the other street might be marked hit.
- **V1 percentage:** V1 stores a percentage; the map may show “complete” when the stored value is above the display threshold (e.g. 95% for aggregated view).

**What to do:** This is expected in some edge cases. Adjusting the snap radius or threshold would change behaviour globally; document the rule for users.

---

## Sync isn’t finding my activities

**Possible causes:**

- **Token expired:** Strava access tokens expire. The backend should refresh automatically; if refresh fails (e.g. revoked app access), API calls fail. Check user’s Strava connection and token refresh logic.
- **Activity type filter:** We may only process “Run” (and possibly “Walk”). Other types might be skipped. Check activity type in Strava and in our processing logic.
- **Privacy:** If activities are “Only me,” the Strava API may still return them with the correct scopes (`activity:read_all`). If they’re hidden from the app, they won’t appear.
- **Webhook not subscribed or wrong URL:** New activities are pushed only if the webhook is subscribed and the callback URL is correct. Manual “Sync” uses the list endpoint instead.

**What to do:** Verify tokens and refresh; confirm activity types and privacy; for webhooks, confirm subscription and BASE_URL.

---

## The seed script is slow or failing

**Possible causes:**

- **Large PBF:** A country or big region has millions of nodes/ways. The script streams and batches but can still take a long time or use a lot of memory.
- **Memory (heap):** NodeCache pass can use a lot of RAM. Increase Node heap: `NODE_OPTIONS=--max-old-space-size=8192`.
- **Database:** Slow or failing inserts (e.g. connection pool, disk). Check PostgreSQL load and connectivity.
- **Flags:** Use `--node-cache-only` or `--way-nodes-only` when re-running only part of the pipeline to save time.

**What to do:** Use a smaller region PBF for dev; increase heap; run in stages with the documented flags; monitor DB and script logs.

---

## Webhook events aren’t being processed

**Possible causes:**

- **Verification failed:** Strava requires the callback to respond to GET with the correct `hub.challenge`. If verification failed, the subscription isn’t active. Check the verify token and response format.
- **Response too slow:** We must respond 200 within 2 seconds. If the handler does heavy work before responding, Strava may retry or drop. We should only enqueue and return 200; the worker does the work.
- **Worker not running or queue disabled:** If the worker isn’t started or `DISABLE_QUEUE=true`, jobs aren’t processed. Ensure the server starts the worker and the queue is enabled.
- **Backlog:** Many events at once can create a backlog. Jobs are processed in order; check queue depth and worker logs.

**What to do:** Re-subscribe the webhook and confirm challenge response; ensure handler is fast; ensure worker is running and queue enabled; check for job failures in logs.

---

## Map shows no streets

**Possible causes:**

- **Empty geometry cache:** The map endpoint uses GeometryCache (and Overpass fallback). If the cache is empty and Overpass fails or isn’t called, no geometries are returned.
- **Overpass rate limit or error:** V1 and geometry fetches depend on Overpass. Rate limits or downtime can cause empty or failed responses. Check Overpass status and error responses.
- **Radius or bounds:** If the requested radius is very small or the center is wrong, the query might return no streets. Try larger radius or different center.
- **Wrong engine endpoint:** If the frontend calls GET /map/streets (V1) but progress is only in V2 (UserNodeHit), you might see geometry but no progress (or the other way around). Use GET /engine-v2/map/streets when using V2 for the map.

**What to do:** Trigger a geometry fetch (e.g. project preview) to fill cache; check Overpass and radius; align map endpoint with engine version.
