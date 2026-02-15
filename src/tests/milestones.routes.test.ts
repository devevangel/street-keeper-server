/**
 * Milestones routes: GET /milestones, GET /milestones/next – response shape
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import milestonesRoutes from "../routes/milestones.routes.js";

vi.mock("../middleware/auth.middleware.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const getMilestonesForUserMock = vi.fn();
const getNextMilestoneMock = vi.fn();
vi.mock("../services/milestone.service.js", () => ({
  getMilestonesForUser: (...args: unknown[]) => getMilestonesForUserMock(...args),
  getNextMilestone: (...args: unknown[]) => getNextMilestoneMock(...args),
  createMilestone: vi.fn(),
  pinMilestone: vi.fn(),
}));

const app = express();
app.use((req, _res, next) => {
  (req as unknown as { user: { id: string } }).user = { id: "user-1" };
  next();
});
app.use("/api/v1/milestones", milestonesRoutes);

describe("GET /api/v1/milestones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMilestonesForUserMock.mockResolvedValue([]);
  });

  it("returns 200 and list of milestones with progress", async () => {
    getMilestonesForUserMock.mockResolvedValue([
      {
        id: "m1",
        name: "25% project",
        typeSlug: "project_percent",
        kind: "auto",
        isPinned: false,
        progress: { currentValue: 10, targetValue: 25, unit: "percent", ratio: 0.4, isCompleted: false },
      },
    ]);
    const res = await request(app).get("/api/v1/milestones").expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].progress.ratio).toBe(0.4);
    expect(getMilestonesForUserMock).toHaveBeenCalledWith("user-1", undefined);
  });

  it("passes projectId query to getMilestonesForUser", async () => {
    await request(app).get("/api/v1/milestones?projectId=proj-1").expect(200);
    expect(getMilestonesForUserMock).toHaveBeenCalledWith("user-1", "proj-1");
  });
});

describe("GET /api/v1/milestones/next", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getNextMilestoneMock.mockResolvedValue(null);
  });

  it("returns 200 and next milestone or null", async () => {
    const res = await request(app).get("/api/v1/milestones/next").expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeNull();
  });

  it("returns next milestone when present", async () => {
    getNextMilestoneMock.mockResolvedValue({
      id: "m2",
      name: "First Street",
      typeSlug: "first_street_complete",
      kind: "auto",
      isPinned: false,
      progress: { currentValue: 0, targetValue: 1, unit: "streets", ratio: 0, isCompleted: false },
    });
    const res = await request(app).get("/api/v1/milestones/next").expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("First Street");
    expect(res.body.data.progress.unit).toBe("streets");
  });
});
