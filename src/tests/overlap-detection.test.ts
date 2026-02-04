/**
 * Overlap Detection Service Tests
 * Verifies date filtering: only projects created at or before activity start (date and time) are considered.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GpxPoint } from "../types/run.types.js";

// Mock prisma before importing the service
const mockFindMany = vi.fn();
vi.mock("../lib/prisma.js", () => ({
  default: {
    project: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

// Import after mock so detectOverlappingProjects uses mocked prisma
const { detectOverlappingProjects } = await import(
  "../services/overlap-detection.service.js"
);

const sampleCoords: GpxPoint[] = [
  { lat: 51.48, lng: -0.61 },
  { lat: 51.49, lng: -0.6 },
];

describe("detectOverlappingProjects", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    mockFindMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls findMany without createdAt when activityStartDate is omitted", async () => {
    await detectOverlappingProjects("user-1", sampleCoords, {});

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const call = mockFindMany.mock.calls[0][0];
    expect(call.where).toBeDefined();
    expect(call.where.userId).toBe("user-1");
    expect(call.where.createdAt).toBeUndefined();
  });

  it("calls findMany with createdAt lte when activityStartDate is provided", async () => {
    const activityStart = new Date("2025-01-17T14:30:00.000Z");

    await detectOverlappingProjects("user-1", sampleCoords, {
      activityStartDate: activityStart,
    });

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const call = mockFindMany.mock.calls[0][0];
    expect(call.where.createdAt).toEqual({ lte: activityStart });
    expect(call.where.userId).toBe("user-1");
  });

  it("uses full timestamp (date and time) for filtering", async () => {
    // Project created same day but later should be excluded: activity 10:00, project 11:00
    const activityStart = new Date("2025-01-17T10:00:00.000Z");

    await detectOverlappingProjects("user-1", sampleCoords, {
      activityStartDate: activityStart,
    });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { lte: activityStart },
        }),
      })
    );
    // Same Date instance so comparison is exact time
    expect(mockFindMany.mock.calls[0][0].where.createdAt.lte.getTime()).toBe(
      activityStart.getTime()
    );
  });

  it("returns empty when coordinates are empty", async () => {
    const result = await detectOverlappingProjects("user-1", [], {});

    expect(result).toEqual([]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});
