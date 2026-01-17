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

---

## Tech Stack

| Technology | Purpose | Version |
|------------|---------|---------|
| **Node.js** | Runtime | 20+ |
| **TypeScript** | Language | 5.x |
| **Express 5** | Web framework | 5.x |
| **Prisma** | ORM | 7.x |
| **PostgreSQL** | Database | - |
| **Vitest** | Testing | 4.x |
| **Axios** | HTTP client | 1.x |

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

| Directory | Purpose | Contains |
|-----------|---------|----------|
| `config/` | Static configuration values | Constants, environment helpers |
| `lib/` | Shared singletons and utilities | Database clients, common helpers |
| `middleware/` | Request/response interceptors | Auth, validation, logging middleware |
| `routes/` | HTTP endpoint definitions | Route handlers (thin, delegate to services) |
| `services/` | Business logic | Core application logic, external API calls |
| `types/` | TypeScript interfaces | Request/response types, domain models |
| `tests/` | Automated tests | Unit and integration tests |

---

## File Naming Conventions

### Pattern: `[feature].[layer].ts`

| Layer | Pattern | Example |
|-------|---------|---------|
| Routes | `*.routes.ts` | `auth.routes.ts`, `runs.routes.ts` |
| Services | `*.service.ts` | `auth.service.ts`, `strava.service.ts` |
| Types | `*.types.ts` | `auth.types.ts`, `run.types.ts` |
| Tests | `*.test.ts` | `auth.test.ts`, `strava.test.ts` |
| Middleware | `*.middleware.ts` | `auth.middleware.ts` |
| Config | `*.ts` (descriptive) | `constants.ts`, `database.ts` |

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

| Layer | Can Call | Cannot Call |
|-------|----------|-------------|
| Routes | Services | Database directly |
| Services | Other services, Prisma, External APIs | Routes |
| Data (Prisma) | Database | Services, Routes |

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
  const userData = extractStravaUserData(tokenData);  // Private helper
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
export async function exchangeCodeForTokens(code: string): Promise<StravaTokenResponse> {
  const config = getStravaConfig();

  try {
    const response = await axios.post<StravaTokenResponse>(
      STRAVA.TOKEN_URL,
      new URLSearchParams({ /* params */ }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(`Strava API error: ${error.response?.data?.message || error.message}`);
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

| Category | Purpose | Example |
|----------|---------|---------|
| External API Types | Match third-party API responses | `StravaTokenResponse` |
| Request Types | Query params, body shapes | `StravaCallbackQuery` |
| Response Types | API response shapes | `AuthSuccessResponse`, `ApiErrorResponse` |
| Internal Types | Data transfer between layers | `StravaUserData`, `AuthUser` |
| Config Types | Configuration shapes | `StravaOAuthConfig` |

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
  error: string;      // Human-readable message
  code?: string;      // Machine-readable error code
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
    throw new Error(`Strava API error: ${error.response?.data?.message || error.message}`);
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
      data: { /* update fields */ },
    });
  }

  return prisma.user.create({
    data: { /* create fields */ },
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
import type { StravaCallbackQuery, ApiErrorResponse } from "../types/auth.types.js";
```

### Export Pattern

- **Default export**: For route modules and main entry points
- **Named exports**: For services, utilities, and types

```typescript
// Routes - default export
const router = Router();
export default router;

// Services - named exports
export async function handleStravaCallback(code: string): Promise<AuthUser> { }
export async function getUserById(userId: string): Promise<AuthUser | null> { }

// Types - named exports
export interface AuthUser { }
export interface ApiErrorResponse { }
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

### File Headers

Every file starts with a JSDoc comment explaining its purpose:

```typescript
/**
 * Authentication Routes
 * Handles OAuth flows for Strava (and later Garmin)
 */
```

### Function Documentation

Use JSDoc for exported functions:

```typescript
/**
 * Exchange authorization code for access and refresh tokens
 * Called after user authorizes on Strava
 */
export async function exchangeCodeForTokens(code: string): Promise<StravaTokenResponse> {
  // ...
}

/**
 * Check if a token is expired or will expire soon
 * @param expiresAt - Unix timestamp (seconds) when token expires
 * @returns true if token is expired or will expire within buffer period
 */
export function isTokenExpired(expiresAt: number | Date): boolean {
  // ...
}
```

### Inline Comments

Use sparingly for non-obvious logic:

```typescript
// Token expired, refresh it
try {
  const refreshData = await refreshAccessToken(user.stravaRefreshToken);
  // ...
}

// Convert Unix timestamp to Date
stravaTokenExpiresAt: new Date(expires_at * 1000),
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

## Version History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-17 | 1.0.0 | Initial documentation |
