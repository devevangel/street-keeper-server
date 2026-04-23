/**
 * Street totals: UTC month helper, month label, and V2 lifetime/month aggregation (prisma mocked).
 *
 * The service is V2-only: lifetime and monthly counts both derive from
 * UserNodeHit + WayNode + WayTotalEdges, with ways grouped by normalised
 * street name and unnamed ways ignored.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQueryRaw = vi.fn();
const mockUserNodeHitFindMany = vi.fn();
const mockWayNodeFindMany = vi.fn();
const mockWayTotalEdgesFindMany = vi.fn();
const mockProjectFindFirst = vi.fn();

vi.mock("../lib/prisma.js", () => ({
  default: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    userNodeHit: {
      findMany: (...args: unknown[]) => mockUserNodeHitFindMany(...args),
    },
    wayNode: {
      findMany: (...args: unknown[]) => mockWayNodeFindMany(...args),
    },
    wayTotalEdges: {
      findMany: (...args: unknown[]) => mockWayTotalEdgesFindMany(...args),
    },
    project: {
      findFirst: (...args: unknown[]) => mockProjectFindFirst(...args),
    },
  },
}));

import {
  getUtcMonthStart,
  formatZonedMonthLabel,
  getUserStreetTotals,
  getProjectStreetTotals,
} from "../services/street-totals.service.js";

describe("street-totals.service", () => {
  beforeEach(() => {
    mockQueryRaw.mockReset();
    mockUserNodeHitFindMany.mockReset();
    mockWayNodeFindMany.mockReset();
    mockWayTotalEdgesFindMany.mockReset();
    mockProjectFindFirst.mockReset();
  });

  describe("getUtcMonthStart", () => {
    it("returns UTC midnight on first of month", () => {
      const ref = new Date("2026-04-15T12:00:00.000Z");
      expect(getUtcMonthStart(ref).toISOString()).toBe("2026-04-01T00:00:00.000Z");
    });
  });

  describe("formatZonedMonthLabel", () => {
    it("includes month and year in en-GB for UTC", () => {
      const ref = new Date("2026-04-15T12:00:00.000Z");
      const label = formatZonedMonthLabel(ref, "UTC");
      expect(label).toContain("2026");
      expect(label.toLowerCase()).toContain("april");
    });
  });

  describe("getUserStreetTotals (V2)", () => {
    it("returns zero counts when the user has no node hits", async () => {
      mockUserNodeHitFindMany.mockResolvedValueOnce([]);
      const out = await getUserStreetTotals("u1", "UTC", new Date("2026-04-15T12:00:00.000Z"));
      expect(out.lifetimeStreetsCompleted).toBe(0);
      expect(out.streetsThisMonth).toBe(0);
    });

    it("groups ways by normalised name, ignores unnamed, and flags newly-complete this month", async () => {
      // Scenario:
      //  - "Elm Street" (way 1, 10 nodes): 10 hits overall, all before month-start → complete before & now.
      //  - "Oak Road"   (way 2, 10 nodes): 9 hits overall (isComplete ≥ 90%), only 4 before month-start
      //                                    (not complete before) → newly completed this month.
      //  - "Pine Ave"   (way 3, 10 nodes): 5 hits → not complete on this segment.
      //  - ""           (way 4, unnamed): ignored regardless of completion.
      //  - "Pine Ave"   (way 5, same name, 10 nodes): 10 hits → complete. Under the "any segment complete"
      //                                               rule this counts Pine Ave as finished.
      //
      //  Lifetime: Elm Street + Oak Road + Pine Ave = 3.
      //  This month: Oak Road + Pine Ave = 2 (Pine Ave way 5's hits are all after month-start, and no
      //                                       Pine Ave segment was complete before month-start).
      const monthStart = new Date("2026-04-01T00:00:00.000Z");

      const priorDate = new Date("2026-03-15T00:00:00.000Z");
      const afterDate = new Date("2026-04-10T00:00:00.000Z");

      const hits: Array<{ nodeId: bigint; hitAt: Date }> = [];
      // Elm Street: 10 hits all before month-start
      for (let i = 1; i <= 10; i++) hits.push({ nodeId: BigInt(i), hitAt: priorDate });
      // Oak Road: 9 hits total. First 4 before month-start, rest after.
      for (let i = 11; i <= 14; i++) hits.push({ nodeId: BigInt(i), hitAt: priorDate });
      for (let i = 15; i <= 19; i++) hits.push({ nodeId: BigInt(i), hitAt: afterDate });
      // Pine Ave way 3: 5 hits after month-start (incomplete)
      for (let i = 21; i <= 25; i++) hits.push({ nodeId: BigInt(i), hitAt: afterDate });
      // Unnamed way 4: 10 hits after month-start
      for (let i = 31; i <= 40; i++) hits.push({ nodeId: BigInt(i), hitAt: afterDate });
      // Pine Ave way 5: 10 hits after month-start (complete but collides with way 3's name)
      for (let i = 41; i <= 50; i++) hits.push({ nodeId: BigInt(i), hitAt: afterDate });

      mockUserNodeHitFindMany.mockResolvedValueOnce(hits);

      const wayNodes: Array<{ wayId: bigint; nodeId: bigint }> = [];
      for (let i = 1; i <= 10; i++) wayNodes.push({ wayId: 1n, nodeId: BigInt(i) });
      for (let i = 11; i <= 20; i++) wayNodes.push({ wayId: 2n, nodeId: BigInt(i) });
      for (let i = 21; i <= 30; i++) wayNodes.push({ wayId: 3n, nodeId: BigInt(i) });
      for (let i = 31; i <= 40; i++) wayNodes.push({ wayId: 4n, nodeId: BigInt(i) });
      for (let i = 41; i <= 50; i++) wayNodes.push({ wayId: 5n, nodeId: BigInt(i) });
      mockWayNodeFindMany.mockResolvedValueOnce(wayNodes);

      mockWayTotalEdgesFindMany.mockResolvedValueOnce([
        { wayId: 1n, totalNodes: 10, name: "Elm Street" },
        { wayId: 2n, totalNodes: 10, name: "Oak Road" },
        { wayId: 3n, totalNodes: 10, name: "Pine Ave" },
        { wayId: 4n, totalNodes: 10, name: "" },
        { wayId: 5n, totalNodes: 10, name: "Pine Ave" },
      ]);

      const out = await getUserStreetTotals("u1", "UTC", new Date("2026-04-15T12:00:00.000Z"));
      expect(out.lifetimeStreetsCompleted).toBe(3);
      expect(out.streetsThisMonth).toBe(2);

      void monthStart; // referenced for documentation
    });
  });

  describe("getProjectStreetTotals", () => {
    it("returns 0 when the project snapshot has no streets", async () => {
      mockProjectFindFirst.mockResolvedValueOnce({ streetsSnapshot: null });
      const out = await getProjectStreetTotals("p1", "u1", "UTC", new Date("2026-04-15T12:00:00.000Z"));
      expect(out.streetsThisMonth).toBe(0);
    });

    it("counts only named streets in the project snapshot newly completed this month", async () => {
      mockProjectFindFirst.mockResolvedValueOnce({
        streetsSnapshot: {
          streets: [{ osmId: "way/2" }, { osmId: "way/3" }],
        },
      });

      const priorDate = new Date("2026-03-15T00:00:00.000Z");
      const afterDate = new Date("2026-04-10T00:00:00.000Z");
      const hits: Array<{ nodeId: bigint; hitAt: Date }> = [];
      for (let i = 11; i <= 14; i++) hits.push({ nodeId: BigInt(i), hitAt: priorDate });
      for (let i = 15; i <= 19; i++) hits.push({ nodeId: BigInt(i), hitAt: afterDate });
      for (let i = 21; i <= 25; i++) hits.push({ nodeId: BigInt(i), hitAt: afterDate });
      mockUserNodeHitFindMany.mockResolvedValueOnce(hits);

      const wayNodes: Array<{ wayId: bigint; nodeId: bigint }> = [];
      for (let i = 11; i <= 20; i++) wayNodes.push({ wayId: 2n, nodeId: BigInt(i) });
      for (let i = 21; i <= 30; i++) wayNodes.push({ wayId: 3n, nodeId: BigInt(i) });
      mockWayNodeFindMany.mockResolvedValueOnce(wayNodes);

      mockWayTotalEdgesFindMany.mockResolvedValueOnce([
        { wayId: 2n, totalNodes: 10, name: "Oak Road" },
        { wayId: 3n, totalNodes: 10, name: "Pine Ave" },
      ]);

      const out = await getProjectStreetTotals("p1", "u1", "UTC", new Date("2026-04-15T12:00:00.000Z"));
      expect(out.streetsThisMonth).toBe(1);
    });
  });
});
