/**
 * Celebration bucket derivation and Strava block stripping.
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import type { ActivityImpact } from "../types/activity.types.js";
import {
  deriveBucketsFromImpact,
  getCelebrationHistory,
  stripAllStreetKeeperBlocks,
  stripHashtagFooter,
  stripStreetKeeperHeader,
} from "../services/celebration.service.js";
import prisma from "../lib/prisma.js";

vi.mock("../lib/prisma.js", () => ({
  default: {
    runCelebrationEvent: {
      findMany: vi.fn(),
    },
  },
}));

describe("celebration.service deriveBucketsFromImpact", () => {
  it("splits completed vs started (from 0) vs improved", () => {
    const impact: ActivityImpact = {
      completed: ["way-1", "way-2"],
      improved: [
        { osmId: "way-1", from: 80, to: 100 },
        { osmId: "way-2", from: 70, to: 100 },
        { osmId: "way-3", from: 0, to: 40 },
        { osmId: "way-4", from: 10, to: 30 },
      ],
    };
    const b = deriveBucketsFromImpact(impact);
    expect(b.completedOsmIds).toEqual(["way-1", "way-2"]);
    expect(new Set(b.startedOsmIds)).toEqual(new Set(["way-3"]));
    expect(new Set(b.improvedOsmIds)).toEqual(new Set(["way-4"]));
  });

  it("returns empty buckets when impact is empty", () => {
    const impact: ActivityImpact = { completed: [], improved: [] };
    const b = deriveBucketsFromImpact(impact);
    expect(b.completedOsmIds).toEqual([]);
    expect(b.startedOsmIds).toEqual([]);
    expect(b.improvedOsmIds).toEqual([]);
  });
});

describe("celebration.service strip helpers", () => {
  it("stripHashtagFooter removes trailing Street Keeper hashtags", () => {
    const msg = "Line\n\n#StreetKeeper #RunEveryStreet";
    expect(stripHashtagFooter(msg)).toBe("Line");
  });

  it("stripStreetKeeperHeader removes leading marker", () => {
    const msg = "--- Street Keeper ---\nBody here";
    expect(stripStreetKeeperHeader(msg)).toBe("Body here");
  });

  it("stripAllStreetKeeperBlocks removes one or more SK blocks", () => {
    const desc =
      "My run\n\n--- Street Keeper ---\nOld stats\n\n#StreetKeeper #RunEveryStreet\n\nMore text";
    const cleaned = stripAllStreetKeeperBlocks(desc);
    expect(cleaned).toContain("My run");
    expect(cleaned).toContain("More text");
    expect(cleaned).not.toContain("Old stats");
  });
});

describe("celebration.service getCelebrationHistory", () => {
  const findMany = vi.mocked(prisma.runCelebrationEvent.findMany);

  const baseRow = {
    completedCount: 0,
    startedCount: 0,
    improvedCount: 0,
    completedStreetNames: [] as string[],
    startedStreetNames: [] as string[],
    improvedStreetNames: [] as string[],
    projectProgressBefore: 0,
    projectProgressAfter: 10,
    projectCompleted: false,
    activityDistanceMeters: 5000,
    activityDurationSeconds: 1800,
    activityStartDate: new Date("2026-04-15T08:00:00Z"),
    shareMessage: null as string | null,
    celebrationShownAt: new Date("2026-04-15T09:00:00Z") as Date | null,
    sharedToStravaAt: null as Date | null,
  };

  function makeRow(overrides: Partial<Record<string, unknown>>) {
    return {
      ...baseRow,
      ...overrides,
    } as unknown as Awaited<ReturnType<typeof prisma.runCelebrationEvent.findMany>>[number];
  }

  beforeEach(() => {
    findMany.mockReset();
  });

  it("groups rows by activity and rolls up counts", async () => {
    findMany.mockResolvedValueOnce([
      makeRow({
        id: "evt-a1",
        activityId: "act-1",
        projectId: "proj-a",
        project: { name: "Weekday Loop" },
        activity: { id: "act-1" },
        completedCount: 2,
        startedCount: 1,
        improvedCount: 0,
        createdAt: new Date("2026-04-15T08:30:00Z"),
      }),
      makeRow({
        id: "evt-a2",
        activityId: "act-1",
        projectId: "proj-b",
        project: { name: "Parkrun" },
        activity: { id: "act-1" },
        completedCount: 1,
        improvedCount: 3,
        createdAt: new Date("2026-04-15T08:29:00Z"),
      }),
      makeRow({
        id: "evt-b1",
        activityId: "act-2",
        projectId: "proj-a",
        project: { name: "Weekday Loop" },
        activity: { id: "act-2" },
        completedCount: 5,
        createdAt: new Date("2026-04-12T07:00:00Z"),
      }),
    ] as any);

    const page = await getCelebrationHistory("user-1", { limit: 10 });

    expect(page.nextCursor).toBeNull();
    expect(page.entries).toHaveLength(2);
    const first = page.entries[0]!;
    expect(first.activityId).toBe("act-1");
    expect(first.events).toHaveLength(2);
    expect(first.rollup).toEqual({
      totalCompleted: 3,
      totalStarted: 1,
      totalImproved: 3,
      projectCount: 2,
    });
    expect(first.acknowledged).toBe(true);
    expect(first.sharedToStrava).toBe(false);
    expect(page.entries[1]!.activityId).toBe("act-2");
  });

  it("emits a nextCursor when more rows remain", async () => {
    const rows = [
      makeRow({
        id: "evt-1",
        activityId: "act-1",
        projectId: "proj-a",
        project: { name: "Loop" },
        activity: { id: "act-1" },
        createdAt: new Date("2026-04-15T08:30:00Z"),
      }),
      makeRow({
        id: "evt-2",
        activityId: "act-2",
        projectId: "proj-a",
        project: { name: "Loop" },
        activity: { id: "act-2" },
        createdAt: new Date("2026-04-12T08:00:00Z"),
      }),
      makeRow({
        id: "evt-3",
        activityId: "act-3",
        projectId: "proj-a",
        project: { name: "Loop" },
        activity: { id: "act-3" },
        createdAt: new Date("2026-04-11T08:00:00Z"),
      }),
    ];
    findMany.mockResolvedValueOnce(rows as any);

    const page = await getCelebrationHistory("user-1", { limit: 2 });

    expect(page.entries).toHaveLength(2);
    expect(page.entries[0]!.activityId).toBe("act-1");
    expect(page.entries[1]!.activityId).toBe("act-2");
    expect(page.nextCursor).toBe("2026-04-12T08:00:00.000Z|act-2");
  });

  it("passes projectId filter through to the query", async () => {
    findMany.mockResolvedValueOnce([]);
    await getCelebrationHistory("user-1", { projectId: "proj-a" });
    const args = findMany.mock.calls[0]![0]!;
    expect((args as any).where.projectId).toBe("proj-a");
  });

  it("marks acknowledged=false when any row is not yet shown", async () => {
    findMany.mockResolvedValueOnce([
      makeRow({
        id: "evt-1",
        activityId: "act-1",
        projectId: "proj-a",
        project: { name: "Loop" },
        activity: { id: "act-1" },
        celebrationShownAt: null,
        createdAt: new Date("2026-04-15T08:30:00Z"),
      }),
      makeRow({
        id: "evt-2",
        activityId: "act-1",
        projectId: "proj-b",
        project: { name: "B" },
        activity: { id: "act-1" },
        celebrationShownAt: new Date(),
        sharedToStravaAt: new Date(),
        createdAt: new Date("2026-04-15T08:29:00Z"),
      }),
    ] as any);
    const page = await getCelebrationHistory("user-1", { limit: 5 });
    expect(page.entries[0]!.acknowledged).toBe(false);
    expect(page.entries[0]!.sharedToStrava).toBe(true);
  });
});
