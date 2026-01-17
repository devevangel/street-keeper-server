/**
 * Route Aggregator
 * Combines all route modules and mounts them under /api/v1
 */

import { Router } from "express";
import authRoutes from "./auth.routes.js";

const router = Router();

// Mount route modules
router.use("/auth", authRoutes);

// Future routes will be added here:
// router.use("/runs", runRoutes);
// router.use("/goals", goalRoutes);
// router.use("/streets", streetRoutes);

export default router;
