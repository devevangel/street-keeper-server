# Street Keeper Backend - Coding Patterns & Architecture

This document serves as the single source of truth for coding patterns, conventions, and architecture decisions in the Street Keeper backend. It is designed for both human developers and AI assistants to understand and maintain consistency across the codebase.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [File Naming Conventions](#file-naming-conventions)
4. [TypeScript Patterns](#typescript-patterns)
5. [Architecture Layers](#architecture-layers)
6. [Route Patterns](#route-patterns)
7. [Service Layer Patterns](#service-layer-patterns)
8. [Type Definitions](#type-definitions)
9. [Constants & Configuration](#constants--configuration)
10. [Error Handling](#error-handling)
11. [Database Patterns (Prisma)](#database-patterns-prisma)
12. [Testing Patterns](#testing-patterns)
13. [Import/Export Conventions](#importexport-conventions)
14. [Code Documentation](#code-documentation)
15. [Street Completion Accuracy (Map)](#street-completion-accuracy-map)
16. [Environment Variables](#environment-variables)

---

## Tech Stack

| Technology     | Purpose       | Version |
| -------------- | ------------- | ------- |
| **Node.js**    | Runtime       | 20+     |
| **TypeScript** | Language      | 5.x     |
| **Express 5**  | Web framework | 5.x     |
| **Prisma**     | ORM           | 7.x     |
| **PostgreSQL** | Database      | -       |
| **Vitest**     | Testing       | 4.x     |
| **Axios**      | HTTP client   | 1.x     |

### Key Configuration

- **Module System**: ES Modules (`"type": "module"` in package.json)
- **Import Extensions**: Always include `.js` extension in imports (TypeScript compiles to JS)
- **Strict Mode**: TypeScript strict mode enabled

---

## Project Structure

```
backend/
├── src/
│   ├── config/           # Application constants and configuration
│   │   └── constants.ts  # Centralized constants (API URLs, error codes, etc.)
│   │
│   ├── docs/             # Documentation files
│   │   └── CODING_PATTERNS.md
│   │
│   ├── generated/        # Auto-generated code (Prisma client)
│   │   └── prisma/       # Generated Prisma client (DO NOT EDIT)
│   │
│   ├── lib/              # Shared utilities and client singletons
│   │   └── prisma.ts     # Prisma client singleton
│   │
│   ├── middleware/       # Express middleware functions
│   │   └── (auth.middleware.ts, etc.)
│   │
│   ├── routes/           # Route definitions (thin layer)
│   │   ├── index.ts      # Route aggregator
│   │   └── *.routes.ts   # Feature-specific routes
│   │
│   ├── services/         # Business logic layer
│   │   └── *.service.ts  # Feature-specific services
│   │
│   ├── tests/            # Test files
│   │   └── *.test.ts     # Test files mirror source structure
│   │
│   ├── types/            # TypeScript type definitions
│   │   └── *.types.ts    # Feature-specific types
│   │
│   └── server.ts         # Application entry point
│
├── prisma/
│   └── schema.prisma     # Database schema
│
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### Directory Purposes

| Directory     | Purpose                         | Contains                                    |
| ------------- | ------------------------------- | ------------------------------------------- |
| `config/`     | Static configuration values     | Constants, environment helpers              |
| `lib/`        | Shared singletons and utilities | Database clients, common helpers            |
| `middleware/` | Request/response interceptors   | Auth, validation, logging middleware        |
| `routes/`     | HTTP endpoint definitions       | Route handlers (thin, delegate to services) |
| `services/`   | Business logic                  | Core application logic, external API calls  |
| `types/`      | TypeScript interfaces           | Request/response types, domain models       |
| `tests/`      | Automated tests                 | Unit and integration tests                  |

---

## File Naming Conventions

### Pattern: `[feature].[layer].ts`

| Layer      | Pattern              | Example                                |
| ---------- | -------------------- | -------------------------------------- |
| Routes     | `*.routes.ts`        | `auth.routes.ts`, `runs.routes.ts`     |
| Services   | `*.service.ts`       | `auth.service.ts`, `strava.service.ts` |
| Types      | `*.types.ts`         | `auth.types.ts`, `run.types.ts`        |
| Tests      | `*.test.ts`          | `auth.test.ts`, `strava.test.ts`       |
| Middleware | `*.middleware.ts`    | `auth.middleware.ts`                   |
| Config     | `*.ts` (descriptive) | `constants.ts`, `database.ts`          |

### Rules

1. **Lowercase with dots**: Use lowercase and dots for layer separation
2. **Singular nouns**: Use singular for service/type names (`auth.service.ts` not `auths.service.ts`)
3. **Plural for collections**: Exception for routes representing collections (`runs.routes.ts`)
4. **No index files in feature folders**: Use explicit names, not `index.ts` (except route aggregator)

---

## TypeScript Patterns

### Strict Typing

Always use explicit types. Avoid `any`.

```typescript
// ✅ Good
export async function handleStravaCallback(code: string): Promise<AuthUser> {
  // ...
}

// ❌ Bad
export async function handleStravaCallback(code: any) {
  // ...
}
```

### Interface Naming

- Use `PascalCase` for interface names
- Prefix API response types with the feature name
- Use descriptive names that indicate purpose

```typescript
// ✅ Good - Clear, descriptive names
export interface StravaTokenResponse { ... }
export interface AuthUser { ... }
export interface ApiErrorResponse { ... }

// ❌ Bad - Vague or inconsistent
export interface IUser { ... }        // No "I" prefix
export interface data { ... }         // Too vague, wrong case
```

### Type vs Interface

- **Use `interface`** for object shapes (extendable)
- **Use `type`** for unions, intersections, and aliases

```typescript
// Interface for object shapes
export interface AuthUser {
  id: string;
  name: string;
  email?: string | null;
}

// Type for unions
export type AuthResponse = AuthSuccessResponse | ApiErrorResponse;
```

### Optional vs Nullable

```typescript
// Optional (may not exist)
email?: string;

// Nullable (exists but may be null)
email: string | null;

// Optional AND nullable (common for DB fields)
email?: string | null;
```

### `as const` for Immutable Objects

Use `as const` for configuration objects to get literal types:

```typescript
export const STRAVA = {
  AUTHORIZE_URL: "https://www.strava.com/oauth/authorize",
  TOKEN_URL: "https://www.strava.com/oauth/token",
  TOKEN_REFRESH_BUFFER_SECONDS: 300,
} as const;
```

---

## Architecture Layers

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Routes Layer                          │
│  - HTTP endpoint definitions                                │
│  - Request parsing & validation                             │
│  - Response formatting                                      │
│  - Delegates to services                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Services Layer                         │
│  - Business logic                                           │
│  - External API calls (Strava, Garmin)                      │
│  - Database operations via Prisma                           │
│  - Data transformation                                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Data Layer                            │
│  - Prisma Client (ORM)                                      │
│  - Database models                                          │
└─────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer         | Can Call                              | Cannot Call       |
| ------------- | ------------------------------------- | ----------------- |
| Routes        | Services                              | Database directly |
| Services      | Other services, Prisma, External APIs | Routes            |
| Data (Prisma) | Database                              | Services, Routes  |

---

## Route Patterns

### Route File Structure

```typescript
/**
 * [Feature] Routes
 * [Brief description of what this handles]
 */

import { Router, Request, Response } from "express";
import { someService } from "../services/some.service.js";
import { ERROR_CODES } from "../config/constants.js";
import type { SomeType } from "../types/some.types.js";

const router = Router();

/**
 * HTTP_METHOD /api/v1/[resource]
 * [Description of what this endpoint does]
 */
router.get("/path", async (req: Request, res: Response) => {
  // Implementation
});

export default router;
```

### Route Handler Pattern

Routes should be **thin** - validate input, call service, format response:

```typescript
router.get("/strava/callback", async (req: Request, res: Response) => {
  // 1. Extract and validate input
  const { code, error } = req.query as StravaCallbackQuery;

  // 2. Handle validation errors early
  if (error) {
    return res.status(400).json({
      success: false,
      error: "Authorization denied by user",
      code: ERROR_CODES.AUTH_DENIED,
    });
  }

  try {
    // 3. Delegate to service
    const user = await handleStravaCallback(code);

    // 4. Return success response
    res.status(200).json({
      success: true,
      message: "Authentication successful",
      user,
    });
  } catch (error) {
    // 5. Handle and format errors
    console.error("Strava callback error:", error);
    res.status(500).json({
      success: false,
      error: "Authentication failed",
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
});
```

### Route Aggregation

All routes are aggregated in `routes/index.ts`:

```typescript
import { Router } from "express";
import authRoutes from "./auth.routes.js";

const router = Router();

// Mount route modules under their prefix
router.use("/auth", authRoutes);
// router.use("/runs", runRoutes);
// router.use("/goals", goalRoutes);

export default router;
```

### API Versioning

All routes are mounted under `/api/v1` via the server:

```typescript
// server.ts
app.use(API.PREFIX, routes); // API.PREFIX = "/api/v1"
```

### Authentication Middleware

Protected routes use the `requireAuth` middleware from `middleware/auth.middleware.ts`:

```typescript
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

// Apply to all routes in this router
router.use(requireAuth);

// Or apply to specific routes
router.get("/protected", requireAuth, async (req, res) => {
  // req.user is guaranteed to exist
  const userId = req.user!.id;
});
```

**Middleware exports:**

- `requireAuth` - Requires authentication, returns 401 if not authenticated
- `optionalAuth` - Attaches user if authenticated, continues regardless
- `isAuthenticated(req)` - Type guard to check if request is authenticated

**Request augmentation:**
After `requireAuth`, `req.user` contains:

```typescript
interface AuthenticatedUser {
  id: string; // User UUID
  name: string; // Display name
  email: string | null;
  stravaId: string | null;
  profilePic: string | null;
}
```

**Development mode:**
Use `x-user-id` header for testing without full auth flow:

```bash
curl -H "x-user-id: abc-123" http://localhost:8000/api/v1/routes
```

---

## Service Layer Patterns

### Service File Structure

```typescript
/**
 * [Feature] Service
 * [Brief description of what this handles]
 */

import prisma from "../lib/prisma.js";
import { CONSTANTS } from "../config/constants.js";
import type { SomeType } from "../types/some.types.js";

/**
 * [Description of function purpose]
 */
export async function doSomething(param: string): Promise<ResultType> {
  // Implementation
}

// Private helper functions (not exported)
function helperFunction(data: SomeType): TransformedType {
  // ...
}
```

### Service Function Patterns

1. **Named exports** for public functions
2. **Private functions** are not exported (internal helpers)
3. **Pure functions** when possible (no side effects)
4. **Async/await** for all asynchronous operations

```typescript
// Public function - exported
export async function handleStravaCallback(code: string): Promise<AuthUser> {
  const tokenData = await exchangeCodeForTokens(code);
  const userData = extractStravaUserData(tokenData); // Private helper
  const user = await findOrCreateStravaUser(userData); // Private helper
  return mapToAuthUser(user);
}

// Private helper - not exported
function extractStravaUserData(tokenData: StravaTokenResponse): StravaUserData {
  const { athlete, access_token, refresh_token, expires_at } = tokenData;
  return {
    stravaId: String(athlete.id),
    name: `${athlete.firstname} ${athlete.lastname}`.trim(),
    // ...
  };
}
```

### External API Calls

Use dedicated service files for external APIs (e.g., `strava.service.ts`):

```typescript
/**
 * Exchange authorization code for access and refresh tokens
 */
export async function exchangeCodeForTokens(
  code: string
): Promise<StravaTokenResponse> {
  const config = getStravaConfig();

  try {
    const response = await axios.post<StravaTokenResponse>(
      STRAVA.TOKEN_URL,
      new URLSearchParams({
        /* params */
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(
        `Strava API error: ${error.response?.data?.message || error.message}`
      );
    }
    throw error;
  }
}
```

---

## Type Definitions

### Type File Structure

Organize types with section comments:

```typescript
/**
 * [Feature] Types
 * Single source of truth for all [feature]-related types
 */

// ============================================
// External API Types
// ============================================

export interface StravaAthlete {
  id: number;
  firstname: string;
  // ...
}

// ============================================
// API Response Types
// ============================================

export interface AuthSuccessResponse {
  success: true;
  message: string;
  user: AuthUser;
}

// ============================================
// Internal Types
// ============================================

export interface StravaUserData {
  // ...
}
```

### Type Categories

| Category           | Purpose                         | Example                                   |
| ------------------ | ------------------------------- | ----------------------------------------- |
| External API Types | Match third-party API responses | `StravaTokenResponse`                     |
| Request Types      | Query params, body shapes       | `StravaCallbackQuery`                     |
| Response Types     | API response shapes             | `AuthSuccessResponse`, `ApiErrorResponse` |
| Internal Types     | Data transfer between layers    | `StravaUserData`, `AuthUser`              |
| Config Types       | Configuration shapes            | `StravaOAuthConfig`                       |

---

## Constants & Configuration

### Constants File Pattern

```typescript
/**
 * Application Constants
 * Centralized configuration values
 */

// ============================================
// [Feature] Constants
// ============================================

export const STRAVA = {
  AUTHORIZE_URL: "https://www.strava.com/oauth/authorize",
  TOKEN_URL: "https://www.strava.com/oauth/token",
  DEFAULT_SCOPE: "read,activity:read_all",
  TOKEN_REFRESH_BUFFER_SECONDS: 300,
} as const;

// ============================================
// API Configuration
// ============================================

export const API = {
  VERSION: "v1",
  PREFIX: "/api/v1",
} as const;

// ============================================
// Error Codes
// ============================================

export const ERROR_CODES = {
  AUTH_DENIED: "AUTH_DENIED",
  AUTH_MISSING_CODE: "AUTH_MISSING_CODE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;
```

### Environment Variables

Access environment variables through helper functions:

```typescript
/**
 * Get required environment variable or throw
 */
export function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Get optional environment variable with default
 */
export function getEnvVarOptional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}
```

### Usage

```typescript
// ✅ Good - Use helper function
const clientId = getEnvVar("STRAVA_CLIENT_ID");

// ❌ Bad - Direct access without validation
const clientId = process.env.STRAVA_CLIENT_ID; // Might be undefined
```

---

## Error Handling

### API Error Response Structure

All error responses follow a consistent structure:

```typescript
interface ApiErrorResponse {
  success: false;
  error: string; // Human-readable message
  code?: string; // Machine-readable error code
}
```

### Error Response Examples

```typescript
// Validation error (400)
res.status(400).json({
  success: false,
  error: "Missing authorization code",
  code: ERROR_CODES.AUTH_MISSING_CODE,
});

// Authentication error (401)
res.status(401).json({
  success: false,
  error: "Invalid or expired authorization code",
  code: ERROR_CODES.AUTH_INVALID_CODE,
});

// Server error (500)
res.status(500).json({
  success: false,
  error: "Authentication failed",
  code: ERROR_CODES.INTERNAL_ERROR,
});
```

### Error Handling in Services

Re-throw with meaningful messages:

```typescript
try {
  const response = await axios.post(STRAVA.TOKEN_URL, params);
  return response.data;
} catch (error) {
  if (error instanceof AxiosError) {
    if (error.response?.status === 400) {
      throw new Error("Invalid or expired authorization code");
    }
    throw new Error(
      `Strava API error: ${error.response?.data?.message || error.message}`
    );
  }
  throw error;
}
```

---

## Database Patterns (Prisma)

### Prisma Client Singleton

The Prisma client is a lazy-initialized singleton in `lib/prisma.ts`:

```typescript
import prisma from "../lib/prisma.js";

// Use directly - initialization is handled automatically
const user = await prisma.user.findUnique({
  where: { id: userId },
});
```

### Database Operations Pattern

```typescript
// Find or create pattern
async function findOrCreateStravaUser(userData: StravaUserData) {
  const existingUser = await prisma.user.findUnique({
    where: { stravaId: userData.stravaId },
  });

  if (existingUser) {
    return prisma.user.update({
      where: { id: existingUser.id },
      data: {
        /* update fields */
      },
    });
  }

  return prisma.user.create({
    data: {
      /* create fields */
    },
  });
}
```

### Schema Conventions

```prisma
model User {
  id            String    @id @default(uuid())
  stravaId      String?   @unique
  email         String?   @unique
  name          String

  // Related tokens grouped together
  stravaAccessToken     String?
  stravaRefreshToken    String?
  stravaTokenExpiresAt  DateTime?

  // Timestamps at the end
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```

---

## Testing Patterns

### Test File Structure

```typescript
/**
 * [Feature] Tests
 * Tests [brief description]
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import request from "supertest";
import express from "express";
import featureRoutes from "../routes/feature.routes.js";

// Create isolated test app
const app = express();
app.use(express.json());
app.use("/api/v1/feature", featureRoutes);

describe("US-XXX-XX: Feature Name", () => {
  beforeAll(() => {
    // Setup: mock env vars, etc.
  });

  describe("HTTP_METHOD /api/v1/path", () => {
    it("should [expected behavior]", async () => {
      const response = await request(app)
        .get("/api/v1/feature/endpoint")
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });
});
```

### Test Naming Convention

- **Describe blocks**: Use user story IDs and feature names
- **It blocks**: Use "should [expected behavior]" format

```typescript
describe("US-AUTH-01: Strava Authentication", () => {
  describe("GET /api/v1/auth/strava", () => {
    it("should redirect to Strava authorization URL", async () => {
      // ...
    });

    it("should return 400 when code is missing", async () => {
      // ...
    });
  });
});
```

---

## Import/Export Conventions

### Import Order

1. Node.js built-ins
2. External packages (npm)
3. Internal modules (absolute paths)
4. Relative imports
5. Type imports (last)

```typescript
// 1. Node built-ins (rare in this codebase)
import path from "path";

// 2. External packages
import express, { Router, Request, Response } from "express";
import axios, { AxiosError } from "axios";

// 3. Internal modules
import prisma from "../lib/prisma.js";
import { STRAVA, ERROR_CODES } from "../config/constants.js";

// 4. Relative imports
import { handleStravaCallback } from "../services/auth.service.js";

// 5. Type imports
import type {
  StravaCallbackQuery,
  ApiErrorResponse,
} from "../types/auth.types.js";
```

### Export Pattern

- **Default export**: For route modules and main entry points
- **Named exports**: For services, utilities, and types

```typescript
// Routes - default export
const router = Router();
export default router;

// Services - named exports
export async function handleStravaCallback(code: string): Promise<AuthUser> {}
export async function getUserById(userId: string): Promise<AuthUser | null> {}

// Types - named exports
export interface AuthUser {}
export interface ApiErrorResponse {}
```

### File Extension in Imports

Always use `.js` extension (TypeScript compiles to JS with ES modules):

```typescript
// ✅ Correct
import { buildAuthorizationUrl } from "../services/strava.service.js";

// ❌ Wrong
import { buildAuthorizationUrl } from "../services/strava.service";
import { buildAuthorizationUrl } from "../services/strava.service.ts";
```

---

## Code Documentation

**Philosophy**: Code should be self-documenting where possible, but complex logic, algorithms, and service functions require comprehensive documentation. The goal is for any developer (or AI assistant) to understand the code's purpose, behavior, and edge cases without needing to trace through the implementation.

### File Headers

Every file starts with a detailed JSDoc comment explaining:

1. **Purpose**: What this file/module does
2. **Context**: How it fits into the larger system
3. **Key concepts**: Important algorithms or patterns used
4. **Example usage**: How to use the main exports

```typescript
/**
 * Geometry Cache Service
 * Caches street geometries to reduce Overpass API calls
 *
 * This service provides a caching layer for street geometry data retrieved
 * from OpenStreetMap via Overpass API. Key features:
 *
 * 1. **24-hour TTL**: Cached data expires after 24 hours
 * 2. **Smart key generation**: Cache keys include coordinates and radius
 * 3. **Larger radius filtering**: Can filter cached larger-radius results for smaller requests
 *
 * Cache is stored in PostgreSQL (GeometryCache table) rather than Redis
 * to simplify deployment and because street data is relatively static.
 *
 * @example
 * // Check cache before querying Overpass
 * const cacheKey = generateRadiusCacheKey(50.788, -1.089, 2000);
 * let streets = await getCachedGeometries(cacheKey);
 *
 * if (!streets) {
 *   streets = await queryStreetsInRadius(50.788, -1.089, 2000);
 *   await setCachedGeometries(cacheKey, streets);
 * }
 */
```

### Function Documentation

**All exported functions must have comprehensive JSDoc** that includes:

1. **Description**: What the function does and WHY (not just WHAT)
2. **@param tags**: Each parameter with type and meaning
3. **@returns tag**: What is returned and when
4. **@throws tag**: Errors that can be thrown
5. **@example**: Usage example for complex functions

```typescript
/**
 * Query streets within a radius from a center point
 *
 * Used for creating Routes - queries all streets within a circular area
 * around a center point. This is more appropriate for Routes than bounding
 * box queries because Routes are defined by center + radius.
 *
 * Features:
 * - Queries by radius (circular area) instead of bounding box
 * - Only returns named streets (filters out unnamed roads)
 * - Same retry/fallback logic as bounding box query
 *
 * @param centerLat - Center latitude of the search area
 * @param centerLng - Center longitude of the search area
 * @param radiusMeters - Radius in meters (e.g., 2000 for 2km)
 * @returns Array of OsmStreet objects with name, length, and geometry
 * @throws OverpassError if all API requests fail after retries
 *
 * @example
 * // Query streets within 2km of a point
 * const streets = await queryStreetsInRadius(50.788, -1.089, 2000);
 * // Returns: [
 * //   { osmId: "way/123", name: "High Street", lengthMeters: 450, ... },
 * //   { osmId: "way/456", name: "Park Lane", lengthMeters: 320, ... },
 * // ]
 */
export async function queryStreetsInRadius(
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): Promise<OsmStreet[]> {
  // Implementation...
}
```

### Section Comments

Use visual separators to organize code into logical sections:

```typescript
// ============================================
// Cache Read/Write Operations
// ============================================

/**
 * Get cached geometries by cache key
 * ...
 */
export async function getCachedGeometries(...) { }

/**
 * Store geometries in cache
 * ...
 */
export async function setCachedGeometries(...) { }

// ============================================
// Smart Caching (Larger Radius Filtering)
// ============================================

/**
 * Find a larger cached radius...
 */
export async function findLargerCachedRadius(...) { }
```

### Inline Comments

Use inline comments to explain:

1. **WHY** something is done (not what - the code shows what)
2. **Non-obvious logic** or algorithms
3. **Edge cases** being handled
4. **Magic numbers** or constants
5. **Workarounds** or temporary solutions

```typescript
// Use MAX percentage - never decrease progress even if re-running
// a route that was previously done better
if (update.percentage > street.percentage) {
  street.percentage = update.percentage;
}

// Exponential backoff: 1s, 2s, 4s (max 5s)
// Prevents overwhelming the server during temporary issues
const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);

// Round coordinates to 4 decimal places (~11m accuracy)
// This improves cache hit rates for nearby queries
const precision = GEOMETRY_CACHE.COORD_PRECISION;
```

### Algorithm Documentation

For complex algorithms, include a high-level explanation:

```typescript
/**
 * Two-phase overlap detection for activity-to-route matching
 *
 * ALGORITHM:
 * ---------
 * Phase 1: Bounding Box Check (Fast Filter)
 *   - Calculate activity bounding box (min/max lat/lng)
 *   - Calculate route circular bounds
 *   - If boxes don't overlap → skip route (no match possible)
 *   - This eliminates most routes in O(1) time
 *
 * Phase 2: Point-in-Circle Check (Precise)
 *   - Only for routes that passed Phase 1
 *   - Check if ANY activity point falls within route radius
 *   - Uses Haversine distance for accuracy on Earth's surface
 *
 * PERFORMANCE:
 *   - Without bbox: O(n * m) where n=routes, m=points
 *   - With bbox: O(n) for most cases, O(n * m) worst case
 *   - Typically 10-100x faster for users with many routes
 */
function detectOverlappingRoutes(activity: Activity, routes: Route[]): Route[] {
  // Implementation...
}
```

### Type Documentation

Document interfaces with field-level comments:

```typescript
/**
 * Snapshot of a street's progress within a route
 *
 * Stored in Route.streetsSnapshot JSON field.
 * Progress is tracked as percentage (0-100) of street length covered.
 */
export interface SnapshotStreet {
  /** OSM way ID in format "way/123456789" */
  osmId: string;

  /** Street name from OSM, or "Unnamed Road" */
  name: string;

  /** Total length of this street segment in meters */
  lengthMeters: number;

  /** OSM highway type (residential, footway, etc.) */
  highwayType: string;

  /** True if percentage >= 90% (completion threshold) */
  completed: boolean;

  /** Percentage of street length covered (0-100) */
  percentage: number;

  /** ISO date string of last run on this street, or null */
  lastRunDate: string | null;

  /** True if this street was added in a recent refresh */
  isNew?: boolean;
}
```

### Error Class Documentation

```typescript
/**
 * Error thrown when route is not found
 *
 * This error indicates:
 * - Route ID doesn't exist in database
 * - Route was deleted
 *
 * HTTP Status: 404
 * Error Code: ROUTE_NOT_FOUND
 */
export class RouteNotFoundError extends Error {
  public routeId: string;

  constructor(routeId: string) {
    super(`Route not found: ${routeId}`);
    this.name = "RouteNotFoundError";
    this.routeId = routeId;
  }
}
```

---

## Quick Reference Card

### Creating a New Feature

1. **Types**: Create `src/types/[feature].types.ts`
2. **Service**: Create `src/services/[feature].service.ts`
3. **Routes**: Create `src/routes/[feature].routes.ts`
4. **Register**: Add to `src/routes/index.ts`
5. **Tests**: Create `src/tests/[feature].test.ts`
6. **Constants**: Add any new constants to `src/config/constants.ts`

### Checklist for Code Review

- [ ] Types are explicit (no `any`)
- [ ] Functions have JSDoc comments
- [ ] Errors use `ERROR_CODES` constants
- [ ] Routes delegate to services (thin controllers)
- [ ] Imports use `.js` extension
- [ ] New constants added to `constants.ts`
- [ ] Tests follow naming convention

---

## Street Completion Accuracy (Map)

The map shows streets as **completed** (green) or **partial** (yellow). To avoid marking a whole street green when only one segment was fully run, we use two tiers:

1. **Segment-level (per polyline):** Each OSM segment’s color is based on **current** `percentage` only: completed if ≥ `STREET_MATCHING.COMPLETION_THRESHOLD` (90%), else partial. Do not use `everCompleted` for display.

2. **Street-level (aggregated list):** Streets with the same name are grouped in `map.service.ts` (`aggregateStreetsByName`). Completion is **length-weighted**: each segment contributes `(percentage/100) × weight`, where weight is `lengthMeters × (CONNECTOR_WEIGHT if connector else 1)`. Segments with `lengthMeters <= CONNECTOR_MAX_LENGTH_METERS` are connectors. Street status is completed only if `weightedCompletionRatio >= STREET_COMPLETION_THRESHOLD` (95%).

Constants: `STREET_AGGREGATION.STREET_COMPLETION_THRESHOLD`, `CONNECTOR_MAX_LENGTH_METERS`, `CONNECTOR_WEIGHT`; segment threshold `STREET_MATCHING.COMPLETION_THRESHOLD`. See [MAP_FEATURE.md](MAP_FEATURE.md#completion-status-two-tier-logic) and [ARCHITECTURE.md](ARCHITECTURE.md#5-90-threshold-for-street-completion).

---

## Environment Variables

### Required Environment Variables

| Variable       | Description                  | Example                                    |
| -------------- | ---------------------------- | ------------------------------------------ |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/db` |

### Optional Environment Variables

| Variable                      | Description                   | Default                      | Notes                                       |
| ----------------------------- | ----------------------------- | ---------------------------- | ------------------------------------------- |
| `PORT`                        | Server port                   | `8000`                       |                                             |
| `NODE_ENV`                    | Environment                   | `development`                | `development`, `production`, `test`         |
| `STRAVA_CLIENT_ID`            | Strava OAuth client ID        | -                            | Required for Strava integration             |
| `STRAVA_CLIENT_SECRET`        | Strava OAuth client secret    | -                            | Required for Strava integration             |
| `STRAVA_REDIRECT_URI`         | Strava OAuth callback URL     | -                            | Required for Strava integration             |
| `MAPBOX_ACCESS_TOKEN`         | Mapbox API access token       | -                            | Enables high-accuracy GPS matching          |
| `DISABLE_QUEUE`               | Disable job queue             | `false`                      | Set to `true` to run without job processing |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | Webhook verification token    | `street-keeper-verify-token` | Set when creating Strava subscription       |
| `BASE_URL`                    | Public base URL of the server | `http://localhost:8000`      | Used for webhook callback URL               |

### Mapbox Configuration

The Mapbox Map Matching API provides high-accuracy GPS trace matching (~98% accuracy compared to ~85% with Overpass-only matching).

**How to get a Mapbox token:**

1. Sign up at https://account.mapbox.com/
2. Go to Access Tokens page
3. Create a new token (default public scope is fine)
4. Copy the token starting with `pk.`

**Free tier limits:**

- 100,000 requests/month
- Sufficient for ~3,300 GPX uploads/day

**Fallback behavior:**

If `MAPBOX_ACCESS_TOKEN` is not set, the application automatically falls back to Overpass-only matching. This means:

- No error is thrown
- Street matching still works
- Accuracy is slightly lower (~85% vs ~98%)

**Example `.env` file:**

```env
# Required
DATABASE_URL="postgresql://user:password@localhost:5432/street_keeper"

# Optional but recommended
MAPBOX_ACCESS_TOKEN=pk.your_mapbox_access_token_here

# Optional (for Strava integration)
STRAVA_CLIENT_ID=your_client_id
STRAVA_CLIENT_SECRET=your_client_secret
STRAVA_REDIRECT_URI=http://localhost:8000/api/v1/auth/strava/callback

# Optional (for webhook integration)
STRAVA_WEBHOOK_VERIFY_TOKEN=street-keeper-verify-token
BASE_URL=http://localhost:8000
```

### Job Queue Configuration (pg-boss)

Activity processing uses pg-boss for asynchronous job queuing. pg-boss stores jobs in PostgreSQL, so **no additional infrastructure is needed** - it uses the same database as Prisma.

**How it works:**

1. When Strava sends a webhook notification, we queue a job immediately
2. The webhook returns within 2 seconds (Strava requirement)
3. The worker picks up the job and processes it in the background
4. pg-boss handles retries, deduplication, and job cleanup

**Schema creation:**

pg-boss automatically creates a `pgboss` schema in your database on first run. This is separate from your app's tables and doesn't interfere with Prisma migrations.

**Disabling the queue:**

Set `DISABLE_QUEUE=true` to run without job processing (useful for testing routes without webhook functionality).

---

## Version History

| Date       | Version | Changes                                                                 |
| ---------- | ------- | ----------------------------------------------------------------------- |
| 2026-01-20 | 1.4.0   | Replaced BullMQ/Redis with pg-boss (PostgreSQL-based queue)             |
| 2026-01-20 | 1.3.0   | Added Redis/BullMQ configuration documentation                          |
| 2026-01-19 | 1.2.0   | Expanded Code Documentation section with comprehensive JSDoc guidelines |
| 2026-01-18 | 1.1.0   | Added Mapbox integration documentation                                  |
| 2026-01-17 | 1.0.0   | Initial documentation                                                   |
