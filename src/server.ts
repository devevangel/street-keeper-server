// Load environment variables FIRST (before any other imports that might need them)
import "dotenv/config";

import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import compression from "compression";
import routes from "./routes/index.js";
import docsRoutes from "./routes/docs.routes.js";
import { API } from "./config/constants.js";
import { startQueue, closeQueue } from "./queues/activity.queue.js";
import {
  startActivityWorker,
  stopActivityWorker,
} from "./workers/activity.worker.js";
import { startSyncWorker, stopSyncWorker } from "./workers/sync.worker.js";
import { startCitySyncWorker } from "./workers/city-sync.worker.js";
import { startGpxAnalyzeWorker } from "./workers/gpx-analyze.worker.js";
import prisma from "./lib/prisma.js";

// Initialize Express app
const app: Application = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger — logs method, path, status, and duration for every request
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    const color = status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : "\x1b[32m";
    const reset = "\x1b[0m";
    console.log(`${color}${req.method} ${req.path} → ${status}${reset} (${ms}ms)`);
  });
  next();
});

// Documentation Routes (mounted before API for /docs prefix)
app.use("/docs", docsRoutes);

// API Routes
app.use(API.PREFIX, routes);

// Health check route
app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "healthy",
    message: "Street Keeper API is running! Hot reload works! 🔥",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// Root route
app.get("/", (req: Request, res: Response) => {
  res.json({
    message: "Welcome to Street Keeper API",
    version: "1.0.0",
    documentation: "/docs",
    endpoints: {
      health: "/health",
      docs: "/docs",
      api: "/docs/api",
      auth: {
        strava: "/api/v1/auth/strava",
        stravaCallback: "/api/v1/auth/strava/callback",
      },
    },
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: "Route not found",
    path: req.path,
  });
});

// Start queue and workers, then HTTP server
async function main(): Promise<void> {
  try {
    await startQueue();
    await startActivityWorker();
    await startSyncWorker();
    await startCitySyncWorker();
    await startGpxAnalyzeWorker();
  } catch (err) {
    console.error("[Server] Failed to start queue/worker:", err);
    // Continue so API can run in degraded mode (e.g. DISABLE_QUEUE=true)
  }

  try {
    const [row] = await prisma.$queryRaw<
      Array<{
        synced_cities: bigint;
        streets_with_geometry: bigint;
        streets_without_geometry: bigint;
      }>
    >`
      SELECT
        (SELECT COUNT(*)::bigint FROM "CitySync") AS "synced_cities",
        (SELECT COUNT(*)::bigint FROM "WayTotalEdges" WHERE "geometry" IS NOT NULL) AS "streets_with_geometry",
        (SELECT COUNT(*)::bigint FROM "WayTotalEdges" WHERE "geometry" IS NULL) AS "streets_without_geometry"
    `;
    console.log(
      `[PostGIS] Coverage: ${row.synced_cities} synced cities; ` +
        `${row.streets_with_geometry} ways with geometry, ${row.streets_without_geometry} without`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[PostGIS] Startup coverage query skipped:", msg);
  }

  // Self-heal: mark orphaned sync jobs (server crashed/restarted mid-processing) as failed
  // so the UI doesn't show "Syncing X/Y" forever and new syncs can start.
  try {
    const orphaned = await prisma.syncJob.updateMany({
      where: { status: { in: ["queued", "running"] } },
      data: {
        status: "failed",
        lastErrorMessage: "Server restarted while job was in progress",
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    if (orphaned.count > 0) {
      console.log(`[Startup] Marked ${orphaned.count} orphaned sync jobs as failed`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Startup] Orphaned job cleanup skipped:", msg);
  }

  // Self-heal: reset activities marked processed but with zero node hits
  // (caused by V2 failures e.g. Overpass outages). They'll be reprocessed on next sync.
  try {
    const healed = await prisma.$executeRaw`
      UPDATE "Activity" SET "isProcessed" = false, "processedAt" = NULL
      WHERE "isProcessed" = true
        AND "id" NOT IN (SELECT DISTINCT "activityId" FROM "ProjectActivity")
        AND "userId" NOT IN (SELECT DISTINCT "userId" FROM "UserNodeHit")
    `;
    if (healed > 0) {
      console.log(`[Startup] Reset ${healed} activities with no node hits back to unprocessed`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Startup] Self-heal query skipped:", msg);
  }

  const server = app.listen(PORT, () => {
    console.log("🚀 Server is running!");
    console.log(`📍 Port: ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
    console.log(`🔗 URL: http://localhost:${PORT}`);
    console.log("✅ Press CTRL+C to stop\n");
  });

  const shutdown = async (): Promise<void> => {
    console.log("\n[Server] Shutting down...");
    server.close(() => {
      stopSyncWorker()
        .then(() => stopActivityWorker())
        .then(() => closeQueue())
        .then(() => {
          console.log("[Server] Goodbye.");
          process.exit(0);
        })
        .catch((err) => {
          console.error("[Server] Shutdown error:", err);
          process.exit(1);
        });
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

void main();

export default app;
