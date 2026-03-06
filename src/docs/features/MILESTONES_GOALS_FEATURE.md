# Milestones & Goals System — Complete Feature Documentation

> **Purpose:** This document captures the FULL vision for Street Keeper's milestone and goal-setting system. It includes both MVP features and future enhancements, with research citations and behavioral psychology rationale. Use this as a reference for future development phases.

---

## Table of Contents

1. [Vision & Core Principles](#vision--core-principles)
2. [Behavioral Psychology Research](#behavioral-psychology-research)
3. [Phase 1 MVP (Launch)](#phase-1-mvp-launch)
4. [Phase 2 Smart Suggestions](#phase-2-smart-suggestions)
5. [Phase 3 Custom Goal Wizard](#phase-3-custom-goal-wizard)
6. [Phase 4 Timing Variants](#phase-4-timing-variants)
7. [Phase 5 Message Engine](#phase-5-message-engine)
8. [Phase 6 Social Sharing](#phase-6-social-sharing)
9. [Deferred Features](#deferred-features)
10. [Research Citations](#research-citations)

---

## Vision & Core Principles

### The Problem We're Solving

Traditional running apps track distance and pace. CityStrides tracks streets. But neither helps users **set meaningful goals** or **celebrate achievements** in a way that drives long-term engagement.

Street Keeper's milestone system turns street exploration into a **gamified progression system** where:
- Progress is visible and tangible
- Goals are personalized and achievable
- Celebrations create dopamine hits that reinforce the habit
- Sharing creates social accountability and organic growth

### Core Principles

| Principle | Description | Implementation |
|-----------|-------------|----------------|
| **Small Wins First** | Early achievable milestones build momentum | Auto-generate "First 5 streets" for new projects |
| **Autonomy + Guidance** | Users can customize but shouldn't need to | Smart suggestions are the default path |
| **Celebration = Retention** | Every achievement must feel special | Confetti, share messages, trophy case |
| **Simplicity Wins** | Complex features hidden until needed | Progressive disclosure throughout |
| **Mobile-First** | Most users are on phones | Bottom sheets, thumb-zone actions |

---

## Behavioral Psychology Research

Every design decision in this system is backed by research. This section documents the techniques used and their sources.

### 1. Goal Gradient Effect

**Source:** Kivetz, Ran, Oleg Urminsky, and Yuhuang Zheng. "The Goal-Gradient Hypothesis Resurrected." Journal of Marketing Research 43.1 (2006): 39-58.

**Principle:** People accelerate toward a goal as they get closer. A coffee shop loyalty card pre-stamped with 2/10 stamps has higher completion rates than a blank 8-stamp card.

**How We Use It:**
- Progress bars on all milestone cards
- "X more to go" messaging
- Auto-create milestones at "nice" percentages (25%, 50%, 75%, 100%)
- Endowed progress: "You've already completed 8 streets! Only 2 more to reach 10."

### 2. Default Effect / Nudge Theory

**Source:** Thaler, Richard H., and Cass R. Sunstein. Nudge: Improving Decisions About Health, Wealth, and Happiness. Yale University Press, 2008.

**Principle:** 90% of people accept defaults. Good defaults guide behavior without restricting choice.

**How We Use It:**
- Default timing: One-time (most common)
- Default metric: Streets completed
- Default targets: Auto-calculated based on project size
- Smart suggestions shown first (not blank form)

### 3. Small Wins / Progress Principle

**Source:** Amabile, Teresa, and Steven Kramer. "The Power of Small Wins." Harvard Business Review 89.5 (2011): 70-80.

**Principle:** Small, incremental progress is more motivating than waiting for big achievements. Daily small wins maintain momentum.

**How We Use It:**
- Auto-generate achievable early milestones (3, 5, 10 streets)
- Never start a new project with 0 milestones
- Celebrate partial progress ("80% complete!")
- Tips like "5 streets ≈ one 30-minute run"

### 4. Variable Reward Schedules

**Source:** Eyal, Nir. Hooked: How to Build Habit-Forming Products. Portfolio/Penguin, 2014.

**Principle:** Unpredictable rewards are more engaging than predictable ones (slot machine effect). Variety maintains interest.

**How We Use It:**
- 100+ message templates for share messages
- Random selection from category-appropriate pools
- Different celebration animations for different milestone types
- Surprise milestones (night runner, early bird)

### 5. Self-Determination Theory (Autonomy)

**Source:** Deci, Edward L., and Richard M. Ryan. "The 'What' and 'Why' of Goal Pursuits: Human Needs and the Self-Determination of Behavior." Psychological Inquiry 11.4 (2000): 227-268.

**Principle:** Intrinsic motivation requires autonomy, competence, and relatedness. People engage more when they feel in control.

**How We Use It:**
- Full custom wizard available (but optional)
- Users can edit/delete any goal
- No forced participation in any feature
- Goal types match user's running style

### 6. Loss Aversion

**Source:** Kahneman, Daniel, and Amos Tversky. "Prospect Theory: An Analysis of Decision under Risk." Econometrica 47.2 (1979): 263-291.

**Principle:** Losses feel ~2x more painful than equivalent gains feel good. People work harder to avoid losing than to gain.

**How We Use It:**
- Streak protection: "Don't lose your 4-week streak!"
- Period tracking for recurring goals: "3 days left in this period"
- Deadline urgency: "7 days remaining"
- Best streak display (creates something to protect)

### 7. Identity-Based Habits

**Source:** Clear, James. Atomic Habits: An Easy & Proven Way to Build Good Habits & Break Bad Ones. Avery, 2018.

**Principle:** Behavior change is most effective when tied to identity ("I am a runner") rather than outcomes ("I want to run").

**How We Use It:**
- Share messages like "Becoming a [project] local"
- Milestone names that reinforce identity: "Urban Explorer," "Street Legend"
- Trophy case creates "explorer" identity visual
- Progress framing: "You're 73% of the way to knowing Downtown"

### 8. Implementation Intentions

**Source:** Gollwitzer, Peter M. "Implementation Intentions: Strong Effects of Simple Plans." American Psychologist 54.7 (1999): 493-503.

**Principle:** Goals with specific when/where/how plans are 2-3x more likely to be achieved than vague intentions.

**How We Use It:**
- Recurring goals: "5 streets every 2 weeks" (specific)
- Deadline goals: "25 streets by March 15" (specific)
- Streak goals: "Run 3 times per week for 4 weeks" (specific)
- Context: "Your project: 47 streets, 8 done" (anchoring)

### 9. Endowed Progress Effect

**Source:** Nunes, Joseph C., and Xavier Drèze. "The Endowed Progress Effect: How Artificial Advancement Increases Effort." Journal of Consumer Research 32.4 (2006): 504-512.

**Principle:** People who feel they've made progress are more motivated to continue than those starting from zero.

**How We Use It:**
- When creating new goals, show existing progress toward it
- "You've already completed 8 streets in this project!"
- Progress visualization starts partially filled
- Suggestions include current context ("Based on your 47 streets in Downtown")

### 10. Cognitive Load Theory

**Source:** Sweller, John. "Cognitive Load During Problem Solving: Effects on Learning." Cognitive Science 12.2 (1988): 257-285.

**Principle:** Working memory is limited. Reducing cognitive load improves decision-making and task completion.

**How We Use It:**
- 2-step wizard max (not 4)
- Only 2 metric options visible initially (progressive disclosure)
- Quick-pick buttons instead of free-form input
- Timing options collapsed by default

### 11. Hick's Law

**Source:** Hick, W.E. "On the Rate of Gain of Information." Quarterly Journal of Experimental Psychology 4.1 (1952): 11-26.

**Principle:** Decision time increases logarithmically with the number of choices. Fewer options = faster decisions.

**How We Use It:**
- 6 milestone types (not 12)
- Only 2 visible by default, 4 expandable
- Smart suggestions show 3-4 options (not unlimited)
- Timing options grouped, not all shown at once

### 12. Fitts's Law

**Source:** Fitts, Paul M. "The Information Capacity of the Human Motor System in Controlling the Amplitude of Movement." Journal of Experimental Psychology 47.6 (1954): 381-391.

**Principle:** Time to reach a target depends on distance and size. Larger, closer targets are easier to hit.

**How We Use It:**
- Minimum 48px touch targets
- Action buttons in thumb zone (bottom of screen)
- Full-width CTA buttons
- Bottom sheet pattern for mobile

---

## Phase 1 MVP (Launch)

**Goal:** Ship a working milestone system that creates celebration moments and visible progress. Keep it simple.

### What's Included

| Component | Description | Effort |
|-----------|-------------|--------|
| **Auto-generated milestones** | Create 4-6 milestones when project is created | Low |
| **Basic milestone card** | Progress bar, count, percentage | Low |
| **Completion detection** | Check milestones after activity sync | Low |
| **Celebration modal** | Confetti + achievement name | Medium |
| **Milestones page** | List of active/completed goals | Low |

### What's NOT Included (Yet)

- Custom goal creation (users get auto-generated goals only)
- Smart suggestions
- Timing variants (recurring, deadline, streak)
- Message templates
- Trophy case
- Bottom sheet wizard

### Database Schema (MVP)

```prisma
model UserMilestone {
  id           String    @id @default(uuid())
  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  projectId    String
  project      Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  typeId       String
  type         MilestoneType @relation(fields: [typeId], references: [id])
  
  // Target & progress
  targetValue  Float
  currentValue Float     @default(0)
  
  // Status
  completedAt  DateTime?
  celebrationShownAt DateTime?  // null = pending celebration
  
  // Metadata
  name         String    // "Complete 10 streets"
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  
  @@unique([userId, projectId, typeId, targetValue])
  @@index([userId])
  @@index([projectId])
  @@index([userId, completedAt])
}

model MilestoneType {
  id          String   @id @default(uuid())
  slug        String   @unique
  name        String
  description String
  scope       String   @default("project") // "project" | "global"
  
  milestones  UserMilestone[]
}
```

### Milestone Types (MVP - 3 Types Only)

| Slug | Name | Description | Target Calculation |
|------|------|-------------|-------------------|
| `street_count` | Streets Completed | Complete N streets in project | Based on project size |
| `percentage` | Percentage Complete | Reach N% of project | 25%, 50%, 75%, 100% |
| `first_street` | First Street | Complete your first street | Always 1 |

### Auto-Generation Logic (MVP)

```typescript
function generateMilestonesForProject(
  totalStreets: number,
  completedStreets: number = 0
): MilestoneConfig[] {
  const milestones: MilestoneConfig[] = [];
  
  // Always: First street (if not done)
  if (completedStreets === 0) {
    milestones.push({ type: 'first_street', target: 1, name: 'First street!' });
  }
  
  // Street count milestones based on project size
  if (totalStreets <= 15) {
    // Tiny project: 3, halfway, complete
    milestones.push(
      { type: 'street_count', target: 3, name: 'Complete 3 streets' },
      { type: 'percentage', target: 50, name: 'Halfway there!' },
      { type: 'percentage', target: 100, name: 'Project complete!' }
    );
  } else if (totalStreets <= 50) {
    // Small project: 5, 10, 50%, 100%
    milestones.push(
      { type: 'street_count', target: 5, name: 'Complete 5 streets' },
      { type: 'street_count', target: 10, name: 'Complete 10 streets' },
      { type: 'percentage', target: 50, name: 'Halfway there!' },
      { type: 'percentage', target: 100, name: 'Project complete!' }
    );
  } else if (totalStreets <= 150) {
    // Medium project: 10, 25, 25%, 50%, 100%
    milestones.push(
      { type: 'street_count', target: 10, name: 'Complete 10 streets' },
      { type: 'street_count', target: 25, name: 'Complete 25 streets' },
      { type: 'percentage', target: 25, name: '25% complete!' },
      { type: 'percentage', target: 50, name: 'Halfway there!' },
      { type: 'percentage', target: 100, name: 'Project complete!' }
    );
  } else {
    // Large project: 10, 25, 50, 25%, 50%, 75%, 100%
    milestones.push(
      { type: 'street_count', target: 10, name: 'Complete 10 streets' },
      { type: 'street_count', target: 25, name: 'Complete 25 streets' },
      { type: 'street_count', target: 50, name: 'Complete 50 streets' },
      { type: 'percentage', target: 25, name: '25% complete!' },
      { type: 'percentage', target: 50, name: 'Halfway there!' },
      { type: 'percentage', target: 75, name: '75% complete!' },
      { type: 'percentage', target: 100, name: 'Project complete!' }
    );
  }
  
  // Filter out already-completed milestones
  return milestones.filter(m => {
    if (m.type === 'street_count') return m.target > completedStreets;
    if (m.type === 'percentage') return (m.target / 100) * totalStreets > completedStreets;
    if (m.type === 'first_street') return completedStreets === 0;
    return true;
  });
}
```

### API Endpoints (MVP)

```
GET /api/v1/projects/:id/milestones
  Response: {
    active: UserMilestone[],
    completed: UserMilestone[],
    pendingCelebrations: UserMilestone[]  // completedAt set, celebrationShownAt null
  }

POST /api/v1/milestones/:id/acknowledge
  Body: {}
  Response: { success: true }
  Effect: Sets celebrationShownAt to now()
```

### Frontend Components (MVP)

**MilestoneCard.tsx** (simple version)

```
[ ] Complete 10 streets
    ████████░░░░░░░  8/10 (80%)
    2 more to go
```

**CelebrationModal.tsx** (simple version)

```
┌─────────────────────────────────────┐
│                                     │
│            🎉 🎉 🎉                 │
│                                     │
│    GOAL ACHIEVED!                   │
│                                     │
│    Complete 10 streets              │
│    in Downtown                      │
│                                     │
│    ┌─────────────────────────┐     │
│    │     Keep Going!         │     │
│    └─────────────────────────┘     │
│                                     │
└─────────────────────────────────────┘
```

### Behavioral Patterns Applied (MVP)

- **Small Wins:** Auto-generated achievable early milestones
- **Goal Gradient:** Progress bars, "X more to go"
- **Celebration Effect:** Confetti modal on completion
- **Endowed Progress:** Show current progress toward each goal

---

## Phase 2 Smart Suggestions

**Goal:** Let users add goals beyond auto-generated ones via smart suggestions (one-tap creation).

### What's Added

| Component | Description | Why |
|-----------|-------------|-----|
| **Suggestions service** | Generate 3-4 personalized goal suggestions | BJ Fogg: Make desired behavior easy |
| **One-tap goal creation** | Tap [+] to instantly create | Amazon 1-Click: Reduce friction |
| **Suggestion cards UI** | Show suggestions in modal | Default Effect: Most users won't need wizard |

### Suggestion Algorithm

```typescript
interface GoalSuggestion {
  id: string;
  type: MilestoneTypeSlug;
  target: number;
  timing?: TimingConfig;
  title: string;
  description: string;
  rationale: string;  // Why this suggestion
}

async function generateSuggestions(
  project: Project,
  userStats: UserStats
): Promise<GoalSuggestion[]> {
  const suggestions: GoalSuggestion[] = [];
  const { totalStreets, completedStreets } = project;
  const remaining = totalStreets - completedStreets;
  
  // 1. Next achievable street count (always suggest)
  const nextTarget = suggestNextTarget(completedStreets, totalStreets);
  suggestions.push({
    id: 'next-streets',
    type: 'street_count',
    target: nextTarget,
    title: `Complete ${nextTarget} streets`,
    description: `${nextTarget - completedStreets} more to go`,
    rationale: 'Small Wins: Achievable next milestone'
  });
  
  // 2. Recurring goal (if user is active)
  if (userStats.activitiesPerWeek >= 1) {
    const weeklyPace = Math.ceil(remaining / 10);  // ~10 weeks to complete
    suggestions.push({
      id: 'recurring',
      type: 'street_count',
      target: Math.min(weeklyPace, 10),
      timing: { type: 'recurring', unit: 'weeks', interval: 2 },
      title: `${weeklyPace} streets every 2 weeks`,
      description: `Finish in ~${Math.ceil(remaining / weeklyPace * 2)} weeks`,
      rationale: 'Implementation Intentions: Specific when/how plan'
    });
  }
  
  // 3. Next percentage milestone
  const currentPercent = (completedStreets / totalStreets) * 100;
  const nextPercent = [25, 50, 75, 100].find(p => p > currentPercent);
  if (nextPercent) {
    const streetsNeeded = Math.ceil((nextPercent / 100) * totalStreets) - completedStreets;
    suggestions.push({
      id: 'next-percent',
      type: 'percentage',
      target: nextPercent,
      title: `Reach ${nextPercent}%`,
      description: `${streetsNeeded} streets away`,
      rationale: 'Goal Gradient: Percentage milestones drive acceleration'
    });
  }
  
  return suggestions.slice(0, 4);  // Max 4 suggestions (Hick's Law)
}
```

### UI Flow

```
┌─────────────────────────────────────────────────────┐
│  ADD A GOAL                                    [X]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  SUGGESTED FOR YOU                                  │
│  Based on Downtown (47 streets, 8 completed)        │
│                                                     │
│  ┌─────────────────────────────────────────────────┐│
│  │ ○ Complete 15 streets                      [+] ││
│  │   7 more to go                                 ││
│  └─────────────────────────────────────────────────┘│
│                                                     │
│  ┌─────────────────────────────────────────────────┐│
│  │ ○ 5 streets every 2 weeks                  [+] ││
│  │   Finish in ~8 weeks at this pace              ││
│  └─────────────────────────────────────────────────┘│
│                                                     │
│  ┌─────────────────────────────────────────────────┐│
│  │ ○ Reach 25%                                [+] ││
│  │   4 streets away                               ││
│  └─────────────────────────────────────────────────┘│
│                                                     │
│  ─────────────────────────────────────────────────  │
│  [ Build Your Own Goal -> ]                         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Interaction:**
- Tap [+] = Goal created instantly (no confirmation needed)
- Toast: "Goal added: Complete 15 streets" with 5-second undo
- "Build Your Own Goal" leads to Phase 3 wizard

### Behavioral Patterns Applied

- **Default Effect:** Suggestions are the primary path (80% of users)
- **Hick's Law:** Max 4 suggestions
- **Endowed Progress:** Context shows current progress
- **Implementation Intentions:** Recurring suggestion includes specific timing

---

## Phase 3 Custom Goal Wizard

**Goal:** Let power users create any goal type through a streamlined 2-step wizard.

### Wizard Flow (2 Steps Only)

**Step 1: What to Track**

```
┌─────────────────────────────────────────────────────┐
│ ════════════════════════════════════════════════    │
│  ● ○   CREATE YOUR GOAL                        [X] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  WHAT DO YOU WANT TO TRACK?                         │
│                                                     │
│  ┌─────────────────────────────────────────────────┐│
│  │ ● Streets completed                            ││
│  └─────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────┐│
│  │ ○ Distance run                                 ││
│  └─────────────────────────────────────────────────┘│
│                                                     │
│  [ More options v ]                                 │
│    ○ Activity count    ○ Visit days               │
│    ○ Single run best   ○ Build a streak           │
│                                                     │
├─────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐│
│  │              [ Next -> ]                       ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

**Step 2: Set Target + Optional Timing**

```
┌─────────────────────────────────────────────────────┐
│ ════════════════════════════════════════════════    │
│  ○ ●   SET YOUR TARGET                         [X] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  HOW MANY STREETS?                                  │
│                                                     │
│  ┌───┐ ┌───┐ ┌────┐ ┌────┐ ┌────┐ ┌──────┐        │
│  │ 3 │ │ 5 │ │ 10 │ │ 15 │ │ 25 │ │ ____ │        │
│  └───┘ └───┘ └────┘ └────┘ └────┘ └──────┘        │
│                                                     │
│  Your project: 47 streets, 8 done                   │
│  Tip: 5 streets ≈ one 30-minute run                 │
│                                                     │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  [ + Add timing (optional) v ]                      │
│                                                     │
│    ○ One-time (default)                            │
│    ○ Repeat every [2] weeks                        │
│    ○ Complete by [date picker]                     │
│                                                     │
├─────────────────────────────────────────────────────┤
│  [ <- Back ]              [ Create Goal ]           │
└─────────────────────────────────────────────────────┘
```

### Milestone Types (Full Set)

| Slug | Name | Description | Config | UI Visibility |
|------|------|-------------|--------|---------------|
| `street_count` | Streets Completed | Complete N streets in project | `{ target: number }` | Always visible |
| `distance_km` | Distance Run | Run N km in project | `{ target: number }` | Always visible |
| `activity_count` | Activity Count | Run N times in project | `{ target: number }` | Expandable |
| `visit_days` | Visit Days | Run on N different days | `{ target: number }` | Expandable |
| `single_run_streets` | Single Run Best | Complete N streets in one run | `{ target: number }` | Expandable |
| `streak` | Build a Streak | Run X times per Y for Z weeks | `{ frequency, target, duration }` | Separate option |

### Design Decisions

| Decision | Why | Research |
|----------|-----|----------|
| 2 steps max | Reduce abandonment, cognitive load | Miller's Law, Sweller (1988) |
| Only 2 options visible | Fewer choices = faster decisions | Hick's Law |
| Quick-pick chips | Faster than typing numbers | Fitts's Law |
| Context shown | Anchor expectations to reality | Endowed Progress |
| Timing collapsed | Most users want one-time goals | Default Effect |
| Tips shown | Guide without overwhelming | Progressive Disclosure |

### Behavioral Patterns Applied

- **Cognitive Load:** 2 steps, not 4
- **Hick's Law:** 2 visible, 4 hidden
- **Default Effect:** One-time timing is default (collapsed)
- **Fitts's Law:** 48px touch targets, thumb zone actions
- **Endowed Progress:** "47 streets, 8 done" context

---

## Phase 4 Timing Variants

**Goal:** Add recurring, deadline, and streak timing options to goals.

### Schema Extensions

```prisma
model UserMilestone {
  // ... existing fields ...
  
  // Timing configuration
  timingType          String    @default("one_time") // "one_time" | "recurring" | "deadline" | "streak"
  
  // For recurring
  recurrenceUnit      String?   // "days" | "weeks" | "months"
  recurrenceInterval  Int?      // e.g., 2 for "every 2 weeks"
  
  // For deadline
  deadline            DateTime?
  
  // For streak
  streakFrequency     String?   // "daily" | "weekly"
  streakTarget        Int?      // e.g., 3 for "3 times per week"
  streakDuration      Int?      // e.g., 4 for "for 4 weeks"
  
  // Period tracking
  currentPeriodStart  DateTime?
  currentPeriodEnd    DateTime?
  currentPeriodValue  Float     @default(0)
  periodsCompleted    Int       @default(0)
  
  // Streak tracking
  streakCurrent       Int       @default(0)
  streakBest          Int       @default(0)
  
  // Period history
  periodHistory       MilestonePeriod[]
}

model MilestonePeriod {
  id            String    @id @default(uuid())
  milestoneId   String
  milestone     UserMilestone @relation(fields: [milestoneId], references: [id], onDelete: Cascade)
  periodStart   DateTime
  periodEnd     DateTime
  targetValue   Float
  actualValue   Float
  completed     Boolean
  createdAt     DateTime  @default(now())
  
  @@index([milestoneId])
}
```

### Timing Types Explained

| Type | Description | Use Case | Behavioral Basis |
|------|-------------|----------|------------------|
| **One-time** | Reach target once, done forever | "Complete 25 streets" | Goal Gradient |
| **Recurring** | Reset target every N days/weeks/months | "5 streets every 2 weeks" | Implementation Intentions |
| **Deadline** | Reach target by specific date | "25 streets by March 15" | Loss Aversion (deadline pressure) |
| **Streak** | Run X times per period for Y periods | "Run 3x weekly for 4 weeks" | Loss Aversion (streak protection) |

### Card Variants

**One-time:**
```
[ ] Complete 25 streets
    ████████░░░░░░░  18/25 (72%)
    7 more to go
```

**Recurring:**
```
[R] 5 streets every 2 weeks
    ████████████░░░  4/5 this period
    
    Period: Feb 12 - Feb 25
    History: 3 completed, 1 missed
```

**Deadline:**
```
[D] 25 streets by Mar 15
    ████████░░░░░░░  18/25 (72%)
    
    31 days remaining
    7 more streets needed
```

**Streak:**
```
[S] Run 3x weekly for 4 weeks

    Current streak: 2 weeks ✓
    Best streak: 3 weeks
    
    [✓] Week 1  [✓] Week 2  [ ] Week 3  [ ] Week 4
```

### Behavioral Patterns Applied

- **Implementation Intentions:** Recurring goals have specific when/how
- **Loss Aversion:** Streak protection ("Don't lose your streak!")
- **Deadline Effect:** Deadline goals create urgency
- **Goal Gradient:** Period tracking shows progress within period

---

## Phase 5 Message Engine

**Goal:** Generate shareable messages for completed milestones (future Strava sharing).

### Template Categories

| Category | Count | Example | When Used |
|----------|-------|---------|-----------|
| Celebratory | 15 | "Just hit {achievement}! 🎉" | Default for completions |
| Casual | 15 | "{achievement}. Cool." | Randomized variety |
| Proud | 12 | "Worked hard for this: {achievement}" | Higher-value milestones |
| With Stats | 12 | "{achievement}! {remaining}" | When near next goal |
| Motivational | 12 | "{achievement}! What's next?" | Encouraging tone |
| Playful | 15 | "My legs hate me but my map loves me" | Fun variety |
| Identity | 15 | "Becoming a {project} local" | Identity reinforcement |
| First Milestone | 10 | "First street done! Many more to go." | First completions |
| Completion | 15 | "100% of {project}! EVERY. SINGLE. STREET." | Project completions |
| Distance | 8 | "{count}K in {project}!" | Distance milestones |
| Half/Marathon | 12 | "Half marathon distance in my neighborhood!" | 21.1km, 42.2km |
| Consistency | 8 | "{count} days running. Building the habit." | Streak completions |
| Near Completion | 8 | "Just {remaining} from {achievement}!" | 90%+ progress |

### Placeholder System

| Placeholder | Example Value | Description |
|-------------|---------------|-------------|
| `{achievement}` | "25 streets in Downtown" | Full achievement description |
| `{project}` | "Downtown" | Project name |
| `{count}` | "25" | Number value |
| `{remaining}` | "3 more to go" | Distance to next goal |
| `{percent}` | "73%" | Percentage value |
| `{stats}` | "12.5km of streets" | Cumulative stats |
| `{streak}` | "4-week" | Streak length |

### Message Builder

```typescript
interface ShareContext {
  milestone: UserMilestone;
  project: Project;
  nextMilestone?: UserMilestone;
  stats: {
    totalStreets: number;
    distanceKm: number;
    currentStreak: number;
  };
}

function buildShareMessage(ctx: ShareContext): string {
  // 1. Select template pool based on milestone type
  const pool = selectTemplatePool(ctx.milestone);
  
  // 2. Pick random template from pool
  const template = pool[Math.floor(Math.random() * pool.length)];
  
  // 3. Fill placeholders
  let message = template;
  message = message.replace('{achievement}', formatAchievement(ctx.milestone));
  message = message.replace('{project}', ctx.project.name);
  message = message.replace('{count}', String(ctx.milestone.targetValue));
  if (ctx.nextMilestone) {
    const remaining = ctx.nextMilestone.targetValue - ctx.milestone.currentValue;
    message = message.replace('{remaining}', `${remaining} more to go`);
  }
  
  // 4. Add attribution
  message += '\n— via Street Keeper';
  
  return message;
}
```

### Behavioral Patterns Applied

- **Variable Rewards:** Random template selection creates novelty
- **Identity Reinforcement:** "Becoming a local" messages
- **Social Commitment:** Shareable messages create accountability

---

## Phase 6 Social Sharing

**Goal:** Enable sharing to Strava and other platforms.

### Strava Integration

**Required Scope:** `activity:write` (in addition to current scopes)

**Flow:**
1. User completes milestone
2. Celebration modal shows share message preview
3. User taps "Share to Strava"
4. Backend appends message to recent Strava activity description
5. Success confirmation

**Implementation:**
```typescript
async function shareToStrava(
  userId: string,
  milestoneId: string,
  activityId: string
): Promise<{ success: boolean }> {
  const milestone = await getMilestone(milestoneId);
  const message = milestone.shareMessage;
  
  // Get existing Strava activity description
  const activity = await stravaApi.getActivity(userId, activityId);
  const newDescription = activity.description 
    ? `${activity.description}\n\n${message}`
    : message;
  
  // Update Strava activity
  await stravaApi.updateActivity(userId, activityId, {
    description: newDescription
  });
  
  return { success: true };
}
```

### Deferred: Direct Strava Posting

For MVP, we generate messages but don't post directly. Future enhancement:
- Post milestone to Strava as activity comment
- Create Strava post (requires different scope)
- Auto-post setting (opt-in)

---

## Deferred Features

These features are documented for future reference but not planned for near-term implementation.

### 1. Street Type Goals

**What:** Complete N streets of a specific type (footpath, residential, etc.)

**Why Deferred:**
- Requires type picker UI (complexity)
- OSM highway types are confusing to users
- Low demand expected

**If Implemented:**
```typescript
{
  type: 'street_type',
  config: {
    highwayType: 'footway',
    targetCount: 12
  }
}
```

### 2. Named Streets Goals

**What:** Complete streets matching a pattern (e.g., all "Park" streets)

**Why Deferred:**
- Edge cases (partial matches, different languages)
- Limited use case
- Confusing UX

### 3. Global Goals

**What:** Goals that span all projects (total lifetime streets, total distance)

**Why Deferred:**
- Focus on project-level first
- Global stats exist elsewhere
- Avoid overwhelming with too many goals

**If Implemented:**
```prisma
model UserMilestone {
  // ...
  projectId  String?  // null = global scope
}
```

### 4. Landmark/POI Goals

**What:** Complete streets near specific landmarks

**Why Deferred:**
- Requires OSM POI extraction
- Complex geospatial queries
- Not core to running experience

### 5. People/Social Goals

**What:** Run with friends, team challenges

**Why Deferred:**
- Requires social graph (Feature 13 in main roadmap)
- Needs critical user mass
- High complexity

### 6. Heart Rate / Performance Goals

**What:** Goals based on average heart rate, pace

**Why Deferred:**
- Requires Strava Detailed Activity data
- Not all users have HR monitors
- Outside core street-exploration focus

### 7. Time-of-Day Goals

**What:** Complete streets at specific times (night runner, early bird)

**Already Partially Implemented:** As surprise milestones in existing system (Feature 3)

---

## Research Citations

### Primary Sources

1. **Kivetz, R., Urminsky, O., & Zheng, Y.** (2006). "The Goal-Gradient Hypothesis Resurrected: Purchase Acceleration, Illusionary Goal Progress, and Customer Retention." *Journal of Marketing Research*, 43(1), 39-58.

2. **Thaler, R. H., & Sunstein, C. R.** (2008). *Nudge: Improving Decisions About Health, Wealth, and Happiness*. Yale University Press.

3. **Amabile, T. M., & Kramer, S. J.** (2011). "The Power of Small Wins." *Harvard Business Review*, 89(5), 70-80.

4. **Eyal, N.** (2014). *Hooked: How to Build Habit-Forming Products*. Portfolio/Penguin.

5. **Deci, E. L., & Ryan, R. M.** (2000). "The 'What' and 'Why' of Goal Pursuits: Human Needs and the Self-Determination of Behavior." *Psychological Inquiry*, 11(4), 227-268.

6. **Kahneman, D., & Tversky, A.** (1979). "Prospect Theory: An Analysis of Decision under Risk." *Econometrica*, 47(2), 263-291.

7. **Clear, J.** (2018). *Atomic Habits: An Easy & Proven Way to Build Good Habits & Break Bad Ones*. Avery.

8. **Gollwitzer, P. M.** (1999). "Implementation Intentions: Strong Effects of Simple Plans." *American Psychologist*, 54(7), 493-503.

9. **Nunes, J. C., & Drèze, X.** (2006). "The Endowed Progress Effect: How Artificial Advancement Increases Effort." *Journal of Consumer Research*, 32(4), 504-512.

10. **Sweller, J.** (1988). "Cognitive Load During Problem Solving: Effects on Learning." *Cognitive Science*, 12(2), 257-285.

11. **Hick, W. E.** (1952). "On the Rate of Gain of Information." *Quarterly Journal of Experimental Psychology*, 4(1), 11-26.

12. **Fitts, P. M.** (1954). "The Information Capacity of the Human Motor System in Controlling the Amplitude of Movement." *Journal of Experimental Psychology*, 47(6), 381-391.

### Application Examples

- **Duolingo:** Streaks, small wins, suggestions-first
- **Strava:** Kudos, segments, social sharing
- **Nike Run Club:** Milestones, achievements, celebrations
- **CityStrides:** Street completion tracking, progress visualization
- **Peloton:** Streaks, leaderboards, celebrations

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Feb 2026 | Initial documentation |
