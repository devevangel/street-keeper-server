/**
 * Hero state for homepage: deterministic priority (first matching wins).
 * Includes lapsed_30_days and firm-but-kind messaging.
 */
import type { StreakData } from "./streak.service.js";
import type { MilestoneWithProgress } from "../types/milestone.types.js";

export interface HeroState {
  message: string;
  stateKey: string;
}

interface HeroContext {
  streak: StreakData;
  nextMilestone: MilestoneWithProgress | null;
  lastActivityDate: Date | null;
  hasAnyActivity: boolean;
  isFirstRunRecent: boolean;
  lastRunNewStreets?: number;
  lastRunDistanceKm?: number;
  daysSinceLast?: number | null;
}

function daysSince(d: Date): number {
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

const HERO_PRIORITY: Array<{
  key: string;
  check: (ctx: HeroContext) => boolean;
  message: (ctx: HeroContext) => string;
}> = [
  {
    key: "streak_at_risk",
    check: (ctx) => ctx.streak.isAtRisk && ctx.streak.currentWeeks > 0,
    message: (ctx) =>
      `One run this week keeps your ${ctx.streak.currentWeeks}-week streak.`,
  },
  {
    key: "first_run_just_synced",
    check: (ctx) => ctx.hasAnyActivity && ctx.isFirstRunRecent,
    message: () => "First run in the bag!",
  },
  {
    key: "close_to_milestone",
    check: (ctx) =>
      ctx.nextMilestone != null && ctx.nextMilestone.progress.ratio >= 0.8,
    message: (ctx) =>
      `${Math.ceil((ctx.nextMilestone!.progress.targetValue - ctx.nextMilestone!.progress.currentValue))} more to ${ctx.nextMilestone!.name}.`,
  },
  {
    key: "streak_active",
    check: (ctx) => ctx.streak.currentWeeks > 0,
    message: (ctx) => `${ctx.streak.currentWeeks}-week discovery streak.`,
  },
  {
    key: "recent_run_good",
    check: (ctx) =>
      ctx.lastActivityDate != null && daysSince(ctx.lastActivityDate) <= 2 && ctx.lastRunNewStreets != null && ctx.lastRunNewStreets > 0,
    message: (ctx) =>
      ctx.lastRunDistanceKm != null
        ? `Nice! You ran ${ctx.lastRunDistanceKm.toFixed(1)} km and discovered ${ctx.lastRunNewStreets} new streets.`
        : `Nice! You discovered ${ctx.lastRunNewStreets} new streets.`,
  },
  {
    key: "recent_run_no_new",
    check: (ctx) =>
      ctx.lastActivityDate != null && daysSince(ctx.lastActivityDate) <= 2 && (ctx.lastRunNewStreets == null || ctx.lastRunNewStreets === 0),
    message: (ctx) => {
      const daysAgo = ctx.daysSinceLast ?? (ctx.lastActivityDate ? daysSince(ctx.lastActivityDate) : null);
      const dateText = daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo} days ago`;
      return ctx.lastRunDistanceKm != null
        ? `Nice! You got out there — ${ctx.lastRunDistanceKm.toFixed(1)} km on ${dateText}.`
        : `Nice! You got out there on ${dateText}.`;
    },
  },
  {
    key: "lapsed",
    check: (ctx) =>
      ctx.lastActivityDate != null && daysSince(ctx.lastActivityDate) >= 5,
    message: () => "Welcome back. Ready to run?",
  },
  {
    key: "has_activity",
    check: (ctx) => ctx.hasAnyActivity,
    message: () => "Nice — you got out there.",
  },
  {
    key: "new_user",
    check: (ctx) => !ctx.hasAnyActivity,
    message: () => "Run every street in your city, one run at a time.",
  },
];

/**
 * Get hero state from context. First matching priority wins.
 */
export function getHeroState(ctx: HeroContext): HeroState {
  for (const { key, check, message } of HERO_PRIORITY) {
    if (check(ctx)) {
      return { stateKey: key, message: message(ctx) };
    }
  }
  return {
    stateKey: "new_user_no_data",
    message: "Welcome. Search an area to start exploring.",
  };
}
