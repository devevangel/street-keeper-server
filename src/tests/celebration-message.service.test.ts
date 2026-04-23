/**
 * Run celebration share message: determinism and storyline coverage.
 */
import { describe, it, expect } from "vitest";
import {
  buildShareMessage,
  pickStorylineForTest,
  getLocalHour,
  STREET_KEEPER_HASHTAG_FOOTER,
} from "../services/celebration-message.service.js";
import type { BuildShareMessageInput } from "../services/celebration-message.service.js";

const noonUtc = new Date("2024-06-15T12:00:00.000Z");

function input(
  overrides: Partial<BuildShareMessageInput> = {},
): BuildShareMessageInput {
  return {
    activityId: "act-11111111-1111-1111-1111-111111111111",
    projectId: "proj-22222222-2222-2222-2222-222222222222",
    projectName: "Testville",
    sameRunProjectCount: 1,
    completedCount: 0,
    startedCount: 0,
    improvedCount: 0,
    completedStreetNames: [],
    startedStreetNames: [],
    improvedStreetNames: [],
    projectProgressBefore: 10,
    projectProgressAfter: 15,
    projectCompleted: false,
    activityDistanceMeters: 5000,
    activityDurationSeconds: 1800,
    activityStartDate: noonUtc,
    userTimeZone: "UTC",
    ...overrides,
  };
}

describe("celebration-message.service", () => {
  it("returns identical text for the same activityId + projectId", () => {
    const a = buildShareMessage(
      input({
        completedCount: 2,
        startedCount: 1,
        improvedCount: 0,
        completedStreetNames: ["A St", "B Rd"],
        startedStreetNames: ["C Ln"],
      }),
    );
    const b = buildShareMessage(
      input({
        completedCount: 2,
        startedCount: 1,
        improvedCount: 0,
        completedStreetNames: ["A St", "B Rd"],
        startedStreetNames: ["C Ln"],
      }),
    );
    expect(a).toBe(b);
    expect(a).toContain("--- Street Keeper ---");
    expect(a).toContain("#StreetKeeper");
    expect(a).toContain("#RunEveryStreet");
  });

  it("classifies project-finished when projectCompleted is true", () => {
    const storyline = pickStorylineForTest(
      input({
        completedCount: 1,
        startedCount: 0,
        improvedCount: 0,
        completedStreetNames: ["Done Rd"],
        projectCompleted: true,
      }),
    );
    expect(storyline).toBe("project-finished");
  });

  it("appends #ProjectDone for project-finished storyline", () => {
    const msg = buildShareMessage(
      input({
        projectCompleted: true,
        completedCount: 1,
        completedStreetNames: ["Fin"],
      }),
    );
    expect(msg).toContain("#StreetKeeper #RunEveryStreet #ProjectDone");
  });

  it("classifies long-run when distance >= 10000m (before multi-project)", () => {
    const storyline = pickStorylineForTest(
      input({
        activityDistanceMeters: 10_500,
        sameRunProjectCount: 2,
        completedCount: 1,
        startedCount: 0,
        improvedCount: 0,
        completedStreetNames: ["X"],
      }),
    );
    expect(storyline).toBe("long-run");
  });

  it("classifies multi-project when sameRunProjectCount >= 2 and distance < 10km", () => {
    const storyline = pickStorylineForTest(
      input({
        sameRunProjectCount: 2,
        activityDistanceMeters: 8000,
        completedCount: 1,
        startedCount: 0,
        improvedCount: 0,
        completedStreetNames: ["X"],
        projectCompleted: false,
      }),
    );
    expect(storyline).toBe("multi-project");
  });

  it("classifies early-bird when local hour < 7", () => {
    expect(
      pickStorylineForTest(
        input({
          activityStartDate: new Date("2024-01-01T06:30:00.000Z"),
          userTimeZone: "UTC",
          activityDistanceMeters: 4000,
          completedCount: 2,
          startedCount: 1,
          improvedCount: 0,
          completedStreetNames: ["a", "b"],
          startedStreetNames: ["c"],
        }),
      ),
    ).toBe("early-bird");
  });

  it("does not classify early-bird at 7:00 local", () => {
    expect(
      pickStorylineForTest(
        input({
          activityStartDate: new Date("2024-01-01T07:00:00.000Z"),
          userTimeZone: "UTC",
          activityDistanceMeters: 4000,
          completedCount: 2,
          startedCount: 1,
          improvedCount: 0,
          completedStreetNames: ["a", "b"],
          startedStreetNames: ["c"],
        }),
      ),
    ).not.toBe("early-bird");
  });

  it("classifies nighthawk when local hour >= 21", () => {
    expect(
      pickStorylineForTest(
        input({
          activityStartDate: new Date("2024-01-01T21:00:00.000Z"),
          userTimeZone: "UTC",
          activityDistanceMeters: 4000,
          completedCount: 2,
          startedCount: 1,
          improvedCount: 0,
          completedStreetNames: ["a", "b"],
          startedStreetNames: ["c"],
        }),
      ),
    ).toBe("nighthawk");
  });

  it("does not classify nighthawk at 20:59 local", () => {
    expect(
      pickStorylineForTest(
        input({
          activityStartDate: new Date("2024-01-01T20:59:00.000Z"),
          userTimeZone: "UTC",
          activityDistanceMeters: 4000,
          completedCount: 2,
          startedCount: 1,
          improvedCount: 0,
          completedStreetNames: ["a", "b"],
          startedStreetNames: ["c"],
        }),
      ),
    ).not.toBe("nighthawk");
  });

  it("classifies minimalist when total streets <= 2 and distance >= 3000m", () => {
    expect(
      pickStorylineForTest(
        input({
          activityDistanceMeters: 3500,
          completedCount: 2,
          startedCount: 0,
          improvedCount: 0,
          completedStreetNames: ["a", "b"],
        }),
      ),
    ).toBe("minimalist");
  });

  it("classifies single-street when total bucket count is 1", () => {
    const storyline = pickStorylineForTest(
      input({
        activityDistanceMeters: 2000,
        completedCount: 1,
        startedCount: 0,
        improvedCount: 0,
        completedStreetNames: ["Only St"],
        sameRunProjectCount: 1,
        projectCompleted: false,
      }),
    );
    expect(storyline).toBe("single-street");
  });

  it("classifies completion-heavy when completions dominate", () => {
    const storyline = pickStorylineForTest(
      input({
        completedCount: 3,
        startedCount: 1,
        improvedCount: 1,
        completedStreetNames: ["a", "b", "c"],
        startedStreetNames: ["d"],
        improvedStreetNames: ["e"],
      }),
    );
    expect(storyline).toBe("completion-heavy");
  });

  it("classifies discovery-heavy when starts dominate", () => {
    const storyline = pickStorylineForTest(
      input({
        completedCount: 0,
        startedCount: 4,
        improvedCount: 1,
        startedStreetNames: ["s1", "s2", "s3", "s4"],
        improvedStreetNames: ["i1"],
      }),
    );
    expect(storyline).toBe("discovery-heavy");
  });

  it("classifies grinder as default for mixed progress", () => {
    const storyline = pickStorylineForTest(
      input({
        completedCount: 0,
        startedCount: 0,
        improvedCount: 3,
        improvedStreetNames: ["i1", "i2", "i3"],
      }),
    );
    expect(storyline).toBe("grinder");
  });

  it("getLocalHour respects IANA time zone", () => {
    const d = new Date("2024-01-01T11:00:00.000Z");
    expect(getLocalHour(d, "UTC")).toBe(11);
    expect(getLocalHour(d, "America/New_York")).toBe(6);
  });

  it("long-run message includes #LongRun in footer", () => {
    const msg = buildShareMessage(
      input({
        activityDistanceMeters: 12_000,
        completedCount: 3,
        startedStreetNames: ["x"],
        improvedStreetNames: ["y"],
        completedStreetNames: ["a", "b", "c"],
      }),
    );
    expect(msg).toContain("#LongRun");
  });

  it("buildShareMessage renders without throwing for each storyline bucket", () => {
    const cases: BuildShareMessageInput[] = [
      input({
        projectCompleted: true,
        completedCount: 1,
        startedCount: 0,
        improvedCount: 0,
        completedStreetNames: ["Fin"],
      }),
      input({
        sameRunProjectCount: 2,
        activityDistanceMeters: 8000,
        completedCount: 1,
        startedCount: 0,
        improvedCount: 0,
        completedStreetNames: ["X"],
        projectCompleted: false,
      }),
      input({
        activityDistanceMeters: 11_000,
        completedCount: 2,
        startedCount: 1,
        improvedCount: 0,
        completedStreetNames: ["a", "b"],
        startedStreetNames: ["c"],
      }),
      input({
        activityStartDate: new Date("2024-01-01T06:00:00.000Z"),
        activityDistanceMeters: 4000,
        completedCount: 2,
        startedCount: 1,
        improvedCount: 0,
        completedStreetNames: ["a", "b"],
        startedStreetNames: ["c"],
      }),
      input({
        activityStartDate: new Date("2024-01-01T22:00:00.000Z"),
        activityDistanceMeters: 4000,
        completedCount: 2,
        startedCount: 1,
        improvedCount: 0,
        completedStreetNames: ["a", "b"],
        startedStreetNames: ["c"],
      }),
      input({
        activityDistanceMeters: 3500,
        completedCount: 2,
        startedCount: 0,
        improvedCount: 0,
        completedStreetNames: ["a", "b"],
      }),
      input({
        activityDistanceMeters: 2000,
        completedCount: 1,
        startedCount: 0,
        improvedCount: 0,
        completedStreetNames: ["One"],
        projectCompleted: false,
      }),
      input({
        completedCount: 2,
        startedCount: 0,
        improvedCount: 0,
        completedStreetNames: ["a", "b"],
      }),
      input({
        completedCount: 0,
        startedCount: 2,
        improvedCount: 0,
        startedStreetNames: ["a", "b"],
      }),
      input({
        completedCount: 0,
        startedCount: 0,
        improvedCount: 2,
        improvedStreetNames: ["a", "b"],
      }),
    ];
    for (const c of cases) {
      const msg = buildShareMessage(c);
      expect(msg.length).toBeGreaterThan(40);
      expect(msg).toContain("#StreetKeeper");
      expect(msg).toMatch(/\n\n#StreetKeeper #RunEveryStreet/);
    }
  });

  it("STREET_KEEPER_HASHTAG_FOOTER is base two-tag footer", () => {
    expect(STREET_KEEPER_HASHTAG_FOOTER.trim()).toBe("#StreetKeeper #RunEveryStreet");
  });
});
