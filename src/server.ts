// Load environment variables FIRST (before any other imports that might need them)
import "dotenv/config";

import express, { Application, Request, Response } from "express";
import cors from "cors";
import compression from "compression";
import routes from "./routes/index.js";
import docsRoutes from "./routes/docs.routes.js";
import { API } from "./config/constants.js";
import { startQueue, closeQueue } from "./queues/activity.queue.js";
import { startActivityWorker, stopActivityWorker } from "./workers/activity.worker.js";
import { startSyncWorker, stopSyncWorker } from "./workers/sync.worker.js";

// Initialize Express app
const app: Application = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  })
);
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
  } catch (err) {
    console.error("[Server] Failed to start queue/worker:", err);
    // Continue so API can run in degraded mode (e.g. DISABLE_QUEUE=true)
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
