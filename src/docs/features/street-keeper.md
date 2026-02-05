# Street Keeper – Product Features

A structured breakdown of features from product owner notes, ordered for implementation on top of the existing map and sync functionality.

---

## 1. Strava Post-Run Summary (Auto Stats)

- **Idea:** After a run, automatically add to Strava (or generate a shareable summary) with run stats.
- **Content:** e.g. “You ran down **20 new roads** today and **50 roads** you've run before. **New road ratio: 2:5**.”
- **Implies:** Per-activity stats: new streets count, repeat streets count, ratio; optionally push to Strava (activity description/comment) or show in-app and “copy for Strava”.

---

## 2. Website Stats & “Most Run” Lists

- **Idea:** On the site, show high-level and yearly stats.
- **Examples:**
  - “Your most run-down roads this year have been: [road 1], [road 2], …”
- **Implies:** Aggregations by year (or all-time), sortable by “times run” or “total distance”, with a “top N” list (and possibly a simple chart or table).

---

## 3. Projects (Areas / Challenges)

- **Idea:** User-defined areas (e.g. “Portsmouth”, “Hampshire”, “Southampton”) with progress and per-run impact.
- **Definition:** User draws a boundary (polygon) or picks a centre + radius; system finds **all roads inside** that boundary.
- **Project view shows:**
  - Overall: “You have run down **23% of Portsmouth**.”
  - Per run (for that project): “In today's run you added **7 new roads**, which was **1%** of the roads in Portsmouth.”
- **Multiple projects:** Portsmouth, Hampshire, Southampton, etc., each with its own boundary and stats.
- **Time-bound challenges:** e.g. “Run 1,000 different roads in a month” (global or within a project).

---

## 4. Project Creation UX

- **Idea:** Define a project from the map.
- **Options:**
  - **Radius:** Place a dot (centre) and drag out a radius (circle).
  - **Polygon:** Draw a line around the area (e.g. around Portsmouth).
- **Backend:** Given the boundary (circle or polygon), compute “all roads within” (using existing road/segment data or OSM), store the project and its road list, then track completion % and new streets per run.

---

## 5. Project Map Visualisation (“Map Becomes the Roads”)

- **Idea:** For each project, the main view is **road-centric**, not the base map.
- **Behaviour:** “We lose the map” = base map is minimal or removed; you **keep road geometry** and colour it by status.
- **Three states (three colours):**
  - **Not run** (e.g. one colour)
  - **Partially run** (another colour)
  - **Completed** (e.g. green)
- **Purpose:** See where you're missing coverage (e.g. eastern Southsea) and plan runs there; watch the project “fill in” over time.
- **Uses existing logic:** Completed vs partial can reuse the current completion threshold (e.g. 95% weighted) so one street = one colour on the project map.

---

## 6. Team Projects & Competitions (Later)

- **Idea:** Shared goals and leaderboards.
- **Examples:**
  - Team project: “Run all of Portsmouth in a day” or “all of Hampshire in a month.”
  - Competitions: most streets in a day / week / month (per user or per team).
- **Implies:** Teams, joining a “challenge”, aggregating progress across members, and leaderboards (and possibly notifications).

---

## 7. Core Product Principle

- **Streets and names matter**, not A→B routes.
- **Value:** “I've done this street, that street” – local place, history, discovery (including small alleys you'd normally miss).
- **Design rule:** Features should emphasise **street-level** progress and discovery, not just distance or single routes.

---

## Suggested Build Order

| Phase | Features                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **Projects (area + progress):** Draw polygon (or radius) → “roads in area” → “X% of [Portsmouth]” and “today you added N new roads (Y% of area)”. |
| **2** | **Project map view:** Same map component, but project-scoped; three colours (not run / partial / completed); “map becomes the roads”.             |
| **3** | **Strava summary:** Per-activity “20 new, 50 repeat, ratio 2:5” and optional push/copy to Strava.                                                 |
| **4** | **Website stats:** “Most run-down roads this year” and similar aggregations.                                                                      |
| **5** | **Time-bound challenges:** e.g. “1,000 roads in a month” (global or per project).                                                                 |
| **6** | **Team projects & leaderboards.**                                                                                                                 |
