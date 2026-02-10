# Street Keeper — Feature Roadmap & Implementation Guide

> **Purpose:** A detailed, implementation-ready guide for every planned feature beyond the core engine. Each feature is numbered by priority (most valuable first) with a rationale for its ranking. Scoped with database changes, API endpoints, frontend components, and implementation notes. Designed so a developer can sit down with AI assistance and build each feature end-to-end.

---

## Architecture Context

Street Keeper tracks which streets a user has run using GPS data from Strava. The system has two engines:

- **V1 (area-first):** Overpass + Mapbox → percentage-based progress in `UserStreetProgress`
- **V2 (path-first):** Local map-matcher → edge-based progress in `UserEdge`

All features below build on existing data: `UserEdge`, `UserStreetProgress`, `Activity`, `User`, `Project`, and Strava webhook sync. Features are engine-agnostic where possible — they read from whichever progress table is active.

**Tech stack:** Node.js/Express backend, Prisma ORM, PostgreSQL, Angular frontend, Strava API integration, Mapbox GL JS for maps.

---

## Feature Priority Summary

| #   | Feature                              | Category           | Effort      | Why This Rank                                                                                     |
| --- | ------------------------------------ | ------------------ | ----------- | ------------------------------------------------------------------------------------------------- |
| 1   | Streaks & Consistency                | Retention          | Low         | Highest ROI: queries existing data, proven #1 retention mechanic in fitness apps                  |
| 2   | Post-Run Summary & Shareable Card    | Growth + Retention | Medium      | Captures the "after run" dopamine hit and drives organic sharing to new users                     |
| 3   | Milestones & Achievement Badges      | Retention          | Low-Medium  | Discrete reward moments that compound with streaks; cheap to build on existing counters           |
| 4   | "Next Run" Gap Suggestions           | Engagement         | Medium      | Captures the "before run" moment — makes users open the app to plan, not just review              |
| 5   | Weekly Email Digest                  | Re-engagement      | Low         | Highest-converting re-engagement channel; brings back lapsed users without app opens              |
| 6   | Run Heatmap / Explored vs Unexplored | Engagement         | Medium      | Visual motivation — seeing grey patches you haven't touched is a powerful driver                  |
| 7   | AI Running Insights                  | Differentiation    | Medium-High | Unique angle no competitor has: combining fitness metrics with street exploration data            |
| 8   | Street Discovery Feed                | Engagement         | Low         | Satisfies "I did these specific things" — reinforces the street-level identity of the product     |
| 9   | Leaderboards (Project-Scoped)        | Social/Competition | Medium      | Social pressure drives consistency; project-scoped avoids the "London runner always wins" problem |
| 10  | "This Day Last Year"                 | Re-engagement      | Low         | Nostalgia + progress comparison; trivial to build, surprisingly effective for casual users        |
| 11  | Street Tags (Community)              | Community/UGC      | Medium      | Crowdsourced local knowledge creates sticky community value beyond just running                   |
| 12  | Time-Bound Challenges                | Competition        | Medium-High | Structured urgency drives bursts of activity; needs careful design to avoid burnout               |
| 13  | Team Projects & Social               | Social             | High        | Multiplayer transforms retention curves but needs critical mass of users to work                  |

---

## Feature 1: Streaks & Consistency Tracking

### Why #1

Streaks are the single most effective retention mechanic in fitness apps, period. Duolingo, Snapchat, Peloton, and every successful habit app proves this. The reason is psychological: once someone has a streak going, the fear of losing it is stronger than the motivation to start one. This creates a self-reinforcing loop where users run specifically to maintain their streak, even on days they otherwise wouldn't.

For Street Keeper specifically, streaks solve the "I synced my run, now what?" problem. Without streaks, there's no reason to come back until the next run. With streaks, the app creates ambient anxiety (positive kind) about maintaining the chain.

**Cost-to-value ratio is unbeatable:** This feature queries existing data (UserEdge timestamps), needs one new table, and can ship in a day. No new external dependencies, no complex algorithms.

### 1.1 What It Does

Tracks consecutive periods (weeks) where the user discovered at least one new street. Displays streak count prominently. Supports multiple streak types for depth.

### 1.2 Streak Types

| Streak Type                   | Definition                                                   | Reset Condition                           |
| ----------------------------- | ------------------------------------------------------------ | ----------------------------------------- |
| **Discovery streak (weekly)** | Weeks in a row with ≥1 new street discovered                 | A full week passes with 0 new streets     |
| **Running streak (weekly)**   | Weeks in a row with ≥1 synced run                            | A full week passes with 0 activities      |
| **Explorer streak (weekly)**  | Weeks in a row with ≥N new streets (configurable, default 5) | A full week with fewer than N new streets |

Weekly streaks are better than daily for runners. Runners don't run every day — even serious ones take rest days. A daily streak would break constantly and feel punishing. Weekly gives flexibility while still creating commitment.

A "week" is Monday 00:00 to Sunday 23:59 in the user's timezone.

### 1.3 Database Changes

```prisma
model UserStreak {
  id             String   @id @default(uuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  streakType     String   // "discovery_weekly", "running_weekly", "explorer_weekly"
  currentCount   Int      @default(0)    // Current consecutive weeks
  longestCount   Int      @default(0)    // All-time best
  lastActiveWeek String   // ISO week string e.g. "2026-W06"
  isActive       Boolean  @default(true) // false = broken, needs new activity to restart
  updatedAt      DateTime @updatedAt

  @@unique([userId, streakType])
  @@index([userId])
}
```

**Migration:** `npx prisma migrate dev --name add_user_streaks`

**Why `lastActiveWeek` as a string:** ISO week format ("2026-W06") makes week comparison trivial — just string compare. No timezone edge-case math.

### 1.4 Backend Implementation

#### 1.4.1 Streak Service — `backend/src/services/streak.service.ts`

```typescript
/**
 * Called after every activity is processed (in activity-processor.service.ts).
 * Determines which streaks to update based on the activity's results.
 */
export async function updateStreaksForActivity(
  userId: string,
  activityDate: Date,
  newStreetsCount: number,
): Promise<{ streakIncremented: boolean; currentStreak: number }>;

/**
 * Get all streak data for a user (for display).
 */
export async function getUserStreaks(userId: string): Promise<UserStreakData[]>;

/**
 * Check and break streaks that have expired.
 * Run as a scheduled job (cron) every Monday at 00:00 UTC.
 */
export async function checkExpiredStreaks(): Promise<void>;
```

#### 1.4.2 Streak Update Logic

```
function updateStreaksForActivity(userId, activityDate, newStreetsCount):
  currentWeek = toISOWeek(activityDate)  // e.g. "2026-W06"

  // --- Discovery streak ---
  streak = getOrCreate(userId, "discovery_weekly")
  if newStreetsCount > 0:
    if streak.lastActiveWeek == currentWeek:
      // Already counted this week, no change
      return { streakIncremented: false, currentStreak: streak.currentCount }
    else if streak.lastActiveWeek == previousWeek(currentWeek):
      // Consecutive! Increment
      streak.currentCount += 1
      streak.isActive = true
    else:
      // Gap — restart at 1
      streak.currentCount = 1
      streak.isActive = true
    streak.lastActiveWeek = currentWeek
    streak.longestCount = max(streak.longestCount, streak.currentCount)
    save(streak)
    return { streakIncremented: true, currentStreak: streak.currentCount }

  // --- Running streak ---
  // Same logic but triggers on any activity existing, regardless of newStreetsCount

  // --- Explorer streak ---
  // Accumulate newStreetsCount for the week; only increment when weekly total >= threshold
```

#### 1.4.3 ISO Week Helper

```typescript
export function toISOWeek(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 4);
  const weekNum = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) /
      7,
  );
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export function previousWeek(isoWeek: string): string {
  // Parse "2026-W07" → get Monday of that week → subtract 7 days → toISOWeek
}
```

#### 1.4.4 Integration Point

In `activity-processor.service.ts`, after the V1/V2 pipeline finishes:

```typescript
const streakResult = await updateStreaksForActivity(
  userId,
  activity.startDate,
  newStreetsCount,
);
```

#### 1.4.5 Cron Job for Expired Streaks

```typescript
// Run every Monday at 00:05 UTC
cron.schedule("5 0 * * 1", async () => {
  await checkExpiredStreaks();
});

// checkExpiredStreaks logic:
// For each UserStreak where isActive = true:
//   if lastActiveWeek < currentWeek - 1: set isActive = false
```

### 1.5 API Endpoints

```
GET /api/v1/streaks
  Auth: required
  Response: {
    success: true,
    streaks: [
      {
        type: "discovery_weekly",
        label: "Discovery Streak",
        current: 4,
        longest: 12,
        isActive: true,
        lastActiveWeek: "2026-W06"
      }
    ]
  }
```

No write endpoint — streaks update automatically via activity processing.

### 1.6 Frontend

**`StreakBanner` component** on home/dashboard:

```
🔥 4-week discovery streak!
   You've found new streets 4 weeks in a row.
   Personal best: 12 weeks
```

- Active streak: show current count prominently with a flame/fire visual
- Broken streak: "Your 4-week streak ended. Start a new one this week!"
- Personal best always visible below current

### 1.7 Edge Cases

- **Backdated activities:** Strava can sync old activities. If activityDate is from a previous week, update that week accordingly. May need to recompute streak chain if a gap was filled.
- **Multiple activities in one week:** Only the first activity that week increments the streak; subsequent ones are no-ops.
- **Deleted activities:** Don't recalculate on delete. Streaks are motivational, not financial.
- **Timezone:** Use user's timezone (from Strava profile) to determine week boundaries. Default to UTC.

### 1.8 Testing Checklist

- [ ] Activity with new streets increments discovery streak
- [ ] Second activity same week doesn't double-count
- [ ] Activity after a 1-week gap correctly continues streak
- [ ] Activity after a 2+ week gap resets streak to 1
- [ ] Cron correctly breaks expired streaks
- [ ] Longest count never decreases
- [ ] API returns correct data for active and broken streaks

---

## Feature 2: Post-Run Summary & Shareable Card

### Why #2

This feature serves two critical purposes simultaneously. First, it creates the "after run dopamine hit" — the moment where you see concrete evidence of what your run accomplished in street-exploration terms. Without this, users sync a run and see a map update. That's not emotionally satisfying. A summary that says "12 new streets, 38 revisited, you're now at 23.1% of Portsmouth" turns an abstract map change into a concrete achievement.

Second, it drives organic growth. Every time someone shares a run summary to Strava or social media, it's free advertising to exactly the right audience (other runners). CityStrides grew almost entirely through Strava description sharing. This feature is your growth engine.

**Why above milestones:** Milestones are one-time events. Post-run summaries happen every single run, creating a habit loop (run → see summary → feel good → share → run again).

### 2.1 What It Does

After each activity is processed, generates a summary of street-exploration impact. Displays in-app and provides a shareable image card for Strava, social media, or messaging.

### 2.2 Summary Data Shape

```typescript
interface RunSummary {
  activityId: string;
  activityDate: Date;
  activityName: string; // From Strava e.g. "Morning Run"
  distanceKm: number;
  durationMinutes: number;

  // Street exploration stats
  newStreets: number; // First-time discoveries
  repeatStreets: number; // Previously run
  totalStreetsThisRun: number;
  newToRepeatRatio: string; // e.g. "2:5"

  // Cumulative context
  totalLifetimeStreets: number;

  // Project impact (if any projects were affected)
  projectImpacts: Array<{
    projectId: string;
    projectName: string;
    newStreets: number;
    progressBefore: number;
    progressAfter: number;
    progressDelta: number;
  }>;

  // Milestones earned this run (from Feature 3)
  milestonesEarned: Array<{ id: string; name: string; icon: string }>;

  // Streak info (from Feature 1)
  currentStreak: number;
  streakIncremented: boolean;

  // Flavor
  longestNewStreet?: { name: string; lengthMeters: number };
  shortestNewStreet?: { name: string; lengthMeters: number };
  newStreetNames: string[]; // List of discovered street names
}
```

### 2.3 Database Changes

```prisma
model ActivitySummary {
  id            String   @id @default(uuid())
  activityId    String   @unique
  activity      Activity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  userId        String
  summaryJson   Json     // Full RunSummary object
  createdAt     DateTime @default(now())

  @@index([userId])
  @@index([activityId])
}
```

Also add to the `Activity` model for fast queries:

```prisma
// On the Activity model:
newStreetsCount    Int @default(0)
repeatStreetsCount Int @default(0)
```

### 2.4 Backend Implementation

#### 2.4.1 Summary Service — `backend/src/services/summary.service.ts`

```typescript
/**
 * Generate a run summary after activity processing.
 * Called at the end of the activity-processor pipeline.
 */
export async function generateRunSummary(
  userId: string,
  activityId: string,
  processingResult: {
    newStreetsCount: number;
    repeatStreetsCount: number;
    projectImpacts: ProjectProcessingResult[];
    milestonesEarned: MilestoneDefinition[];
    streakResult: { currentStreak: number; streakIncremented: boolean };
    newStreetNames: string[];
  },
): Promise<RunSummary>;

/**
 * Get summary for a specific activity.
 */
export async function getRunSummary(
  userId: string,
  activityId: string,
): Promise<RunSummary | null>;

/**
 * Generate a shareable PNG card for the run.
 */
export async function generateShareCard(summary: RunSummary): Promise<Buffer>;
```

#### 2.4.2 Share Card Generation

Use `@napi-rs/canvas` for server-side PNG generation:

```typescript
import { createCanvas } from "@napi-rs/canvas";

export async function generateShareCard(summary: RunSummary): Promise<Buffer> {
  const canvas = createCanvas(1200, 630); // Standard social share dimensions
  const ctx = canvas.getContext("2d");

  // Dark background
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, 1200, 630);

  // Activity name
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 42px sans-serif";
  ctx.fillText(summary.activityName, 60, 80);

  // Main stat — new streets
  ctx.font = "bold 120px sans-serif";
  ctx.fillStyle = "#00ff88";
  ctx.fillText(`${summary.newStreets}`, 60, 230);
  ctx.font = "36px sans-serif";
  ctx.fillStyle = "#cccccc";
  ctx.fillText("new streets discovered", 60, 280);

  // Secondary stats
  ctx.font = "28px sans-serif";
  ctx.fillStyle = "#999999";
  ctx.fillText(
    `${summary.totalStreetsThisRun} streets total · ${summary.distanceKm.toFixed(1)} km · ${summary.totalLifetimeStreets} lifetime`,
    60,
    350,
  );

  // Project impact
  if (summary.projectImpacts.length > 0) {
    const p = summary.projectImpacts[0];
    ctx.fillText(
      `${p.projectName}: ${p.progressBefore.toFixed(1)}% → ${p.progressAfter.toFixed(1)}%`,
      60,
      410,
    );
  }

  // Streak
  if (summary.currentStreak > 1) {
    ctx.fillText(`🔥 ${summary.currentStreak}-week discovery streak`, 60, 470);
  }

  // Branding
  ctx.font = "22px sans-serif";
  ctx.fillStyle = "#555555";
  ctx.fillText("streetkeeper.app", 60, 590);

  return canvas.toBuffer("image/png");
}
```

#### 2.4.3 Strava Description Push (Optional, Opt-In)

```typescript
export async function pushSummaryToStrava(
  userId: string,
  stravaActivityId: number,
  summary: RunSummary,
): Promise<void> {
  const text = [
    `🗺️ Street Keeper:`,
    `${summary.newStreets} new streets · ${summary.repeatStreets} revisited`,
    summary.projectImpacts.length > 0
      ? `📍 ${summary.projectImpacts[0].projectName}: ${summary.projectImpacts[0].progressAfter.toFixed(1)}%`
      : null,
    summary.currentStreak > 1
      ? `🔥 ${summary.currentStreak}-week streak`
      : null,
    `📊 ${summary.totalLifetimeStreets} lifetime streets`,
  ]
    .filter(Boolean)
    .join("\n");

  // Strava API: PUT /api/v3/activities/{id} — requires activity:write scope
  await stravaApi.updateActivity(userId, stravaActivityId, {
    description: existingDescription + "\n\n" + text,
  });
}
```

**Note:** Requires `activity:write` scope in OAuth. If not currently requested, this becomes a scope upgrade. Make it opt-in per user.

### 2.5 API Endpoints

```
GET /api/v1/activities/:id/summary
  Auth: required
  Response: { success: true, summary: RunSummary }

GET /api/v1/activities/:id/share-card
  Auth: required
  Response: image/png binary

POST /api/v1/activities/:id/push-to-strava
  Auth: required (opt-in)
  Response: { success: true }
```

### 2.6 Frontend

**`RunSummaryCard` component** — in activity detail and post-sync notification:

```
🗺️ Morning Run
━━━━━━━━━━━━━━━━━━
🆕 12 new streets
🔄 38 revisited
📊 Ratio: 1:3

📍 Portsmouth South: 22.5% → 23.1%
🔥 5-week discovery streak!

Streets discovered: Albert Road, Queen Street,
  Elm Grove, Victoria Road, +8 more

[📤 Share Image] [📋 Copy for Strava]
```

### 2.7 Integration Point

In `activity-processor.service.ts`, as the final step after streaks/milestones/projects:

```typescript
const summary = await generateRunSummary(userId, activity.id, {
  newStreetsCount,
  repeatStreetsCount,
  projectImpacts,
  milestonesEarned,
  streakResult,
  newStreetNames,
});
await prisma.activitySummary.create({
  data: { activityId: activity.id, userId, summaryJson: summary },
});
```

### 2.8 Testing Checklist

- [ ] Summary generated for every processed activity
- [ ] New vs repeat counts are accurate
- [ ] Project impacts included when activity overlaps a project
- [ ] Share card generates valid PNG at 1200x630
- [ ] Strava push appends (doesn't overwrite) existing description
- [ ] Summary handles 0 new streets gracefully
- [ ] Summary handles activities with no street matches

---

## Feature 3: Milestones & Achievement Badges

### Why #3

Milestones provide discrete "achievement moments" that streaks don't. A streak is continuous pressure; a milestone is a celebration. Together they create a complete reward system: streaks keep you coming back weekly, milestones give you "wow" moments at specific thresholds. The "Century — Ran 100 unique streets" badge feels different from "5-week streak" — it's permanent, it's a status symbol, and it's shareable.

**Why below post-run summary:** Milestones are one-time events. Most users will earn maybe 5-10 milestones total. Post-run summaries happen every run — they create the habit. Milestones amplify that habit with occasional big dopamine hits.

**Cost:** Low. Milestones are threshold checks against existing counters. The definitions are static config, not dynamic data.

### 3.1 Milestone Definitions

Define as static config — the database only stores which milestones a user has earned.

```typescript
// backend/src/config/milestones.ts

export interface MilestoneDefinition {
  id: string; // Unique key, never changes
  name: string;
  description: string;
  icon: string; // Emoji or icon key
  category: "streets" | "projects" | "streaks" | "exploration";
  condition: {
    metric: string; // What to check
    threshold: number; // Value to reach
  };
}

export const MILESTONES: MilestoneDefinition[] = [
  // --- Street count ---
  {
    id: "streets_10",
    name: "First Steps",
    description: "Ran 10 unique streets",
    icon: "👟",
    category: "streets",
    condition: { metric: "total_unique_streets", threshold: 10 },
  },
  {
    id: "streets_50",
    name: "Getting Around",
    description: "Ran 50 unique streets",
    icon: "🗺️",
    category: "streets",
    condition: { metric: "total_unique_streets", threshold: 50 },
  },
  {
    id: "streets_100",
    name: "Century",
    description: "Ran 100 unique streets",
    icon: "💯",
    category: "streets",
    condition: { metric: "total_unique_streets", threshold: 100 },
  },
  {
    id: "streets_250",
    name: "Street Scholar",
    description: "Ran 250 unique streets",
    icon: "📚",
    category: "streets",
    condition: { metric: "total_unique_streets", threshold: 250 },
  },
  {
    id: "streets_500",
    name: "Urban Explorer",
    description: "Ran 500 unique streets",
    icon: "🏙️",
    category: "streets",
    condition: { metric: "total_unique_streets", threshold: 500 },
  },
  {
    id: "streets_1000",
    name: "Street Legend",
    description: "Ran 1,000 unique streets",
    icon: "🏆",
    category: "streets",
    condition: { metric: "total_unique_streets", threshold: 1000 },
  },

  // --- Projects ---
  {
    id: "project_first",
    name: "Completionist",
    description: "Completed your first project",
    icon: "✅",
    category: "projects",
    condition: { metric: "projects_completed", threshold: 1 },
  },
  {
    id: "project_3",
    name: "Triple Threat",
    description: "Completed 3 projects",
    icon: "🎯",
    category: "projects",
    condition: { metric: "projects_completed", threshold: 3 },
  },
  {
    id: "project_half",
    name: "Halfway There",
    description: "Reached 50% on any project",
    icon: "⚡",
    category: "projects",
    condition: { metric: "any_project_50_pct", threshold: 1 },
  },

  // --- Streaks ---
  {
    id: "streak_4",
    name: "Month Strong",
    description: "4-week discovery streak",
    icon: "🔥",
    category: "streaks",
    condition: { metric: "longest_discovery_streak", threshold: 4 },
  },
  {
    id: "streak_12",
    name: "Quarter Master",
    description: "12-week discovery streak",
    icon: "⚡",
    category: "streaks",
    condition: { metric: "longest_discovery_streak", threshold: 12 },
  },
  {
    id: "streak_26",
    name: "Half Year Hero",
    description: "26-week discovery streak",
    icon: "🌟",
    category: "streaks",
    condition: { metric: "longest_discovery_streak", threshold: 26 },
  },
  {
    id: "streak_52",
    name: "Year of Discovery",
    description: "52-week discovery streak",
    icon: "👑",
    category: "streaks",
    condition: { metric: "longest_discovery_streak", threshold: 52 },
  },

  // --- Single-run exploration ---
  {
    id: "single_run_20",
    name: "Street Sweeper",
    description: "20+ new streets in one run",
    icon: "🧹",
    category: "exploration",
    condition: { metric: "new_streets_this_run", threshold: 20 },
  },
  {
    id: "single_run_50",
    name: "Neighbourhood Blitz",
    description: "50+ new streets in one run",
    icon: "💨",
    category: "exploration",
    condition: { metric: "new_streets_this_run", threshold: 50 },
  },
  {
    id: "night_run",
    name: "Night Explorer",
    description: "Discovered streets after 8 PM",
    icon: "🌙",
    category: "exploration",
    condition: { metric: "has_night_discovery", threshold: 1 },
  },
  {
    id: "early_run",
    name: "Early Bird",
    description: "Discovered streets before 6 AM",
    icon: "🌅",
    category: "exploration",
    condition: { metric: "has_early_discovery", threshold: 1 },
  },
];
```

### 3.2 Database Changes

```prisma
model UserMilestone {
  id          String   @id @default(uuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  milestoneId String   // References MILESTONES[].id from config
  earnedAt    DateTime @default(now())
  activityId  String?  // Activity that triggered it (null for streak-based)
  notified    Boolean  @default(false) // Has user seen this?

  @@unique([userId, milestoneId])
  @@index([userId])
  @@index([userId, notified])
}
```

### 3.3 Backend Implementation

#### 3.3.1 Milestone Service — `backend/src/services/milestone.service.ts`

```typescript
/**
 * Check all milestones after an activity is processed.
 * Only checks milestones not already earned.
 */
export async function checkMilestones(
  userId: string,
  context: {
    activityId: string;
    newStreetsCount: number;
    totalLifetimeStreets: number;
    activityStartTime: Date;
    longestDiscoveryStreak: number;
    projectsCompleted: number;
  },
): Promise<MilestoneDefinition[]>;

/**
 * Get all milestones: earned and unearned with progress.
 */
export async function getUserMilestones(userId: string): Promise<{
  earned: (MilestoneDefinition & { earnedAt: Date })[];
  unearned: (MilestoneDefinition & { progress: number; target: number })[];
}>;

/**
 * Mark milestones as seen.
 */
export async function acknowledgeMilestones(
  userId: string,
  milestoneIds: string[],
): Promise<void>;
```

#### 3.3.2 Metric Resolution

```typescript
async function resolveMetric(
  userId: string,
  metric: string,
  context: MilestoneContext,
): Promise<number> {
  switch (metric) {
    case "total_unique_streets":
      return context.totalLifetimeStreets;
    case "projects_completed":
      return context.projectsCompleted;
    case "longest_discovery_streak":
      return context.longestDiscoveryStreak;
    case "new_streets_this_run":
      return context.newStreetsCount;
    case "has_night_discovery":
      return context.activityStartTime.getHours() >= 20 &&
        context.newStreetsCount > 0
        ? 1
        : 0;
    case "has_early_discovery":
      return context.activityStartTime.getHours() < 6 &&
        context.newStreetsCount > 0
        ? 1
        : 0;
    case "any_project_50_pct":
      return await prisma.project.count({
        where: { userId, progress: { gte: 50 } },
      });
    default:
      return 0;
  }
}
```

### 3.4 API Endpoints

```
GET /api/v1/milestones
  Auth: required
  Response: {
    earned: [{ id, name, icon, description, earnedAt }],
    unearned: [{ id, name, icon, description, progress, target }],
    newlyEarned: [{ id, name, icon }]  // Not yet notified
  }

POST /api/v1/milestones/acknowledge
  Auth: required
  Body: { milestoneIds: string[] }
  Response: { success: true }
```

### 3.5 Frontend

**`MilestoneToast`** — popup after activity processing when new milestones are earned:

```
🎉 Achievement Unlocked!
💯 Century — Ran 100 unique streets
[Share] [Dismiss]
```

**`MilestonesPage`** — grid of all badges, earned ones highlighted, unearned ones greyed with progress bars showing how close the user is to each.

### 3.6 Testing Checklist

- [ ] Milestone earned on exact threshold (100th street triggers "Century")
- [ ] Same milestone never earned twice
- [ ] Newly earned appear in `newlyEarned` until acknowledged
- [ ] Progress calculated correctly for unearned milestones
- [ ] Time-based milestones (night/early) use correct timezone
- [ ] Milestone check doesn't cause N+1 queries (batch metric resolution)

---

## Feature 4: "Next Run" Gap Suggestions

### Why #4

This is the feature that transforms Street Keeper from a passive tracker into an active planning tool. Every feature above serves the "after run" or "between runs" moment. This one captures the "before run" moment — the moment where someone decides where to run.

Right now, a user might open Street Keeper, see their project map, manually scan for grey streets, and mentally plan a route. That's friction. Gap suggestions remove it: "You're 3 streets from 25% of Portsmouth. Here they are. Go."

**Why this position:** Medium effort (spatial queries, clustering logic) and requires the Projects feature to be fully working. But once users are actively planning runs based on Street Keeper suggestions, you've achieved the holy grail: the app decides where they run, not just what they track.

### 4.1 Suggestion Types

| Type                  | Logic                                                           | Use Case                      |
| --------------------- | --------------------------------------------------------------- | ----------------------------- |
| **Almost complete**   | Streets with 50-94% progress                                    | "Finish what you started"     |
| **Nearest gaps**      | Unrun streets closest to user's location or project centre      | "What's nearby?"              |
| **Project milestone** | Fewest streets needed to reach next % milestone (25%, 50%, 75%) | "3 more to hit 25%"           |
| **Cluster**           | Groups of nearby unrun streets coverable in one run             | "8 new streets in a 5km loop" |

### 4.2 No New Tables Required

Reads existing data: `UserEdge`/`UserStreetProgress`, `Project.streetsSnapshot`, and map geometry.

### 4.3 Backend Implementation

#### 4.3.1 Suggestion Service — `backend/src/services/suggestion.service.ts`

```typescript
interface SuggestionRequest {
  userId: string;
  projectId?: string;
  lat?: number;
  lng?: number;
  maxResults?: number; // Default 10
  type?: "nearest" | "almost_complete" | "cluster" | "project_next";
}

interface StreetSuggestion {
  osmId: string;
  name: string;
  lengthMeters: number;
  currentProgress: number;
  distanceFromPoint?: number;
  geometry: Array<{ lat: number; lng: number }>;
  reason: string; // e.g. "82% complete — just 120m left!"
}

export async function getSuggestions(
  request: SuggestionRequest,
): Promise<StreetSuggestion[]>;
```

#### 4.3.2 Logic Per Type

**Almost complete:**

```
1. Get user's streets with 0 < progress < 95%
2. Sort by progress descending (closest to done first)
3. Add reason: "{progress}% complete — just {remaining}m left!"
4. Return top N
```

**Nearest gaps:**

```
1. Get all streets in project (or within radius of lat/lng)
2. Filter to 0% progress
3. Compute haversine distance from lat/lng to street centroid
4. Sort by distance ascending
5. Return top N
```

**Project milestone:**

```
1. Current progress = e.g. 22.5%
2. Next milestone = 25%
3. Streets needed = ceil((25 - 22.5) / 100 * totalStreets)
4. Pick shortest/nearest unrun streets to fill the gap
5. Reason: "Complete these 4 streets to reach 25% of Portsmouth"
```

**Cluster:**

```
1. Get all unrun streets in project
2. Compute centroids for each
3. Simple clustering: group streets whose centroids are within 500m
4. Score clusters by streets / totalLength (density = most streets in least distance)
5. Return top clusters with their constituent streets
```

### 4.4 API Endpoints

```
GET /api/v1/suggestions?projectId=&lat=&lng=&type=&maxResults=
  Auth: required
  Response: {
    success: true,
    suggestions: StreetSuggestion[],
    context: {
      type: "project_next",
      projectName: "Portsmouth South",
      nextMilestone: { target: 25, streetsNeeded: 4 }
    }
  }

GET /api/v1/projects/:id/suggestions?type=&maxResults=
  Auth: required
  Response: same shape, scoped to project
```

### 4.5 Frontend

**`SuggestionsPanel`** on home page or project detail:

```
🎯 Your Next Run
━━━━━━━━━━━━━━━━━━━━
Almost done:
  • Albert Road (82% — 180m left!)
  • Queen Street (91% — almost there!)

Nearest new streets:
  • Elm Grove (450m away)
  • Victoria Road (600m away)

📍 3 more streets to 25% of Portsmouth South

[View on Map]
```

**`SuggestionMap`** — highlights suggested streets in blue on the project map, distinct from grey (unrun) and green (complete).

### 4.6 Testing Checklist

- [ ] Almost complete returns streets sorted by progress descending
- [ ] Nearest gaps sorted by distance ascending
- [ ] Project milestone calculates correct number of streets needed
- [ ] Cluster groups nearby streets correctly
- [ ] Empty project returns sensible empty state
- [ ] 100% complete project returns "All done!" message
- [ ] Performance acceptable with 1000+ streets

---

## Feature 5: Weekly Email Digest

### Why #5

Email is still the highest-converting re-engagement channel. Push notifications get muted, app icons get ignored, but email gets opened — especially on Monday morning when people plan their week. This feature brings back lapsed users without requiring them to open the app.

**Why this position:** Extremely low effort (template + cron + existing data), but it helps users who are already drifting away, not active users. Features 1-4 serve active users; this catches the ones slipping through.

### 5.1 Email Content Structure

```
Subject: Your week in streets: 12 new discoveries 🗺️

Hey {name},

Last week you ran {runCount} times and discovered {newStreets} new streets.

🔥 Your discovery streak is at {streakCount} weeks!

📍 Portsmouth South: {progressBefore}% → {progressAfter}% (+{delta}%)

This week's suggestion: Finish Albert Road — you're 82% there!

Top discoveries: Albert Road, Queen Street, Elm Grove, Victoria Road, Park Lane

— Street Keeper
[Unsubscribe]
```

### 5.2 Database Changes

```prisma
model UserPreferences {
  id                  String  @id @default(uuid())
  userId              String  @unique
  user                User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  weeklyDigestEnabled Boolean @default(true)
  digestDay           Int     @default(1)   // 0=Sun, 1=Mon, ..., 6=Sat
  timezone            String  @default("UTC")
  pushToStravaEnabled Boolean @default(false) // For Feature 2 opt-in

  @@index([userId])
}
```

### 5.3 Backend Implementation

#### 5.3.1 Digest Service — `backend/src/services/digest.service.ts`

```typescript
interface DigestData {
  userName: string;
  weekRange: string; // "Jan 27 – Feb 2"
  runCount: number;
  totalDistanceKm: number;
  newStreets: number;
  repeatStreets: number;
  streakInfo: { current: number; isActive: boolean };
  projectUpdates: Array<{
    name: string;
    progressBefore: number;
    progressAfter: number;
    newStreets: number;
  }>;
  suggestion: string; // One-line from Feature 4
  topNewStreets: string[]; // Up to 5 street names
}

/**
 * Generate digest data for one user.
 */
export async function generateDigestData(userId: string): Promise<DigestData>;

/**
 * Send digests to all opted-in users. Called by cron.
 */
export async function sendWeeklyDigests(): Promise<{
  sent: number;
  failed: number;
}>;
```

#### 5.3.2 Data Gathering

```typescript
async function generateDigestData(userId: string): Promise<DigestData> {
  const weekStart = getLastMonday();
  const weekEnd = getLastSunday();

  const activities = await prisma.activity.findMany({
    where: { userId, startDate: { gte: weekStart, lte: weekEnd } },
  });

  const summaries = await prisma.activitySummary.findMany({
    where: { activityId: { in: activities.map((a) => a.id) } },
  });

  // Aggregate from summaries
  const newStreets = summaries.reduce(
    (sum, s) => sum + s.summaryJson.newStreets,
    0,
  );
  const repeatStreets = summaries.reduce(
    (sum, s) => sum + s.summaryJson.repeatStreets,
    0,
  );
  const topNewStreets = summaries
    .flatMap((s) => s.summaryJson.newStreetNames || [])
    .slice(0, 5);

  // Suggestion from Feature 4
  const suggestions = await getSuggestions({
    userId,
    type: "almost_complete",
    maxResults: 1,
  });
  const suggestion =
    suggestions.length > 0
      ? `Finish ${suggestions[0].name} — you're ${suggestions[0].currentProgress}% there!`
      : "Explore a new area this week!";

  return {
    userName,
    weekRange,
    runCount: activities.length,
    totalDistanceKm,
    newStreets,
    repeatStreets,
    streakInfo,
    projectUpdates,
    suggestion,
    topNewStreets,
  };
}
```

#### 5.3.3 Email Sending

Use a transactional email service (Resend, SendGrid, or AWS SES):

```typescript
import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendDigestEmail(email: string, data: DigestData) {
  await resend.emails.send({
    from: "Street Keeper <digest@streetkeeper.app>",
    to: email,
    subject: `Your week in streets: ${data.newStreets} new discoveries 🗺️`,
    html: renderDigestTemplate(data),
  });
}
```

#### 5.3.4 Cron

```typescript
// Every Monday at 07:00 UTC
cron.schedule("0 7 * * 1", async () => {
  await sendWeeklyDigests();
});
```

### 5.4 API Endpoints

```
GET /api/v1/preferences
  Auth: required
  Response: { weeklyDigestEnabled, digestDay, timezone, pushToStravaEnabled }

PATCH /api/v1/preferences
  Auth: required
  Body: { weeklyDigestEnabled?: boolean, digestDay?: number, timezone?: string }
  Response: { success: true }

GET /api/v1/preferences/unsubscribe?token=...
  No auth (token-based)
  Sets weeklyDigestEnabled = false
```

### 5.5 Email for Inactive Weeks

When a user had 0 runs, the email should still be encouraging, not guilt-tripping:

```
Hey {name},

Quiet week on the streets — no worries, rest is part of the game.

Your discovery streak is paused at {lastStreak} weeks.
One run with a new street this week restarts it!

📍 Portsmouth South: still at {progress}% — {nearestGap} is just {distance}m away.

— Street Keeper
```

### 5.6 Testing Checklist

- [ ] Digest aggregates correct data for the past week
- [ ] Users with `weeklyDigestEnabled = false` are skipped
- [ ] Email renders correctly with 0 runs (encouraging, not shaming)
- [ ] Unsubscribe link works
- [ ] Cron runs reliably on schedule
- [ ] Email doesn't send to users without an email address

---

## Feature 6: Run Heatmap / Explored vs Unexplored Overlay

### Why #6

Visual motivation is powerful in a way numbers aren't. Seeing a city-wide map where 70% is grey (unexplored) creates an almost physical urge to fill it in. This is the same drive that makes people complete video game maps — humans hate seeing incomplete territory.

**Why this position:** Medium effort (needs efficient geometry rendering at city scale) and it's a visualization of existing data. It doesn't create new behaviors — it amplifies existing motivation. Features 1-5 create new behaviors (streaks, summaries, planning, re-engagement); this one makes the existing "run more streets" behavior more visceral.

### 6.1 Two Modes

**Binary mode (ship first):**

- All streets in the user's area: grey (not run) or green (run at least once)
- Like the project map but city-wide, not scoped to a project

**Density mode (enhancement):**

- Color scale by times run: grey → light green → green → blue → purple
- Shows "most trafficked" vs "one-time" streets

### 6.2 No New Tables Required

For V2: query `UserEdge` grouped by wayId, fetch geometry from WayCache. For V1: query `UserStreetProgress`.

### 6.3 Backend Implementation

```typescript
/**
 * Get street data for heatmap within a viewport.
 */
export async function getHeatmapData(
  userId: string,
  bounds: { north: number; south: number; east: number; west: number },
): Promise<{
  streets: HeatmapStreet[];
  stats: { totalInView: number; runInView: number; coveragePercent: number };
}>;

interface HeatmapStreet {
  wayId: string;
  name: string;
  runCount: number;
  geometry: Array<{ lat: number; lng: number }>;
}
```

**Performance:** Only return streets within the current map viewport (bounds parameter). Cache per user, invalidate on new activity sync.

### 6.4 API Endpoints

```
GET /api/v1/heatmap?north=&south=&east=&west=
  Auth: required
  Response: {
    success: true,
    streets: HeatmapStreet[],
    stats: { totalInView, runInView, coveragePercent }
  }
```

### 6.5 Frontend

**`HeatmapPage`** — full-screen Mapbox GL JS map:

Use data-driven styling:

```typescript
map.addLayer({
  id: "heatmap-streets",
  type: "line",
  source: "streets",
  paint: {
    "line-color": [
      "case",
      ["==", ["get", "runCount"], 0],
      "#444444",
      ["<=", ["get", "runCount"], 1],
      "#22c55e",
      ["<=", ["get", "runCount"], 5],
      "#3b82f6",
      "#8b5cf6",
    ],
    "line-width": 3,
  },
});
```

Stats overlay: "You've run 312 of 4,521 streets in this area (6.9%)"

### 6.6 Testing Checklist

- [ ] Only streets within viewport returned (not entire DB)
- [ ] Run count is accurate per street
- [ ] Map renders smoothly with 1000+ streets visible
- [ ] Stats calculate correctly
- [ ] Viewport updates when user pans/zooms

---

## Feature 7: AI Running Insights

### Why #7

This is Street Keeper's differentiation play. Every running app shows pace, distance, and heart rate. No other app can say: "Your pace on new streets averages 15s/km slower than repeat streets — exploring costs speed but you're covering more ground." That insight is only possible when you combine fitness data with street exploration data.

**Why this position:** Medium-high effort (Strava API data enrichment, statistical analysis, natural language generation). The unique value is high, but it requires Features 1-3 to be working (references streaks, milestones, summaries) and needs several weeks of user data to generate meaningful insights. Not useful on day one.

### 7.1 Insight Categories

| Category                   | Example                                                                    | Data Needed                          |
| -------------------------- | -------------------------------------------------------------------------- | ------------------------------------ |
| **Pace comparison**        | "You run 12s/km slower on new streets"                                     | Per-activity pace + new/repeat split |
| **Exploration efficiency** | "8 new streets/km — your best ratio this month"                            | New streets per km per activity      |
| **Weekly trend**           | "20% more streets per week this month vs last"                             | Weekly aggregates                    |
| **Project ETA**            | "At this rate, you'll complete Portsmouth in 14 weeks"                     | Project progress over time           |
| **Best day**               | "Saturdays are your discovery day — 65% of new streets found on Saturdays" | Day-of-week analysis                 |
| **Coverage pattern**       | "You tend to explore north — try heading south"                            | Directional analysis                 |

### 7.2 Database Changes

```prisma
model ActivityMetrics {
  id                  String   @id @default(uuid())
  activityId          String   @unique
  activity            Activity @relation(fields: [activityId], references: [id], onDelete: Cascade)
  userId              String
  avgPaceSecsPerKm    Float?
  elevationGainM      Float?
  heartRateAvg        Int?
  newStreetPaceAvg    Float?  // Avg pace on segments matching new streets
  repeatStreetPaceAvg Float?
  newStreetsPerKm     Float?
  dayOfWeek           Int     // 0=Sun, 6=Sat
  startHour           Int     // 0-23
  createdAt           DateTime @default(now())

  @@index([userId])
  @@index([userId, createdAt])
}

model UserInsight {
  id          String   @id @default(uuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  insightType String   // "pace_comparison", "weekly_trend", "project_eta", etc.
  insightJson Json     // { title, body, dataPoints, generatedAt }
  weekOf      String   // ISO week
  createdAt   DateTime @default(now())

  @@unique([userId, insightType, weekOf])
  @@index([userId])
}
```

### 7.3 Backend Implementation

#### 7.3.1 Metrics Extraction

During activity processing, pull extended data from Strava API:

```typescript
export async function extractActivityMetrics(
  userId: string,
  stravaActivityId: number,
  processingResult: { newStreetsCount: number; distanceKm: number },
): Promise<ActivityMetrics>;
```

#### 7.3.2 Insight Generation

Run weekly by cron or on-demand:

```typescript
export async function generateInsights(userId: string): Promise<UserInsight[]>;
export async function getUserInsights(userId: string): Promise<UserInsight[]>;
```

**Example: Pace comparison logic:**

```
1. Query ActivityMetrics for last 30 days
2. Compute average newStreetPaceAvg vs repeatStreetPaceAvg
3. If difference > 5s/km (significant):
   title: "New vs Familiar"
   body: "You run {diff}s/km slower on new streets.
          Exploring costs speed but builds coverage."
```

**Example: Project ETA logic:**

```
1. Get project progress over last 8 weeks (weekly snapshots)
2. Linear regression or simple average: streets/week
3. Remaining streets / weekly rate = weeks to go
4. title: "Portsmouth South ETA"
   body: "At your current rate: {weeks} weeks to 100% (target: {date})"
```

### 7.4 API Endpoints

```
GET /api/v1/insights
  Auth: required
  Response: {
    success: true,
    insights: [
      {
        type: "pace_comparison",
        title: "New vs Familiar",
        body: "You run 12s/km slower on new streets...",
        generatedAt: "2026-02-02T..."
      }
    ]
  }
```

### 7.5 Frontend

**`InsightsPage`** — card-based layout:

```
📊 Insights
━━━━━━━━━━━━━━

🏃 New vs Familiar
You run 12s/km slower on new streets.
Exploring costs speed but builds coverage.

📅 Your Best Day
Saturdays are your exploration day — 65% of
new streets discovered on Saturdays.

📈 Portsmouth South ETA
At your current rate: 14 weeks to 100%.
Target date: May 16, 2026.
```

### 7.6 Testing Checklist

- [ ] Metrics extracted correctly from Strava API
- [ ] Insights generate with sufficient data (minimum 3 activities)
- [ ] Graceful empty state when insufficient data
- [ ] Project ETA handles 0 weekly progress (shows "not enough data")
- [ ] Insights regenerate weekly without duplicates

---

## Feature 8: Street Discovery Feed

### Why #8

This serves the core product principle: "streets and names matter." After a run, users want to see the specific streets they discovered — not just a number. "You discovered Albert Road, Queen Street, and Elm Grove" is more meaningful than "3 new streets." It reinforces the local, place-based identity of Street Keeper.

**Why this position:** Very low effort (formatted list of data already computed in Feature 2). It's a UI presentation layer over existing run summaries. Lower priority than features that create new behaviors — this enhances an existing one.

### 8.1 No New Tables Required

Query `ActivitySummary.summaryJson.newStreetNames` grouped by activity date.

### 8.2 API Endpoint

```
GET /api/v1/discoveries?limit=20&offset=0
  Auth: required
  Response: {
    success: true,
    discoveries: [
      {
        date: "2026-02-07",
        activityName: "Morning Run",
        activityId: "...",
        streets: [
          { name: "Albert Road", lengthMeters: 340 },
          { name: "Queen Street", lengthMeters: 210 }
        ]
      }
    ],
    totalNewStreets: 312
  }
```

### 8.3 Frontend

**`DiscoveryFeed` component:**

```
🗺️ Your Discoveries
━━━━━━━━━━━━━━━━━━━━

📅 Today — Morning Run
  • Albert Road (340m)
  • Queen Street (210m)
  • Elm Grove (180m)

📅 Feb 5 — Evening Jog
  • Victoria Road (280m)
  • Park Lane (150m)

312 streets discovered all-time
```

Tapping a street name could scroll/zoom the map to that street.

### 8.4 Testing Checklist

- [ ] Feed shows correct streets per activity
- [ ] Pagination works
- [ ] Handles empty state for new users
- [ ] Street names are correct and deduped

---

## Feature 9: Leaderboards (Project-Scoped)

### Why #9

Social competition drives consistency. Knowing someone else is catching up to your street count in Portsmouth makes you run harder. But leaderboards need careful design. Global leaderboards are demotivating — someone in London with 10,000 streets makes your 200 feel worthless. Project-scoped leaderboards are fair, local competitions.

**Why this position:** Medium effort and needs multiple users in the same project area to be meaningful. A leaderboard of one is pointless. Build this when you have enough users to form meaningful competition pools. Every feature above works for a single user; this one requires community.

### 9.1 Leaderboard Types

| Type                    | Scope                    | Metric                           |
| ----------------------- | ------------------------ | -------------------------------- |
| **Project leaderboard** | Same project area        | Completion % or street count     |
| **Monthly sprint**      | Same project, this month | New streets added this month     |
| **Friends**             | Connected friends        | Total lifetime streets           |
| **Percentile**          | All users (anonymous)    | "More streets than 73% of users" |

### 9.2 Database Changes

```prisma
model ProjectMembership {
  id        String   @id @default(uuid())
  projectId String
  userId    String
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  isPublic  Boolean  @default(true) // Visible on leaderboard?
  joinedAt  DateTime @default(now())

  @@unique([projectId, userId])
  @@index([projectId])
  @@index([userId])
}

model UserFriendship {
  id        String   @id @default(uuid())
  userId    String
  friendId  String
  user      User     @relation("friendships", fields: [userId], references: [id])
  friend    User     @relation("friendOf", fields: [friendId], references: [id])
  createdAt DateTime @default(now())

  @@unique([userId, friendId])
  @@index([userId])
  @@index([friendId])
}
```

### 9.3 API Endpoints

```
GET /api/v1/projects/:id/leaderboard?period=this_month
  Auth: required
  Response: {
    leaderboard: [
      { rank: 1, displayName: "Sarah M.", streetsCompleted: 47, isCurrentUser: false },
      { rank: 2, displayName: "You", streetsCompleted: 31, isCurrentUser: true }
    ],
    totalParticipants: 12
  }

GET /api/v1/leaderboard/percentile
  Auth: required
  Response: {
    totalLifetimeStreets: 312,
    percentile: 73,
    message: "You've explored more streets than 73% of Street Keeper users"
  }
```

### 9.4 Privacy

- Users must opt-in to appear on leaderboards (`isPublic` flag)
- Display names only, no full names or profile links
- Can leave/hide from project leaderboards at any time

### 9.5 Testing Checklist

- [ ] Rankings correct by chosen metric and period
- [ ] Users with isPublic=false are hidden
- [ ] Current user always shown even if not in top N
- [ ] Percentile calculation is accurate
- [ ] Empty leaderboard state handled gracefully

---

## Feature 10: "This Day Last Year"

### Why #10

Nostalgia plus progress comparison is a surprisingly effective engagement trigger. Seeing "A year ago, you had run 45 streets. Now: 312" creates a concrete sense of progress that numbers alone don't convey. Costs almost nothing to build.

**Why this position:** Trivially low effort but only works for users who've been around for a year. Early on, most users won't trigger it. Becomes more valuable as user base matures. Also, it's a "nice-to-have" engagement boost, not a core behavior driver.

### 10.1 No New Tables Required

Query `ActivitySummary` where month/day matches today from previous years.

### 10.2 API Endpoint

```
GET /api/v1/memories
  Auth: required
  Response: {
    memories: [
      {
        year: 2025,
        date: "2025-02-07",
        streetsDiscovered: 5,
        streetNames: ["Park Road", "Mill Lane", ...],
        totalStreetsAtThatPoint: 45,
        totalStreetsNow: 312
      }
    ]
  }
```

### 10.3 Frontend

**`MemoryCard`** on home page (only shown when data exists):

```
📅 This Day Last Year
On Feb 7, 2025 you discovered 5 streets:
Park Road, Mill Lane, and 3 others.

You had 45 streets then. Now: 312. 🚀
```

### 10.4 Testing Checklist

- [ ] Returns empty when no data for this date in previous years
- [ ] Correctly matches month/day across years
- [ ] Handles Feb 29 gracefully (no match on non-leap years)
- [ ] Progress comparison accurate

---

## Feature 11: Street Tags (Community)

### Why #11

Crowdsourced local knowledge creates community value beyond running. When users tag streets as "scenic," "hilly," or "well-lit," they contribute knowledge that helps others plan better runs. This creates a network effect: more users = more tags = more value for everyone.

**Why this position:** Medium effort and value is proportional to user count. With 10 users, tags are sparse. With 1000 users in a city, they're invaluable. Build when you have enough users to create critical mass.

### 11.1 Tag Categories

| Category    | Tags                                      | Purpose              |
| ----------- | ----------------------------------------- | -------------------- |
| **Surface** | Pavement, Trail, Gravel, Mixed            | Route planning       |
| **Terrain** | Flat, Hilly, Steep, Steps                 | Difficulty           |
| **Vibe**    | Scenic, Residential, Industrial, Busy     | Preference           |
| **Safety**  | Well-lit, Poorly-lit, Quiet, Busy traffic | Time-of-day planning |

### 11.2 Database Changes

```prisma
model StreetTag {
  id        String   @id @default(uuid())
  osmWayId  String
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tag       String   // "scenic", "hilly", "well_lit"
  category  String   // "surface", "terrain", "vibe", "safety"
  createdAt DateTime @default(now())

  @@unique([osmWayId, userId, tag])
  @@index([osmWayId])
  @@index([userId])
}
```

### 11.3 API Endpoints

```
GET /api/v1/streets/:osmWayId/tags
  Response: { tags: [{ tag: "scenic", count: 7 }, { tag: "hilly", count: 3 }] }

POST /api/v1/streets/:osmWayId/tags
  Auth: required
  Body: { tags: ["scenic", "hilly"] }

DELETE /api/v1/streets/:osmWayId/tags/:tag
  Auth: required
```

### 11.4 Frontend

On street click (any map view), show tags with counts and add button:

```
Albert Road
━━━━━━━━━━━
🏞️ Scenic (7)  ⛰️ Hilly (3)  💡 Well-lit (5)
[+ Add Tag]
```

### 11.5 Testing Checklist

- [ ] Users can add tags to streets they've run
- [ ] Duplicate tag from same user prevented
- [ ] Counts aggregate correctly
- [ ] Users can remove their own tags

---

## Feature 12: Time-Bound Challenges

### Why #12

Challenges create structured urgency. "Run 100 new streets this month" drives a burst of activity that streaks alone don't. Streaks are about consistency; challenges are about intensity during a defined period.

**Why this position:** Medium-high effort and needs careful design to avoid burnout. If every week has a mandatory challenge, users feel pressured. Best launched monthly with opt-in. Also benefits significantly from having leaderboards (Feature 9) already built.

### 12.1 Database Changes

```prisma
model Challenge {
  id           String   @id @default(uuid())
  name         String
  description  String
  type         String   // "street_count", "distance", "project_sprint"
  target       Int
  targetUnit   String   // "streets", "km", "percent"
  startDate    DateTime
  endDate      DateTime
  projectId    String?  // Null = global
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())

  participants ChallengeParticipant[]
  @@index([isActive])
}

model ChallengeParticipant {
  id          String    @id @default(uuid())
  challengeId String
  challenge   Challenge @relation(fields: [challengeId], references: [id], onDelete: Cascade)
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  progress    Float     @default(0)
  completedAt DateTime?
  joinedAt    DateTime  @default(now())

  @@unique([challengeId, userId])
  @@index([challengeId])
  @@index([userId])
}
```

### 12.2 Backend

```typescript
export async function listActiveChallenges(): Promise<Challenge[]>;
export async function joinChallenge(
  userId: string,
  challengeId: string,
): Promise<void>;
export async function updateChallengeProgress(
  userId: string,
  activityResult: { newStreets: number; distanceKm: number },
): Promise<void>;
export async function getChallengeLeaderboard(
  challengeId: string,
): Promise<LeaderboardEntry[]>;
```

### 12.3 API Endpoints

```
GET    /api/v1/challenges
GET    /api/v1/challenges/:id
POST   /api/v1/challenges/:id/join
GET    /api/v1/challenges/:id/leaderboard
```

### 12.4 Testing Checklist

- [ ] Progress updates on each qualifying activity
- [ ] Completion detected when target reached
- [ ] Challenges expire at endDate
- [ ] Leaderboard ranks correctly
- [ ] Can only join active challenges

---

## Feature 13: Team Projects & Social

### Why #13 (Last)

Teams transform retention curves through social accountability and shared goals. "Run all of Portsmouth together" creates commitment beyond what any solo feature achieves. But it requires critical mass — a team of one is pointless — and it's the highest-effort feature.

**Why last:** Every feature above works for a single user and builds the foundation. Teams amplify features 1-12 (team streaks, team challenges, team leaderboards, shared discoveries). Build teams when you have enough users to form them, and when the solo experience is polished enough that adding a friend doesn't expose rough edges.

### 13.1 Database Changes

```prisma
model Team {
  id          String   @id @default(uuid())
  name        String
  description String?
  inviteCode  String   @unique @default(uuid())
  createdBy   String
  creator     User     @relation("teamsCreated", fields: [createdBy], references: [id])
  createdAt   DateTime @default(now())

  members  TeamMember[]
  projects TeamProject[]
}

model TeamMember {
  id       String   @id @default(uuid())
  teamId   String
  team     Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  userId   String
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  role     String   @default("member") // "admin" | "member"
  joinedAt DateTime @default(now())

  @@unique([teamId, userId])
  @@index([teamId])
  @@index([userId])
}

model TeamProject {
  id        String   @id @default(uuid())
  teamId    String
  team      Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  projectId String
  project   Project  @relation(fields: [projectId], references: [id])
  createdAt DateTime @default(now())

  @@unique([teamId, projectId])
  @@index([teamId])
}
```

### 13.2 Key Implementation Notes

- **Team progress:** Union of all members' UserEdge rows. `SELECT DISTINCT edgeId FROM UserEdge WHERE userId IN (...teamMembers) AND wayId IN (...projectWays)`
- **Invite flow:** Creator gets invite code/link. Others join via code. No friend requests.
- **Team feed:** Query ActivitySummary for all members, sorted by date.

### 13.3 API Endpoints

```
POST   /api/v1/teams
GET    /api/v1/teams
GET    /api/v1/teams/:id
POST   /api/v1/teams/join/:inviteCode
POST   /api/v1/teams/:id/projects
GET    /api/v1/teams/:id/feed
GET    /api/v1/teams/:id/leaderboard
DELETE /api/v1/teams/:id/members/:userId
```

### 13.4 Testing Checklist

- [ ] Team creation and invite flow works
- [ ] Team progress = union of members (no double-counting shared edges)
- [ ] Within-team leaderboard ranks correctly
- [ ] Team feed shows all members' activities
- [ ] Member removal updates team progress
- [ ] Invite codes unique and not guessable

---

## Implementation Dependencies

Features build on each other:

```
Feature 1  (Streaks)         → standalone, build first
Feature 2  (Summary)         → benefits from 1 (streak data in summary)
Feature 3  (Milestones)      → benefits from 1 (streak milestones)
Feature 4  (Suggestions)     → requires Projects feature complete
Feature 5  (Email Digest)    → benefits from 1, 2, 4
Feature 6  (Heatmap)         → standalone (reads existing edge data)
Feature 7  (AI Insights)     → requires 1, 2 (metrics, summaries)
Feature 8  (Discovery Feed)  → requires 2 (summaries with street names)
Feature 9  (Leaderboards)    → requires Projects + multiple users
Feature 10 (This Day)        → requires 2 (historical summaries)
Feature 11 (Street Tags)     → standalone but needs user base
Feature 12 (Challenges)      → benefits from 1, 3, 9
Feature 13 (Teams)           → requires 9, 12 + user base
```

**Recommended build phases for a solo developer:**

```
Phase A (Core Loop):       1 → 2 → 3           (2-3 weeks)
Phase B (Planning):        4 → 5               (1-2 weeks)
Phase C (Visualization):   6 → 8               (1-2 weeks)
Phase D (Intelligence):    7                    (1-2 weeks)
Phase E (Social):          9 → 10 → 11         (2-3 weeks)
Phase F (Competition):     12 → 13             (3-4 weeks)
```

**Total estimate with AI assistance: 10-16 weeks for all features.**

---

## Quick Reference: All New Database Tables

| Table                  | Feature | Purpose                                  |
| ---------------------- | ------- | ---------------------------------------- |
| `UserStreak`           | 1       | Consecutive active weeks per streak type |
| `ActivitySummary`      | 2       | Generated run summary JSON per activity  |
| `UserMilestone`        | 3       | Which milestones a user has earned       |
| `UserPreferences`      | 5       | Email digest settings, timezone, opt-ins |
| `ActivityMetrics`      | 7       | Extended Strava metrics per activity     |
| `UserInsight`          | 7       | Generated AI insights per user per week  |
| `StreetTag`            | 11      | User-contributed tags on streets         |
| `Challenge`            | 12      | Challenge definitions                    |
| `ChallengeParticipant` | 12      | User enrollment + progress               |
| `ProjectMembership`    | 9       | Users in shared projects                 |
| `UserFriendship`       | 9       | Friend connections                       |
| `Team`                 | 13      | Team metadata                            |
| `TeamMember`           | 13      | Team membership                          |
| `TeamProject`          | 13      | Projects assigned to teams               |

---

## Quick Reference: All New API Endpoints

| Method | Path                                    | Feature | Purpose                    |
| ------ | --------------------------------------- | ------- | -------------------------- |
| GET    | `/api/v1/streaks`                       | 1       | User's streak data         |
| GET    | `/api/v1/activities/:id/summary`        | 2       | Run summary                |
| GET    | `/api/v1/activities/:id/share-card`     | 2       | Share PNG                  |
| POST   | `/api/v1/activities/:id/push-to-strava` | 2       | Push to Strava             |
| GET    | `/api/v1/milestones`                    | 3       | Earned/unearned milestones |
| POST   | `/api/v1/milestones/acknowledge`        | 3       | Mark as seen               |
| GET    | `/api/v1/suggestions`                   | 4       | Run suggestions            |
| GET    | `/api/v1/projects/:id/suggestions`      | 4       | Project-scoped suggestions |
| GET    | `/api/v1/preferences`                   | 5       | User preferences           |
| PATCH  | `/api/v1/preferences`                   | 5       | Update preferences         |
| GET    | `/api/v1/heatmap`                       | 6       | Heatmap data for viewport  |
| GET    | `/api/v1/insights`                      | 7       | AI insights                |
| GET    | `/api/v1/discoveries`                   | 8       | Discovery feed             |
| GET    | `/api/v1/projects/:id/leaderboard`      | 9       | Project leaderboard        |
| GET    | `/api/v1/leaderboard/percentile`        | 9       | Global percentile          |
| GET    | `/api/v1/memories`                      | 10      | This day last year         |
| GET    | `/api/v1/streets/:id/tags`              | 11      | Street tags                |
| POST   | `/api/v1/streets/:id/tags`              | 11      | Add tags                   |
| DELETE | `/api/v1/streets/:id/tags/:tag`         | 11      | Remove tag                 |
| GET    | `/api/v1/challenges`                    | 12      | Active challenges          |
| GET    | `/api/v1/challenges/:id`                | 12      | Challenge detail           |
| POST   | `/api/v1/challenges/:id/join`           | 12      | Join challenge             |
| GET    | `/api/v1/challenges/:id/leaderboard`    | 12      | Challenge rankings         |
| POST   | `/api/v1/teams`                         | 13      | Create team                |
| GET    | `/api/v1/teams`                         | 13      | List teams                 |
| GET    | `/api/v1/teams/:id`                     | 13      | Team detail                |
| POST   | `/api/v1/teams/join/:code`              | 13      | Join via invite            |
| POST   | `/api/v1/teams/:id/projects`            | 13      | Add project to team        |
| GET    | `/api/v1/teams/:id/feed`                | 13      | Team activity feed         |
| GET    | `/api/v1/teams/:id/leaderboard`         | 13      | Team rankings              |
