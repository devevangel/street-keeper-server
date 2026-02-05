/**
 * Spatial Coverage Tests
 * Verifies interval merging and cumulative coverage calculation
 */

import { describe, it, expect } from "vitest";
import {
  mergeIntervals,
  calculateTotalCoverage,
  type CoverageInterval,
} from "../services/user-street-progress.service.js";

describe("mergeIntervals", () => {
  it("merges overlapping intervals", () => {
    const existing: CoverageInterval[] = [[0, 50]];
    const newInterval: CoverageInterval = [40, 90];
    const result = mergeIntervals(existing, newInterval);
    expect(result).toEqual([[0, 90]]);
  });

  it("merges adjacent intervals", () => {
    const existing: CoverageInterval[] = [[0, 50]];
    const newInterval: CoverageInterval = [50, 100];
    const result = mergeIntervals(existing, newInterval);
    expect(result).toEqual([[0, 100]]);
  });

  it("keeps separate intervals with gaps", () => {
    const existing: CoverageInterval[] = [[0, 30]];
    const newInterval: CoverageInterval = [70, 100];
    const result = mergeIntervals(existing, newInterval);
    expect(result).toEqual([
      [0, 30],
      [70, 100],
    ]);
  });

  it("handles multiple existing intervals", () => {
    const existing: CoverageInterval[] = [
      [0, 20],
      [40, 60],
    ];
    const newInterval: CoverageInterval = [15, 50];
    const result = mergeIntervals(existing, newInterval);
    // Should merge [0,20] and [15,50] and [40,60] into [0,60]
    expect(result).toEqual([[0, 60]]);
  });

  it("handles empty existing intervals", () => {
    const existing: CoverageInterval[] = [];
    const newInterval: CoverageInterval = [30, 70];
    const result = mergeIntervals(existing, newInterval);
    expect(result).toEqual([[30, 70]]);
  });

  it("handles intervals that fully contain existing", () => {
    const existing: CoverageInterval[] = [[20, 40]];
    const newInterval: CoverageInterval = [0, 100];
    const result = mergeIntervals(existing, newInterval);
    expect(result).toEqual([[0, 100]]);
  });
});

describe("calculateTotalCoverage", () => {
  it("calculates coverage from single interval", () => {
    const intervals: CoverageInterval[] = [[0, 50]];
    expect(calculateTotalCoverage(intervals)).toBe(50);
  });

  it("calculates coverage from multiple intervals", () => {
    const intervals: CoverageInterval[] = [
      [0, 30],
      [70, 100],
    ];
    expect(calculateTotalCoverage(intervals)).toBe(60); // 30 + 30
  });

  it("calculates coverage from merged intervals", () => {
    const intervals: CoverageInterval[] = [[0, 90]];
    expect(calculateTotalCoverage(intervals)).toBe(90);
  });

  it("returns 0 for empty intervals", () => {
    expect(calculateTotalCoverage([])).toBe(0);
  });

  it("clamps to 100 maximum", () => {
    const intervals: CoverageInterval[] = [
      [0, 60],
      [50, 100],
    ]; // Would be 110% if not clamped
    expect(calculateTotalCoverage(intervals)).toBe(100);
  });
});
