/**
 * Run celebration share message: determinism and storyline coverage.
 */
import { describe, it, expect } from "vitest";
import {
  buildShareMessage,
  pickStorylineForTest,
  STREET_KEEPER_HASHTAG_FOOTER,
} from "../services/celebration-message.service.js";

const baseInput = {
  activityId: "act-11111111-1111-1111-1111-111111111111",
  projectId: "proj-22222222-2222-2222-2222-222222222222",
  projectName: "Testville",
  sameRunProjectCount: 1,
  completedCount: 0,
  startedCount: 0,
  improvedCount: 0,
  completedStreetNames: [] as string[],
  startedStreetNames: [] as string[],
  improvedStreetNames: [] as string[],
  projectProgressBefore: 10,
  projectProgressAfter: 15,
  projectCompleted: false,
  activityDistanceMeters: 5000,
  activityDurationSeconds: 1800,
};

describe("celebration-message.service", () => {
  it("returns identical text for the same activityId + projectId", () => {
    const a = buildShareMessage({
      ...baseInput,
      completedCount: 2,
      startedCount: 1,
      improvedCount: 0,
      completedStreetNames: ["A St", "B Rd"],
      startedStreetNames: ["C Ln"],
    });
    const b = buildShareMessage({
      ...baseInput,
      completedCount: 2,
      startedCount: 1,
      improvedCount: 0,
      completedStreetNames: ["A St", "B Rd"],
      startedStreetNames: ["C Ln"],
    });
    expect(a).toBe(b);
    expect(a).toContain("--- Street Keeper ---");
    expect(a).toContain(STREET_KEEPER_HASHTAG_FOOTER.trim());
    expect(a).toContain("#StreetKeeper");
    expect(a).toContain("#RunEveryStreet");
  });

  it("classifies project-finished when projectCompleted is true", () => {
    const storyline = pickStorylineForTest({
      ...baseInput,
      completedCount: 1,
      startedCount: 0,
      improvedCount: 0,
      completedStreetNames: ["Done Rd"],
      projectCompleted: true,
    });
    expect(storyline).toBe("project-finished");
  });

  it("classifies multi-project when sameRunProjectCount >= 2", () => {
    const storyline = pickStorylineForTest({
      ...baseInput,
      sameRunProjectCount: 2,
      completedCount: 1,
      startedCount: 0,
      improvedCount: 0,
      completedStreetNames: ["X"],
      projectCompleted: false,
    });
    expect(storyline).toBe("multi-project");
  });

  it("classifies single-street when total bucket count is 1", () => {
    const storyline = pickStorylineForTest({
      ...baseInput,
      completedCount: 1,
      startedCount: 0,
      improvedCount: 0,
      completedStreetNames: ["Only St"],
      sameRunProjectCount: 1,
      projectCompleted: false,
    });
    expect(storyline).toBe("single-street");
  });

  it("classifies completion-heavy when completions dominate", () => {
    const storyline = pickStorylineForTest({
      ...baseInput,
      completedCount: 3,
      startedCount: 1,
      improvedCount: 1,
      completedStreetNames: ["a", "b", "c"],
      startedStreetNames: ["d"],
      improvedStreetNames: ["e"],
    });
    expect(storyline).toBe("completion-heavy");
  });

  it("classifies discovery-heavy when starts dominate", () => {
    const storyline = pickStorylineForTest({
      ...baseInput,
      completedCount: 0,
      startedCount: 4,
      improvedCount: 1,
      startedStreetNames: ["s1", "s2", "s3", "s4"],
      improvedStreetNames: ["i1"],
    });
    expect(storyline).toBe("discovery-heavy");
  });

  it("classifies grinder as default for mixed progress", () => {
    const storyline = pickStorylineForTest({
      ...baseInput,
      completedCount: 0,
      startedCount: 0,
      improvedCount: 3,
      improvedStreetNames: ["i1", "i2", "i3"],
    });
    expect(storyline).toBe("grinder");
  });

  it("buildShareMessage renders without throwing for each storyline bucket", () => {
    const cases = [
      {
        ...baseInput,
        projectCompleted: true,
        completedCount: 1,
        startedCount: 0,
        improvedCount: 0,
        completedStreetNames: ["Fin"],
      },
      {
        ...baseInput,
        sameRunProjectCount: 2,
        completedCount: 1,
        startedCount: 0,
        improvedCount: 0,
        completedStreetNames: ["X"],
        projectCompleted: false,
      },
      {
        ...baseInput,
        completedCount: 1,
        startedCount: 0,
        improvedCount: 0,
        completedStreetNames: ["One"],
        projectCompleted: false,
      },
      {
        ...baseInput,
        completedCount: 2,
        startedCount: 0,
        improvedCount: 0,
        completedStreetNames: ["a", "b"],
      },
      {
        ...baseInput,
        completedCount: 0,
        startedCount: 2,
        improvedCount: 0,
        startedStreetNames: ["a", "b"],
      },
      {
        ...baseInput,
        completedCount: 0,
        startedCount: 0,
        improvedCount: 2,
        improvedStreetNames: ["a", "b"],
      },
    ];
    for (const c of cases) {
      const msg = buildShareMessage(c);
      expect(msg.length).toBeGreaterThan(40);
      expect(msg).toContain("#StreetKeeper");
    }
  });
});
