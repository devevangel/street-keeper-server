# Street Keeper Product Roadmap

## Executive Summary

Street Keeper turns every run into visible progress across real streets. Core promise: **Help runners know exactly where to run next.**

## Design Philosophy

1. **Progress must feel earned** — accuracy matters.
2. **Motivation beats precision** — results must be emotionally rewarding.
3. **Execution matters** — help users RUN streets, not just see gaps.

---

## Feature: Project Creation

### Problem Statement

Users need to define an area to track. The flow must support searching for locations naturally and show the impact of their choices immediately.

### Solution

Universal search (addresses, hospitals, landmarks) + auto-visible radius (500 m default) + auto-preview in a single-screen flow.

### Business Rationale

- **Universal search:** Users think "near the hospital" not "50.8, -1.09".
- **500 m default:** Smallest radius = lowest commitment = higher conversion.
- **Auto-preview:** Removes friction; user sees result immediately.
- **Single screen:** Reduces cognitive load; no "what's next?" moments.

### Alternatives Considered

- City/region picker: Too coarse, doesn't match mental model.
- Draw-on-map only: Works but search is faster and more discoverable.
- Larger default radius: Higher street count = overwhelming for new users.

### Success Metrics

- Project creation completion rate
- Time to create first project
- Average radius selected (indicates user confidence)

---

## Feature: Project Dashboard

### Problem Statement

The detail page must show motivation and actionable next steps, not just raw numbers.

### Solution

Dashboard with high-impact stats (distance covered, activity count), visual charts, milestone hints, and next-run suggestions.

### Business Rationale

| Stat             | Why                                             |
| ---------------- | ----------------------------------------------- |
| Distance covered | "23 km" is tangible; streets are abstract      |
| Activity count   | Shows commitment ("12 runs here")               |
| Last run date    | Creates urgency ("5 days ago...")               |
| Milestone hint   | Micro-goals create dopamine ("3 more to 75%!")  |
| Charts           | Visual progress is more satisfying than numbers |

### Alternatives Considered

- Modals for maps: Rejected — maps need full screen for planning.
- Just numbers: Rejected — not emotionally engaging.
- Gamification badges: Deferred — milestones achieve similar effect more simply.

---

## Feature: Next Run Suggestions (Feature 4)

### Problem Statement

Users manually scan maps for gaps. The app should tell them where to run.

### Solution

Four suggestion types: **almost complete**, **nearest**, **milestone**, **cluster**.

### Business Rationale

This feature makes Street Keeper indispensable. It captures the "before run" moment — when users decide where to go.

| Type            | Psychology                                      |
| --------------- | ----------------------------------------------- |
| Almost complete | Completion bias — finish what you started      |
| Nearest         | Convenience — minimize effort to start         |
| Milestone       | Goal gradient — closer to goal = more motivated |
| Cluster         | Efficiency — maximize new streets per km        |

### Why These Four Types

- **Almost complete:** Streets that are 91% done are frustrating to leave.
- **Nearest:** "What's closest?" is the most common question.
- **Milestone:** 25 / 50 / 75% are natural psychological checkpoints.
- **Cluster:** Runners want efficient routes, not random streets.

### Success Metrics

- Suggestions viewed per session
- Runs that follow suggestions (activity matches suggested streets)
- Project completion rate after suggestions feature

---

## Feature: Full-Page Maps (No Modals)

### Problem Statement

How should users view project maps and heatmaps?

### Solution

Full-page dedicated routes, not modals.

### Business Rationale

Maps are for planning runs. Users need:

- Full screen for zooming and panning
- Natural mobile gestures (pinch-zoom)
- Space to see street names and details

Modals constrain viewport and feel cramped on mobile.

### Implementation

- `/projects/:id/map` — street status map
- `/projects/:id/heatmap` — activity density
- `/projects/:id/suggestions` — suggestions highlighted

Dashboard shows a thumbnail that links to the full map.

---

## Technical Decisions

### Geocoding: Nominatim

- Free, no API key required
- Supports all OSM data (hospitals, parks, addresses)
- Rate limit: 1 req/sec (handled with debounce)

### Charts: Recharts

- React-native, TypeScript support
- Responsive out of the box
- ~400 kb gzipped (acceptable)

### Heatmap: leaflet.heat

- Lightweight Leaflet plugin
- GPU-accelerated rendering
- Configurable gradient and radius

### Boundary Mode Default: Centroid

- Include streets if centroid is in circle
- More inclusive = more streets = more achievable goals
- Strict mode available for purists

### Default Radius: 500 m

- Smallest option = lowest intimidation
- ~50–100 streets typically
- Users can always expand later
