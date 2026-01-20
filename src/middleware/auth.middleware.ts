/**
 * Authentication Middleware
 * Protects routes that require an authenticated user
 * 
 * AUTHENTICATION FLOW:
 * --------------------
 * 
 * This middleware validates that requests come from authenticated users.
 * Currently supports:
 * 
 * 1. **Development mode**: Uses `x-user-id` header for testing
 * 2. **Production mode**: Will use JWT tokens (to be implemented)
 * 
 * When authentication succeeds, the user object is attached to `req.user`
 * for use by downstream route handlers.
 * 
 * ```
 * Request arrives
 *       │
 *       ▼
 * ┌─────────────────────┐
 * │ Check for auth      │
 * │ header/token        │
 * └─────────────────────┘
 *       │
 *       ▼
 * ┌─────────────────────┐
 * │ Validate & lookup   │
 * │ user in database    │
 * └─────────────────────┘
 *       │
 *       ▼
 * ┌─────────────────────┐
 * │ Attach user to      │
 * │ req.user            │
 * └─────────────────────┘
 *       │
 *       ▼
 * [Continue to route handler]
 * ```
 * 
 * USAGE:
 * ------
 * 
 * ```typescript
 * // Protect a single route
 * router.get("/protected", requireAuth, (req, res) => {
 *   const user = req.user!; // User is guaranteed to exist
 *   res.json({ userId: user.id });
 * });
 * 
 * // Protect all routes in a router
 * router.use(requireAuth);
 * router.get("/routes", listRoutes);
 * router.post("/routes", createRoute);
 * ```
 * 
 * @module middleware/auth
 */

import { Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma.js";
import { ERROR_CODES } from "../config/constants.js";

// ============================================
// Type Extensions
// ============================================

/**
 * Authenticated user data attached to request
 * 
 * Contains essential user information needed by route handlers.
 * Excludes sensitive data like tokens.
 */
export interface AuthenticatedUser {
  /** User's unique ID (UUID) */
  id: string;
  /** User's display name */
  name: string;
  /** User's email (if available) */
  email: string | null;
  /** User's Strava athlete ID (if connected) */
  stravaId: string | null;
  /** URL to user's profile picture */
  profilePic: string | null;
}

/**
 * Express Request with authenticated user
 * 
 * After passing through requireAuth middleware, requests
 * will have a `user` property with the authenticated user's data.
 */
export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

// Extend Express Request type globally
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

// ============================================
// Authentication Middleware
// ============================================

/**
 * Require authentication middleware
 * 
 * Validates that the request comes from an authenticated user.
 * If valid, attaches user data to `req.user` and calls `next()`.
 * If invalid, returns a 401 Unauthorized response.
 * 
 * **Development Mode:**
 * Accepts `x-user-id` header containing the user's UUID.
 * This makes testing easier without full auth flow.
 * 
 * **Production Mode (TODO):**
 * Will validate JWT tokens from Authorization header.
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Next middleware function
 * 
 * @example
 * // Protect a route
 * router.get("/profile", requireAuth, (req, res) => {
 *   res.json({ user: req.user });
 * });
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Get user ID from header (development) or JWT (production - TODO)
    const userId = getUserIdFromRequest(req);

    if (!userId) {
      res.status(401).json({
        success: false,
        error: "Authentication required",
        code: ERROR_CODES.AUTH_REQUIRED,
      });
      return;
    }

    // Look up user in database
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        stravaId: true,
        profilePic: true,
      },
    });

    if (!user) {
      res.status(401).json({
        success: false,
        error: "User not found",
        code: ERROR_CODES.AUTH_REQUIRED,
      });
      return;
    }

    // Attach user to request
    req.user = user;

    next();
  } catch (error) {
    console.error("[Auth] Middleware error:", error);
    res.status(500).json({
      success: false,
      error: "Authentication error",
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
}

/**
 * Optional authentication middleware
 * 
 * Similar to requireAuth, but doesn't fail if no auth is provided.
 * Useful for routes that work for both authenticated and anonymous users,
 * but provide enhanced features for authenticated users.
 * 
 * If valid auth is provided, attaches user to `req.user`.
 * If no auth is provided, `req.user` will be undefined.
 * Always calls `next()` (never returns 401).
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Next middleware function
 * 
 * @example
 * // Route that works for everyone, but shows more data for logged-in users
 * router.get("/public-routes", optionalAuth, (req, res) => {
 *   if (req.user) {
 *     // Show user's own routes too
 *   }
 *   // Show public routes
 * });
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserIdFromRequest(req);

    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          stravaId: true,
          profilePic: true,
        },
      });

      if (user) {
        req.user = user;
      }
    }

    next();
  } catch (error) {
    // Don't fail on errors - just continue without user
    console.error("[Auth] Optional auth error:", error);
    next();
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Extract user ID from request
 * 
 * Currently supports:
 * - `x-user-id` header (for development/testing)
 * - TODO: JWT token from `Authorization: Bearer <token>` header
 * 
 * @param req - Express request object
 * @returns User ID string or null if not found
 */
function getUserIdFromRequest(req: Request): string | null {
  // Development: Check x-user-id header
  const userIdHeader = req.headers["x-user-id"];
  if (typeof userIdHeader === "string" && userIdHeader.length > 0) {
    return userIdHeader;
  }

  // TODO: Production - Check JWT token
  // const authHeader = req.headers.authorization;
  // if (authHeader?.startsWith("Bearer ")) {
  //   const token = authHeader.slice(7);
  //   const decoded = verifyJwtToken(token);
  //   return decoded?.userId ?? null;
  // }

  return null;
}

/**
 * Type guard to check if request is authenticated
 * 
 * Useful in route handlers to narrow the type of `req`
 * when using optionalAuth middleware.
 * 
 * @param req - Express request object
 * @returns True if req.user is defined
 * 
 * @example
 * router.get("/data", optionalAuth, (req, res) => {
 *   if (isAuthenticated(req)) {
 *     // TypeScript knows req.user exists here
 *     const userId = req.user.id;
 *   }
 * });
 */
export function isAuthenticated(req: Request): req is AuthenticatedRequest {
  return req.user !== undefined;
}
