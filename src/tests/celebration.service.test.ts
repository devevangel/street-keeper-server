/**
 * Celebration bucket derivation and Strava block stripping.
 */
import { describe, it, expect } from "vitest";
import type { ActivityImpact } from "../types/activity.types.js";
import {
  deriveBucketsFromImpact,
  stripAllStreetKeeperBlocks,
  stripHashtagFooter,
  stripStreetKeeperHeader,
} from "../services/celebration.service.js";

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
