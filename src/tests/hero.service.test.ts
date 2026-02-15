/**
 * Hero service tests: deterministic priority, lapsed_30_days, new_user_no_data.
 */
import { describe, it, expect } from "vitest";
import { getHeroState } from "../services/hero.service.js";

describe("Hero service", () => {
  it("returns new_user_no_data when no activity", () => {
    const state = getHeroState({
      streak: { currentWeeks: 0, isAtRisk: false, lastRunDate: null, longestStreak: 0, qualifyingRunsThisWeek: 0 },
      nextMilestone: null,
      lastActivityDate: null,
      hasAnyActivity: false,
      isFirstRunRecent: false,
    });
    expect(state.stateKey).toBe("new_user_no_data");
    expect(state.message).toContain("Welcome");
  });

  it("returns streak_at_risk when streak > 0 and at risk", () => {
    const state = getHeroState({
      streak: { currentWeeks: 3, isAtRisk: true, lastRunDate: "2026-02-01", longestStreak: 5, qualifyingRunsThisWeek: 0 },
      nextMilestone: null,
      lastActivityDate: new Date("2026-02-01"),
      hasAnyActivity: true,
      isFirstRunRecent: false,
    });
    expect(state.stateKey).toBe("streak_at_risk");
    expect(state.message).toContain("One run this week");
  });

  it("returns lapsed_30_days when last run >= 30 days ago", () => {
    const d = new Date();
    d.setDate(d.getDate() - 35);
    const state = getHeroState({
      streak: { currentWeeks: 0, isAtRisk: false, lastRunDate: d.toISOString().slice(0, 10), longestStreak: 0, qualifyingRunsThisWeek: 0 },
      nextMilestone: null,
      lastActivityDate: d,
      hasAnyActivity: true,
      isFirstRunRecent: false,
    });
    expect(state.stateKey).toBe("lapsed_30_days");
    expect(state.message).toContain("It's been a while");
  });

  it("returns no_run_5_days when last run 5–29 days ago", () => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    const state = getHeroState({
      streak: { currentWeeks: 0, isAtRisk: false, lastRunDate: d.toISOString().slice(0, 10), longestStreak: 0, qualifyingRunsThisWeek: 0 },
      nextMilestone: null,
      lastActivityDate: d,
      hasAnyActivity: true,
      isFirstRunRecent: false,
    });
    expect(state.stateKey).toBe("no_run_5_days");
    expect(state.message).toContain("Ready to get back out");
  });

  it("returns first_run_just_synced when single recent run", () => {
    const d = new Date();
    d.setHours(d.getHours() - 1);
    const state = getHeroState({
      streak: { currentWeeks: 0, isAtRisk: false, lastRunDate: null, longestStreak: 0, qualifyingRunsThisWeek: 0 },
      nextMilestone: null,
      lastActivityDate: d,
      hasAnyActivity: true,
      isFirstRunRecent: true,
    });
    expect(state.stateKey).toBe("first_run_just_synced");
    expect(state.message).toContain("First run");
  });

  it("returns close_to_milestone when next milestone ratio >= 0.8", () => {
    const state = getHeroState({
      streak: { currentWeeks: 0, isAtRisk: false, lastRunDate: null, longestStreak: 0, qualifyingRunsThisWeek: 0 },
      nextMilestone: {
        id: "m1",
        name: "25% project",
        typeSlug: "project_percent",
        kind: "auto",
        isPinned: false,
        progress: { currentValue: 23, targetValue: 25, unit: "percent", ratio: 0.92, isCompleted: false },
      },
      lastActivityDate: new Date(),
      hasAnyActivity: true,
      isFirstRunRecent: false,
    });
    expect(state.stateKey).toBe("close_to_milestone");
    expect(state.message).toContain("25% project");
  });

  it("returns streak_active when streak > 0 and not at risk", () => {
    const state = getHeroState({
      streak: { currentWeeks: 2, isAtRisk: false, lastRunDate: "2026-02-10", longestStreak: 2, qualifyingRunsThisWeek: 1 },
      nextMilestone: null,
      lastActivityDate: new Date("2026-02-10"),
      hasAnyActivity: true,
      isFirstRunRecent: false,
    });
    expect(state.stateKey).toBe("streak_active");
    expect(state.message).toContain("2-week");
  });
});
