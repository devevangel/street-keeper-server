/**
 * Homepage route: GET /homepage – payload shape and 200
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import homepageRoutes from "../routes/homepage.routes.js";
import type { HomepagePayload } from "../types/homepage.types.js";

vi.mock("../middleware/auth.middleware.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const getHomepageDataMock = vi.fn();
vi.mock("../services/homepage.service.js", () => ({
  getHomepageData: (userId: string, query: unknown) => getHomepageDataMock(userId, query),
}));

const app = express();
app.use((req, _res, next) => {
  (req as unknown as { user: { id: string } }).user = { id: "user-123" };
  next();
});
app.use("/api/v1/homepage", homepageRoutes);

describe("GET /api/v1/homepage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getHomepageDataMock.mockResolvedValue({
      hero: { message: "Welcome.", stateKey: "new_user_no_data" },
      streak: { currentWeeks: 0, isAtRisk: false, lastRunDate: null, longestStreak: 0, qualifyingRunsThisWeek: 0 },
      primarySuggestion: null,
      alternates: [],
      nextMilestone: null,
      mapContext: { lat: 0, lng: 0, radius: 1200 },
    } as HomepagePayload);
  });

  it("returns 200 and payload with hero, streak, mapContext", async () => {
    const res = await request(app)
      .get("/api/v1/homepage")
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.hero).toEqual({ message: "Welcome.", stateKey: "new_user_no_data" });
    expect(res.body.data.streak).toBeDefined();
    expect(res.body.data.mapContext).toEqual({ lat: 0, lng: 0, radius: 1200 });
    expect(res.body.data.primarySuggestion).toBeNull();
    expect(res.body.data.nextMilestone).toBeNull();
  });

  it("calls getHomepageData with userId and query params", async () => {
    await request(app)
      .get("/api/v1/homepage?projectId=proj-1&lat=52.1&lng=-0.1")
      .expect(200);
    expect(getHomepageDataMock).toHaveBeenCalledWith("user-123", {
      lat: "52.1",
      lng: "-0.1",
      projectId: "proj-1",
      radius: undefined,
    });
  });
});
