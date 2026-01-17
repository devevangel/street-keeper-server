/**
 * Auth Routes Tests
 * Tests core Strava OAuth functionality
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";
import express from "express";
import authRoutes from "../routes/auth.routes.js";

// Create test app with auth routes
const app = express();
app.use(express.json());
app.use("/api/v1/auth", authRoutes);

describe("US-AUTH-01: Strava Authentication", () => {
  beforeAll(() => {
    // Mock environment variables for tests
    process.env.STRAVA_CLIENT_ID = "test_client_id";
    process.env.STRAVA_CLIENT_SECRET = "test_client_secret";
    process.env.STRAVA_REDIRECT_URI = "http://localhost:8000/api/v1/auth/strava/callback";
  });

  describe("GET /api/v1/auth/strava", () => {
    it("should redirect to Strava authorization URL", async () => {
      const response = await request(app)
        .get("/api/v1/auth/strava")
        .expect(302);

      expect(response.headers.location).toContain("https://www.strava.com/oauth/authorize");
      expect(response.headers.location).toContain("client_id=test_client_id");
      expect(response.headers.location).toContain("response_type=code");
      expect(response.headers.location).toContain("scope=read");
    });
  });

  describe("GET /api/v1/auth/strava/callback", () => {
    it("should return 400 when code is missing", async () => {
      const response = await request(app)
        .get("/api/v1/auth/strava/callback")
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe("AUTH_MISSING_CODE");
    });

    it("should return 400 when user denies access", async () => {
      const response = await request(app)
        .get("/api/v1/auth/strava/callback?error=access_denied")
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe("AUTH_DENIED");
      expect(response.body.error).toBe("Authorization denied by user");
    });
  });
});
