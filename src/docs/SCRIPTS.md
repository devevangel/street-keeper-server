# Scripts and Utilities

All scripts are run from the **backend** directory with `npx tsx src/scripts/<script>.ts` (or via npm scripts where defined). Ensure **DATABASE_URL** is set in `.env`.

---

## 1. seed-way-cache-from-pbf.ts

**Purpose:** Populates **NodeCache**, **WayCache**, **WayNode**, and **WayTotalEdges** from an OpenStreetMap PBF file. Required for the V2 engine to run without Overpass.

**When to use:** Before using V2 (or when adding a new region). Run once per PBF extract.

**Command:**

```bash
npm run seed:way-cache -- path/to/region.osm.pbf
```

**Flags:**

| Flag | Effect |
|------|--------|
| (none) | Full run: Pass 1 (WayCache, WayTotalEdges, WayNode), Pass 2 (NodeCache). |
| `--node-cache-only` | Skip Pass 1; load node IDs from existing WayCache and run only Pass 2 (NodeCache). Use after a run that already wrote WayCache. |
| `--way-nodes-only` | Skip Pass 1 and 2; stream WayCache and populate **WayNode** + **WayTotalEdges.totalNodes** only. Use when WayCache and NodeCache already exist and you only need way–node mapping. |

**Notes:** Large PBFs can cause high memory use. Increase heap if needed: `NODE_OPTIONS=--max-old-space-size=8192 npm run seed:way-cache -- path/to/file.pbf`. Default PBF path if omitted is `src/hampshire-260206.osm.pbf` (if present).

---

## 2. reset-processed-activities.ts

**Purpose:** Sets **isProcessed** to `false` for activities so they will be reprocessed on the next sync (or when the worker runs).

**When to use:** After changing engine logic or fixing bugs so existing activities are re-run through the pipeline.

**Command:**

```bash
npm run reset:processed-activities
```

**Output:** Logs how many activities were reset. No flags in the standard script.

---

## 3. wipe-and-resync.ts

**Purpose:** “Nuclear” reset: deletes **activities**, **ProjectActivity**, **UserStreetProgress**, and **UserEdge** for the given (or all) users. Does **not** delete users, projects, or seeded data (WayCache, NodeCache, WayNode, WayTotalEdges). **UserNodeHit** is not deleted by the default wipe (V2 node hits remain unless you add a separate step).

**When to use:** When you want to clear all derived progress and re-sync from Strava from scratch.

**Command:**

```bash
npx tsx src/scripts/wipe-and-resync.ts [userId?]
```

If `userId` is omitted, wipes all users’ activities and progress. Then re-sync via the app or API.

---

## 4. backfill-user-street-progress.ts

**Purpose:** Backfills **UserStreetProgress** (V1) from project snapshots (e.g. after adding the map feature or fixing progress logic). Reads each project’s streetsSnapshot and updates UserStreetProgress so the map shows correct percentages.

**When to use:** When V1 map or project progress was missing or wrong and you have valid project data.

**Command:**

```bash
npm run backfill:street-progress
```

---

## 5. cleanup-unnamed-street-progress.ts

**Purpose:** Removes **UserStreetProgress** rows that have empty or placeholder names (e.g. “Unnamed” or “”) to reduce noise in the map/list.

**When to use:** Periodically or after discovering many unnamed rows.

**Command:**

```bash
npm run cleanup:unnamed
```

---

## 6. cleanup-low-coverage-street-progress.ts

**Purpose:** Deletes **UserStreetProgress** rows below a coverage threshold (e.g. very low percentage) to remove noise from brief touches or bad matches.

**When to use:** When the map or lists are cluttered with barely-touched streets.

**Command:**

```bash
npm run cleanup:low-coverage
```

---

## 7. create-test-user.ts

**Purpose:** Creates a test user in the database with a given name (default “Test User”) and prints the **userId**. Useful for calling engine-v2/analyze or other endpoints that require a user ID.

**When to use:** Local development or testing when you don’t have a real Strava-linked user.

**Command:**

```bash
npx tsx src/scripts/create-test-user.ts [name]
```

**Output:** Prints the new user’s ID and an example curl for V2 analyze.

---

## 8. list-users.ts

**Purpose:** Lists all users in the database (id, name, email, createdAt) for reference and debugging.

**When to use:** To find user IDs for API calls or to confirm users exist after OAuth.

**Command:**

```bash
npx tsx src/scripts/list-users.ts
```

---

## Summary table

| Script | npm script | Purpose |
|--------|------------|---------|
| seed-way-cache-from-pbf | `seed:way-cache` | PBF → NodeCache, WayCache, WayNode, WayTotalEdges |
| reset-processed-activities | `reset:processed-activities` | Mark activities unprocessed for re-sync |
| wipe-and-resync | (tsx only) | Wipe activities and progress; keep users/projects/seed data |
| backfill-user-street-progress | `backfill:street-progress` | Backfill V1 UserStreetProgress from projects |
| cleanup-unnamed-street-progress | `cleanup:unnamed` | Remove unnamed UserStreetProgress rows |
| cleanup-low-coverage-street-progress | `cleanup:low-coverage` | Remove low-coverage UserStreetProgress rows |
| create-test-user | (tsx only) | Create a test user and print userId |
| list-users | (tsx only) | List all users |
