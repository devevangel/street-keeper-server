# Error Reference

This document lists all error codes used by the Street Keeper API, their HTTP status mappings, and handling recommendations.

## Table of Contents

1. [Error Response Structure](#error-response-structure)
2. [Error Codes by Category](#error-codes-by-category)
3. [HTTP Status Code Mapping](#http-status-code-mapping)
4. [Error Handling Best Practices](#error-handling-best-practices)

---

## Error Response Structure

All error responses follow a consistent structure:

```typescript
interface ApiErrorResponse {
  success: false;
  error: string; // Human-readable error message
  code?: string; // Machine-readable error code
}
```

**Example:**

```json
{
  "success": false,
  "error": "Project not found",
  "code": "PROJECT_NOT_FOUND"
}
```

---

## Error Codes by Category

### Authentication Errors

| Code                 | HTTP | Description                              | When It Occurs                                       |
| -------------------- | ---- | ---------------------------------------- | ---------------------------------------------------- |
| `AUTH_DENIED`        | 400  | User denied OAuth access                 | User clicked "Deny" on Strava authorization page     |
| `AUTH_MISSING_CODE`  | 400  | No authorization code in callback        | Strava callback URL missing `code` parameter         |
| `AUTH_INVALID_CODE`  | 401  | Authorization code is invalid or expired | Code already used or expired (codes are single-use)  |
| `AUTH_TOKEN_EXPIRED` | 401  | Access token has expired                 | Token needs refresh (automatic in most cases)        |
| `AUTH_CONFIG_ERROR`  | 500  | Server OAuth configuration error         | Missing `STRAVA_CLIENT_ID` or `STRAVA_CLIENT_SECRET` |
| `AUTH_REQUIRED`      | 401  | Authentication required                  | Request to protected endpoint without auth header    |

### Project Errors

| Code                     | HTTP | Description                      | When It Occurs                               |
| ------------------------ | ---- | -------------------------------- | -------------------------------------------- |
| `PROJECT_NOT_FOUND`      | 404  | Project does not exist           | Invalid project ID or project was deleted    |
| `PROJECT_INVALID_RADIUS` | 400  | Invalid radius value             | Radius not in [500, 1000, 2000, 5000, 10000] |
| `PROJECT_NO_STREETS`     | 400  | No streets found in area         | Selected area has no mapped streets in OSM   |
| `PROJECT_ACCESS_DENIED`  | 403  | Not authorized to access project | Trying to access another user's project      |

### Activity Errors

| Code                         | HTTP | Description                | When It Occurs                                  |
| ---------------------------- | ---- | -------------------------- | ----------------------------------------------- |
| `ACTIVITY_NOT_FOUND`         | 404  | Activity does not exist    | Invalid activity ID or access denied            |
| `ACTIVITY_ALREADY_EXISTS`    | 409  | Activity already processed | Duplicate webhook event or re-sync attempt      |
| `ACTIVITY_PROCESSING_FAILED` | 500  | Failed to process activity | Error during street matching or progress update |

### GPX Errors

| Code                  | HTTP | Description                 | When It Occurs                           |
| --------------------- | ---- | --------------------------- | ---------------------------------------- |
| `GPX_FILE_REQUIRED`   | 400  | No GPX file provided        | Missing file in multipart form           |
| `GPX_PARSE_ERROR`     | 400  | Failed to parse GPX file    | Invalid XML or unsupported GPX format    |
| `GPX_INVALID_FORMAT`  | 400  | GPX file has invalid format | GPX parsed but missing required elements |
| `GPX_NO_TRACK_POINTS` | 400  | GPX has no track points     | File has no `<trkpt>` elements           |
| `GPX_FILE_TOO_LARGE`  | 400  | GPX file exceeds size limit | File larger than 10MB                    |

### External API Errors

| Code                          | HTTP | Description                    | When It Occurs                                |
| ----------------------------- | ---- | ------------------------------ | --------------------------------------------- |
| `OVERPASS_API_ERROR`          | 502  | OpenStreetMap API error        | Overpass timeout, rate limit, or server error |
| `MAPBOX_API_ERROR`            | 502  | Mapbox API error               | Mapbox rate limit or server error             |
| `STRAVA_API_ERROR`            | 502  | Strava API error               | Strava rate limit or server error             |
| `STRAVA_TOKEN_REFRESH_FAILED` | 500  | Failed to refresh Strava token | Refresh token invalid or Strava API down      |

### Webhook Errors

| Code                          | HTTP | Description                 | When It Occurs                                 |
| ----------------------------- | ---- | --------------------------- | ---------------------------------------------- |
| `WEBHOOK_INVALID_SIGNATURE`   | 400  | Invalid webhook payload     | Malformed or missing required fields           |
| `WEBHOOK_VERIFICATION_FAILED` | 403  | Webhook verification failed | Invalid verify token during subscription setup |

### General Errors

| Code               | HTTP | Description               | When It Occurs                            |
| ------------------ | ---- | ------------------------- | ----------------------------------------- |
| `VALIDATION_ERROR` | 400  | Request validation failed | Invalid request parameters or body        |
| `NOT_FOUND`        | 404  | Resource not found        | Generic not found (prefer specific codes) |
| `INTERNAL_ERROR`   | 500  | Internal server error     | Unexpected error (check server logs)      |

---

## HTTP Status Code Mapping

| HTTP Status                   | Error Codes                                                                                                                                  | Meaning                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **400 Bad Request**           | `AUTH_DENIED`, `AUTH_MISSING_CODE`, `PROJECT_INVALID_RADIUS`, `PROJECT_NO_STREETS`, `GPX_*`, `VALIDATION_ERROR`, `WEBHOOK_INVALID_SIGNATURE` | Client error - fix the request    |
| **401 Unauthorized**          | `AUTH_INVALID_CODE`, `AUTH_TOKEN_EXPIRED`, `AUTH_REQUIRED`                                                                                   | Authentication required or failed |
| **403 Forbidden**             | `PROJECT_ACCESS_DENIED`, `WEBHOOK_VERIFICATION_FAILED`                                                                                       | Authenticated but not authorized  |
| **404 Not Found**             | `PROJECT_NOT_FOUND`, `ACTIVITY_NOT_FOUND`, `NOT_FOUND`                                                                                       | Resource doesn't exist            |
| **409 Conflict**              | `ACTIVITY_ALREADY_EXISTS`                                                                                                                    | Resource state conflict           |
| **500 Internal Server Error** | `AUTH_CONFIG_ERROR`, `STRAVA_TOKEN_REFRESH_FAILED`, `ACTIVITY_PROCESSING_FAILED`, `INTERNAL_ERROR`                                           | Server error - retry or report    |
| **502 Bad Gateway**           | `OVERPASS_API_ERROR`, `MAPBOX_API_ERROR`, `STRAVA_API_ERROR`                                                                                 | External service error - retry    |

---

## Error Handling Best Practices

### Frontend Implementation

```typescript
import { ApiError } from "./api-client";

async function fetchProjects() {
  try {
    const projects = await projectsService.getAll();
    return projects;
  } catch (error) {
    if (error instanceof ApiError) {
      switch (error.code) {
        case "AUTH_REQUIRED":
          // Redirect to login
          window.location.href = "/login";
          break;

        case "PROJECT_NOT_FOUND":
          // Show "project not found" message
          showError("This project no longer exists.");
          break;

        case "OVERPASS_API_ERROR":
          // External service down - suggest retry
          showError(
            "Street data service is temporarily unavailable. Please try again in a few minutes."
          );
          break;

        default:
          // Generic error handling
          showError(error.message);
      }
    }
  }
}
```

### Error Code Checking

```typescript
// Check error category by code prefix
function getErrorCategory(code: string): string {
  if (code.startsWith("AUTH_")) return "authentication";
  if (code.startsWith("PROJECT_")) return "project";
  if (code.startsWith("ACTIVITY_")) return "activity";
  if (code.startsWith("GPX_")) return "gpx";
  if (code.includes("API_ERROR")) return "external";
  return "general";
}

// Check if error is retryable
function isRetryable(code: string): boolean {
  const retryableCodes = [
    "OVERPASS_API_ERROR",
    "MAPBOX_API_ERROR",
    "STRAVA_API_ERROR",
    "INTERNAL_ERROR",
  ];
  return retryableCodes.includes(code);
}
```

### User-Friendly Messages

Map error codes to user-friendly messages:

```typescript
const errorMessages: Record<string, string> = {
  // Auth
  AUTH_DENIED: "You denied access. Please try logging in again.",
  AUTH_REQUIRED: "Please log in to continue.",
  AUTH_TOKEN_EXPIRED: "Your session has expired. Please log in again.",

  // Projects
  PROJECT_NOT_FOUND: "This project no longer exists.",
  PROJECT_ACCESS_DENIED: "You do not have access to this project.",
  PROJECT_NO_STREETS:
    "No streets found in this area. Try a different location.",
  PROJECT_INVALID_RADIUS: "Please select a valid radius.",

  // GPX
  GPX_FILE_REQUIRED: "Please select a GPX file to upload.",
  GPX_PARSE_ERROR: "Could not read the GPX file. Please check the file format.",
  GPX_FILE_TOO_LARGE: "File is too large. Maximum size is 10MB.",

  // External APIs
  OVERPASS_API_ERROR:
    "Street data service is temporarily unavailable. Please try again.",
  STRAVA_API_ERROR: "Could not connect to Strava. Please try again.",

  // Default
  INTERNAL_ERROR: "Something went wrong. Please try again.",
};

function getErrorMessage(code: string, fallback: string): string {
  return errorMessages[code] || fallback;
}
```

### Retry Logic

For retryable errors (502 status), implement exponential backoff:

```typescript
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Only retry on 502 errors
      if (error instanceof ApiError && error.status !== 502) {
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}
```
