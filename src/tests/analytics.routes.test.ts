/**
 * Analytics routes: POST /analytics/events (batch)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import analyticsRoutes from "../routes/analytics.routes.js";

vi.mock("../middleware/auth.middleware.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const trackEventsBatchMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/analytics.service.js", () => ({
  trackEventsBatch: (...args: unknown[]) => trackEventsBatchMock(...args),
}));

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as unknown as { user: { id: string } }).user = { id: "test-user-id" };
  next();
});
app.use("/api/v1/analytics", analyticsRoutes);

describe("POST /api/v1/analytics/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when events is missing", async () => {
    const res = await request(app)
      .post("/api/v1/analytics/events")
      .send({})
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe("INVALID_PAYLOAD");
  });

  it("returns 400 when events is not an array", async () => {
    const res = await request(app)
      .post("/api/v1/analytics/events")
      .send({ events: "not-array" })
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 200 and accepts valid events array", async () => {
    const res = await request(app)
      .post("/api/v1/analytics/events")
      .send({
        events: [
          { event: "homepage_viewed", properties: { stateKey: "new_user_no_data" } },
        ],
      })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(trackEventsBatchMock).toHaveBeenCalledWith(
      "test-user-id",
      expect.arrayContaining([
        expect.objectContaining({ event: "homepage_viewed", properties: { stateKey: "new_user_no_data" } }),
      ])
    );
  });
});
