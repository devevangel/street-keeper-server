# Street Keeper — Product & Feature Roadmap

> **Purpose**
> This document defines the **product roadmap** for Street Keeper. It explains *what* the product does, *why* features exist, and *how they fit together conceptually*. It is intentionally **implementation‑agnostic** (no schemas, endpoints, or code) and should remain stable even as engines evolve.

Street Keeper’s core promise:

> **Turn every run into visible, motivating progress across real streets — and help runners know exactly where to run next.**

---

## Architecture Context

Street Keeper analyses GPS activities (via Strava) to determine which streets a user has run and how much of each street they have covered.

The system currently supports two engines:

* **V1 — Area‑first engine**
  Uses Overpass + Mapbox to estimate street‑level completion percentages within an area.

* **V2 — Path‑first engine**
  Uses a local map‑matcher and edge‑level coverage to determine *exactly* which street segments were traversed.

All features below are **engine‑agnostic** where possible. Each feature reads from the currently active progress source (V1 or V2) without exposing engine internals to the user.

---

## Feature Philosophy

Street Keeper is built around three principles:

1. **Progress must feel earned** — accuracy matters.
2. **Motivation beats precision** — results must be emotionally rewarding.
3. **Execution matters** — users need help *running the streets*, not just seeing gaps.

This roadmap reflects those principles by prioritising habit formation, clear feedback, and actionable planning.

---

## Feature Priority Summary

| #  | Feature                                          | Category           | Effort      | Rationale                                        |
| -- | ------------------------------------------------ | ------------------ | ----------- | ------------------------------------------------ |
| 1  | Streaks & Consistency                            | Retention          | Low         | Strong habit‑forming mechanic with very high ROI |
| 2  | Post‑Run Summary & Shareable Card                | Growth + Retention | Medium      | Turns every run into a satisfying result moment  |
| 3  | Milestones & Achievement Badges                  | Retention          | Low–Medium  | Creates celebration and long‑term goals          |
| 4  | Next Run Planning (Gap Suggestions + Navigation) | Engagement         | Medium      | Converts insight into action                     |
| 5  | Weekly Email Digest                              | Re‑engagement      | Low         | Proven channel to re‑activate users              |
| 6  | Explored vs Unexplored Heatmap                   | Engagement         | Medium      | Highly motivating city‑scale visual              |
| 7  | Exploration Intelligence (AI Insights)           | Differentiation    | Medium–High | Unique insights combining running + exploration  |
| 8  | Street Discovery Feed                            | Engagement         | Low         | Reinforces emotional connection to streets       |
| 9  | Project‑Scoped Leaderboards                      | Social             | Medium      | Adds competition without demotivating globals    |
| 10 | This Day Last Year                               | Re‑engagement      | Low         | Nostalgia‑driven motivation                      |
| 11 | Street Tags (Community)                          | UGC                | Medium      | Local knowledge and stickiness                   |
| 12 | Time‑Bound Challenges                            | Competition        | Medium–High | Periodic urgency and bursts of activity          |
| 13 | Team Projects & Social                           | Social             | High        | Strong multiplier once critical mass exists      |

---

## Feature 1: Streaks & Consistency Tracking

### Purpose

Encourage regular engagement and reinforce running as a habit.

### What it does

Tracks **weekly streaks** based on:

* at least one synced run,
* discovering at least one new street,
* or reaching a higher exploration threshold.

### Streak types

* **Running streak:** ≥1 run per week
* **Discovery streak:** ≥1 new street per week
* **Explorer streak:** ≥N new streets per week (default N=5)

### UX concept

* Active: “🔥 4‑week discovery streak”
* Broken: “Your streak ended — restart it this week”

### Notes

* Weekly cadence matches real runner behaviour
* Timezone‑aware
* Backfilled activities handled gracefully

---

## Feature 2: Post‑Run Summary & Shareable Card

### Purpose

Create a rewarding moment immediately after each run.

### What it does

After processing an activity, show:

* new streets discovered,
* streets revisited,
* total streets touched,
* project progress changes,
* streak updates,
* newly earned milestones.

### Sharing

Optional shareable card for:

* Strava description,
* social platforms,
* messaging.

### UX concept

A clean summary card:

* Primary stat: “🆕 7 new streets”
* Progress delta: “Portsmouth South: 22.5% → 23.1%”

### Notes

* Celebrate effort even when 0 new streets are found
* Sharing is always opt‑in

---

## Feature 3: Milestones & Achievement Badges

### Purpose

Create long‑term goals and celebratory moments.

### Examples

* Total streets: 10 / 50 / 100 / 250 / 500 / 1000
* Streaks: 4 / 12 / 26 / 52 weeks
* Projects: first completion, 50% completion
* Single runs: 20+ new streets

### UX

* Toast: “🎉 Achievement unlocked: Century — 100 streets”
* Dedicated milestones page

### Notes

* Milestones are permanent and stable
* Avoid duplicate awards

---

## Feature 4: Next Run Planning (Gap Suggestions + Navigation)

### Purpose

Help users decide **where to run next — and actually execute the run**.

This feature closes the loop between insight and action.

### 4A. Gap Suggestions

Suggestions such as:

* Almost‑complete streets
* Nearest unrun streets
* Project milestone targets
* Dense clusters of unexplored streets

Displayed as a small, focused list (5–10 max).

### 4B. Navigation / Sync to Device

#### Why this matters

Knowing *what* to run is not enough — runners need help *running it* without stopping to check a map.

#### What it does

Allows a user to turn a suggestion into a **route/course**:

* Generate a GPX file covering the suggested streets
* Send to:

  * Garmin Connect (courses)
  * Apple Watch (later)
  * Manual GPX download

#### Scope (initial version)

* Course generation only (no turn‑by‑turn navigation)
* Relies on the watch/device for guidance

#### Important constraints

* Private or restricted streets are excluded from routing
* If a suggestion is not routable, it is clearly marked

This transforms Street Keeper from an *analysis tool* into a *practical running companion*.

---

## Feature 5: Weekly Email Digest

### Purpose

Re‑engage users and reinforce habit formation.

### Content

* Runs completed
* New vs repeat streets
* Current streak status
* Project progress
* One personalised next‑run suggestion

### Notes

* Friendly, non‑guilt tone
* User‑configurable delivery time

---

## Feature 6: Explored vs Unexplored Heatmap

### Purpose

Make progress visible at city scale.

### Modes

* Binary: explored vs unexplored
* Density (later): revisit frequency

### UX

Full‑screen map with stats:
“You’ve run 312 of 4,521 streets in this view (6.9%).”

---

## Feature 7: Exploration Intelligence (AI Insights)

### Purpose

Differentiate Street Keeper through meaningful insights.

### Examples

* New streets per km efficiency
* Pace on new vs familiar streets
* Exploration direction bias
* Project completion ETA

### Notes

* Only shown when data is sufficient
* Insights are explanatory, not prescriptive

---

## Feature 8: Street Discovery Feed

### Purpose

Reinforce emotional connection to street names and places.

### What it shows

A chronological feed of newly discovered streets per run.

---

## Feature 9: Project‑Scoped Leaderboards

### Purpose

Introduce competition without demotivation.

### Scope

* Per project
* Optional friend groups
* Monthly views

Privacy‑first and opt‑in.

---

## Feature 10: This Day Last Year

### Purpose

Use nostalgia to highlight long‑term progress.

Example:
“On Feb 7, 2025 you had 45 streets. Now: 312.”

---

## Feature 11: Street Tags (Community)

### Purpose

Capture local knowledge and create community value.

### Examples

* Scenic
* Hilly
* Well‑lit
* Busy traffic

---

## Feature 12: Time‑Bound Challenges

### Purpose

Create urgency and short‑term goals.

Examples:

* 100 new streets this month
* +5% project completion in 30 days

Always opt‑in.

---

## Feature 13: Team Projects & Social

### Purpose

Enable collaborative exploration once user density exists.

Teams can:

* work toward shared goals,
* see collective progress,
* compare contributions.

Solo experience must feel complete before this feature ships.

---

## Suggested Build Phases

* **Phase A — Core Habit Loop:** 1 → 2 → 3
* **Phase B — Planning & Execution:** 4 → 5
* **Phase C — Visual Motivation:** 6 → 8
* **Phase D — Intelligence:** 7
* **Phase E — Social:** 9 → 10 → 11
* **Phase F — Competition & Teams:** 12 → 13

---

## Final Note

Street Keeper is not just about mapping streets.

It is about:

* turning exploration into motivation,
* transforming data into direction,
* and helping runners **know where to go next — and actually go there**.
