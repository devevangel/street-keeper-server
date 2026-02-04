/**
 * Route Aggregator
 * Combines all route modules and mounts them under /api/v1
 *
 * ROUTE MODULES:
 * --------------
 * | Module     | Path        | Description                          |
 * |------------|-------------|--------------------------------------|
 * | auth       | /auth       | OAuth flows (Strava login)           |
 * | runs       | /runs       | GPX upload and analysis (legacy)     |
 * | webhooks   | /webhooks   | Strava webhook handlers              |
 * | projects   | /projects   | Project CRUD and street tracking     |
 * | activities | /activities | Activity listing and management      |
 * | map       | /map        | Map view (streets with progress)     |
 */

import { Router } from "express";
import authRoutes from "./auth.routes.js";
import runsRoutes from "./runs.routes.js";
import webhooksRoutes from "./webhooks.routes.js";
import projectsRoutes from "./projects.routes.js";
import activitiesRoutes from "./activities.routes.js";
import mapRoutes from "./map.routes.js";

const router = Router();

// Mount route modules
router.use("/auth", authRoutes);
router.use("/runs", runsRoutes);
router.use("/webhooks", webhooksRoutes);
router.use("/projects", projectsRoutes);
router.use("/activities", activitiesRoutes);
router.use("/map", mapRoutes);

export default router;
