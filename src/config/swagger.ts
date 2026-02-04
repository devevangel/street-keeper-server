/**
 * OpenAPI/Swagger Configuration
 * Defines the API specification and all reusable schemas
 *
 * This configuration is used by swagger-jsdoc to generate the OpenAPI spec
 * and swagger-ui-express to serve the interactive API documentation.
 */

import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.1.0",
    info: {
      title: "Street Keeper API",
      version: "1.0.0",
      description: `
# Street Keeper API

A fitness tracking API that processes GPS data from Strava to track street coverage for runners.

## Overview

Street Keeper helps runners track which streets they've run in their local area. It integrates with Strava to automatically process activities and calculate street coverage progress.

## Authentication

Most endpoints require authentication. In development, use the \`x-user-id\` header with a valid user UUID.

\`\`\`bash
curl -H "x-user-id: your-user-id" http://localhost:8000/api/v1/routes
\`\`\`

In production, authentication is handled via Strava OAuth.

## Rate Limits

- No rate limits in development
- Production limits TBD
      `,
      contact: {
        name: "Street Keeper Team",
      },
      license: {
        name: "MIT",
      },
    },
    servers: [
      {
        url: "http://localhost:8000/api/v1",
        description: "Development server",
      },
    ],
    tags: [
      { name: "Auth", description: "Authentication endpoints (Strava OAuth)" },
      { name: "Routes", description: "Route CRUD and street tracking" },
      { name: "Activities", description: "Activity listing and management" },
      { name: "GPX", description: "GPX file upload and analysis" },
      { name: "Webhooks", description: "Strava webhook handlers" },
      {
        name: "Map",
        description: "Map view (streets with progress and geometry)",
      },
    ],
    components: {
      securitySchemes: {
        DevAuth: {
          type: "apiKey",
          in: "header",
          name: "x-user-id",
          description: "Development authentication - pass user UUID in header",
        },
      },
      schemas: {
        // ============================================
        // Common Schemas
        // ============================================

        ApiErrorResponse: {
          type: "object",
          required: ["success", "error"],
          properties: {
            success: { type: "boolean", enum: [false] },
            error: {
              type: "string",
              description: "Human-readable error message",
            },
            code: {
              type: "string",
              description: "Machine-readable error code",
            },
          },
          example: {
            success: false,
            error: "Route not found",
            code: "ROUTE_NOT_FOUND",
          },
        },

        // ============================================
        // Auth Schemas
        // ============================================

        AuthUser: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "string", format: "uuid", description: "User UUID" },
            name: { type: "string", description: "Display name" },
            email: { type: "string", format: "email", nullable: true },
            stravaId: {
              type: "string",
              nullable: true,
              description: "Strava athlete ID",
            },
            garminId: {
              type: "string",
              nullable: true,
              description: "Garmin user ID",
            },
            profilePic: { type: "string", format: "uri", nullable: true },
          },
          example: {
            id: "550e8400-e29b-41d4-a716-446655440000",
            name: "John Runner",
            email: "john@example.com",
            stravaId: "12345678",
            profilePic:
              "https://dgalywyr863hv.cloudfront.net/pictures/athletes/12345678/large.jpg",
          },
        },

        AuthSuccessResponse: {
          type: "object",
          required: ["success", "message", "user"],
          properties: {
            success: { type: "boolean", enum: [true] },
            message: { type: "string" },
            user: { $ref: "#/components/schemas/AuthUser" },
          },
        },

        // ============================================
        // Route Schemas
        // ============================================

        SnapshotStreet: {
          type: "object",
          required: [
            "osmId",
            "name",
            "lengthMeters",
            "highwayType",
            "completed",
            "percentage",
          ],
          properties: {
            osmId: {
              type: "string",
              description: "OSM way ID (e.g., 'way/123456789')",
            },
            name: { type: "string", description: "Street name from OSM" },
            lengthMeters: {
              type: "number",
              description: "Total street length in meters",
            },
            highwayType: {
              type: "string",
              description: "OSM highway type (residential, footway, etc.)",
            },
            completed: {
              type: "boolean",
              description: "True if percentage >= 90%",
            },
            percentage: {
              type: "number",
              minimum: 0,
              maximum: 100,
              description: "Coverage percentage (0-100)",
            },
            lastRunDate: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            isNew: {
              type: "boolean",
              description: "True if added during recent refresh",
            },
          },
          example: {
            osmId: "way/123456789",
            name: "High Street",
            lengthMeters: 450.5,
            highwayType: "residential",
            completed: true,
            percentage: 95.2,
            lastRunDate: "2024-01-15T08:30:00.000Z",
          },
        },

        RouteListItem: {
          type: "object",
          required: [
            "id",
            "name",
            "centerLat",
            "centerLng",
            "radiusMeters",
            "progress",
            "totalStreets",
            "completedStreets",
          ],
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            centerLat: { type: "number", minimum: -90, maximum: 90 },
            centerLng: { type: "number", minimum: -180, maximum: 180 },
            radiusMeters: {
              type: "integer",
              enum: [500, 1000, 2000, 5000, 10000],
            },
            progress: {
              type: "number",
              minimum: 0,
              maximum: 100,
              description: "Overall progress percentage",
            },
            totalStreets: { type: "integer" },
            completedStreets: { type: "integer" },
            totalLengthMeters: { type: "number" },
            deadline: { type: "string", format: "date-time", nullable: true },
            isArchived: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },

        RouteDetail: {
          allOf: [
            { $ref: "#/components/schemas/RouteListItem" },
            {
              type: "object",
              required: ["streets", "snapshotDate"],
              properties: {
                streets: {
                  type: "array",
                  items: { $ref: "#/components/schemas/SnapshotStreet" },
                },
                snapshotDate: { type: "string", format: "date-time" },
                inProgressCount: {
                  type: "integer",
                  description: "Streets with 1-89% coverage",
                },
                notStartedCount: {
                  type: "integer",
                  description: "Streets with 0% coverage",
                },
                refreshNeeded: { type: "boolean" },
                daysSinceRefresh: { type: "integer" },
              },
            },
          ],
        },

        RoutePreview: {
          type: "object",
          required: [
            "centerLat",
            "centerLng",
            "radiusMeters",
            "totalStreets",
            "totalLengthMeters",
            "cacheKey",
          ],
          properties: {
            centerLat: { type: "number" },
            centerLng: { type: "number" },
            radiusMeters: { type: "integer" },
            cachedRadiusMeters: {
              type: "integer",
              description: "Actual radius in cache (may be larger)",
            },
            cacheKey: {
              type: "string",
              description: "Pass to create endpoint to skip re-query",
            },
            totalStreets: { type: "integer" },
            totalLengthMeters: { type: "number" },
            streetsByType: {
              type: "object",
              additionalProperties: { type: "integer" },
              description: "Street count by highway type",
            },
            warnings: {
              type: "array",
              items: { type: "string" },
            },
          },
        },

        CreateRouteRequest: {
          type: "object",
          required: ["name", "centerLat", "centerLng", "radiusMeters"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 100 },
            centerLat: { type: "number", minimum: -90, maximum: 90 },
            centerLng: { type: "number", minimum: -180, maximum: 180 },
            radiusMeters: {
              type: "integer",
              enum: [500, 1000, 2000, 5000, 10000],
            },
            deadline: { type: "string", format: "date-time" },
            cacheKey: {
              type: "string",
              description: "Optional cache key from preview",
            },
          },
          example: {
            name: "Southsea Explorer",
            centerLat: 50.788,
            centerLng: -1.089,
            radiusMeters: 2000,
          },
        },

        RouteListResponse: {
          type: "object",
          required: ["success", "routes", "total"],
          properties: {
            success: { type: "boolean", enum: [true] },
            routes: {
              type: "array",
              items: { $ref: "#/components/schemas/RouteListItem" },
            },
            total: { type: "integer" },
          },
        },

        RouteDetailResponse: {
          type: "object",
          required: ["success", "route"],
          properties: {
            success: { type: "boolean", enum: [true] },
            route: { $ref: "#/components/schemas/RouteDetail" },
            warning: {
              type: "string",
              description: "Optional warning message",
            },
          },
        },

        RoutePreviewResponse: {
          type: "object",
          required: ["success", "preview"],
          properties: {
            success: { type: "boolean", enum: [true] },
            preview: { $ref: "#/components/schemas/RoutePreview" },
          },
        },

        // ============================================
        // Activity Schemas
        // ============================================

        ActivityListItem: {
          type: "object",
          required: [
            "id",
            "stravaId",
            "name",
            "distanceMeters",
            "durationSeconds",
            "startDate",
            "activityType",
            "isProcessed",
          ],
          properties: {
            id: { type: "string", format: "uuid" },
            stravaId: { type: "string" },
            name: { type: "string" },
            distanceMeters: { type: "number" },
            durationSeconds: { type: "integer" },
            startDate: { type: "string", format: "date-time" },
            activityType: {
              type: "string",
              enum: ["Run", "Walk", "Hike", "Trail Run"],
            },
            isProcessed: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
            routesAffected: { type: "integer" },
            streetsCompleted: { type: "integer" },
            streetsImproved: { type: "integer" },
          },
        },

        ActivityImpact: {
          type: "object",
          properties: {
            completed: {
              type: "array",
              items: { type: "string" },
              description: "OSM IDs of streets that crossed 90% threshold",
            },
            improved: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  osmId: { type: "string" },
                  from: { type: "number" },
                  to: { type: "number" },
                },
              },
            },
          },
        },

        ActivityDetail: {
          allOf: [
            { $ref: "#/components/schemas/ActivityListItem" },
            {
              type: "object",
              properties: {
                coordinates: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      lat: { type: "number" },
                      lng: { type: "number" },
                      elevation: { type: "number" },
                      timestamp: { type: "string", format: "date-time" },
                    },
                  },
                },
                processedAt: {
                  type: "string",
                  format: "date-time",
                  nullable: true,
                },
                routeImpacts: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      routeId: { type: "string", format: "uuid" },
                      routeName: { type: "string" },
                      streetsCompleted: { type: "integer" },
                      streetsImproved: { type: "integer" },
                      impactDetails: {
                        $ref: "#/components/schemas/ActivityImpact",
                      },
                    },
                  },
                },
              },
            },
          ],
        },

        ActivitiesListResponse: {
          type: "object",
          required: ["success", "activities", "total", "page", "pageSize"],
          properties: {
            success: { type: "boolean", enum: [true] },
            activities: {
              type: "array",
              items: { $ref: "#/components/schemas/ActivityListItem" },
            },
            total: { type: "integer" },
            page: { type: "integer" },
            pageSize: { type: "integer" },
          },
        },

        ActivityDetailResponse: {
          type: "object",
          required: ["success", "activity"],
          properties: {
            success: { type: "boolean", enum: [true] },
            activity: { $ref: "#/components/schemas/ActivityDetail" },
          },
        },

        // ============================================
        // GPX Analysis Schemas
        // ============================================

        MatchedStreet: {
          type: "object",
          required: [
            "osmId",
            "name",
            "highwayType",
            "lengthMeters",
            "distanceCoveredMeters",
            "coverageRatio",
            "completionStatus",
          ],
          properties: {
            osmId: { type: "string" },
            name: { type: "string" },
            highwayType: { type: "string" },
            lengthMeters: { type: "number" },
            distanceCoveredMeters: { type: "number" },
            coverageRatio: { type: "number", minimum: 0, maximum: 1 },
            completionStatus: { type: "string", enum: ["FULL", "PARTIAL"] },
            matchedPointsCount: { type: "integer" },
          },
        },

        AggregatedStreet: {
          type: "object",
          required: [
            "name",
            "normalizedName",
            "highwayType",
            "totalLengthMeters",
            "coverageRatio",
            "completionStatus",
          ],
          properties: {
            name: { type: "string" },
            normalizedName: { type: "string" },
            highwayType: { type: "string" },
            totalLengthMeters: { type: "number" },
            totalDistanceCoveredMeters: {
              type: "number",
              description: "Clamped to street length",
            },
            totalDistanceRunMeters: {
              type: "number",
              description: "Actual distance (unclamped)",
            },
            coverageRatio: { type: "number", minimum: 0, maximum: 1 },
            rawCoverageRatio: {
              type: "number",
              description: "Unclamped ratio for debugging",
            },
            completionStatus: { type: "string", enum: ["FULL", "PARTIAL"] },
            segmentCount: { type: "integer" },
            segmentOsmIds: {
              type: "array",
              items: { type: "string" },
            },
          },
        },

        UnnamedRoadBucket: {
          type: "object",
          properties: {
            highwayType: { type: "string" },
            displayName: {
              type: "string",
              description: "e.g., 'Footpath (Unnamed)'",
            },
            totalLengthMeters: { type: "number" },
            totalDistanceCoveredMeters: { type: "number" },
            totalDistanceRunMeters: { type: "number" },
            coverageRatio: { type: "number" },
            segmentCount: { type: "integer" },
            fullCount: { type: "integer" },
            partialCount: { type: "integer" },
          },
        },

        GpxAnalysisResponse: {
          type: "object",
          required: [
            "success",
            "analysis",
            "segments",
            "streets",
            "unnamedRoads",
          ],
          properties: {
            success: { type: "boolean", enum: [true] },
            analysis: {
              type: "object",
              properties: {
                gpxName: { type: "string" },
                totalDistanceMeters: { type: "number" },
                durationSeconds: { type: "integer" },
                pointsCount: { type: "integer" },
                startTime: { type: "string", format: "date-time" },
                endTime: { type: "string", format: "date-time" },
                movingTimeSeconds: { type: "integer" },
                stoppedTimeSeconds: { type: "integer" },
                avgPointSpacingMeters: { type: "number" },
                maxSegmentDistanceMeters: { type: "number" },
                gpsJumpCount: { type: "integer" },
                streetsTotal: { type: "integer" },
                streetsFullCount: { type: "integer" },
                streetsPartialCount: { type: "integer" },
                percentageFullStreets: { type: "number" },
              },
            },
            segments: {
              type: "object",
              properties: {
                total: { type: "integer" },
                fullCount: { type: "integer" },
                partialCount: { type: "integer" },
                list: {
                  type: "array",
                  items: { $ref: "#/components/schemas/MatchedStreet" },
                },
              },
            },
            streets: {
              type: "object",
              properties: {
                total: { type: "integer" },
                fullCount: { type: "integer" },
                partialCount: { type: "integer" },
                list: {
                  type: "array",
                  items: { $ref: "#/components/schemas/AggregatedStreet" },
                },
              },
            },
            unnamedRoads: {
              type: "object",
              properties: {
                totalSegments: { type: "integer" },
                buckets: {
                  type: "array",
                  items: { $ref: "#/components/schemas/UnnamedRoadBucket" },
                },
              },
            },
          },
        },

        // ============================================
        // Map Schemas
        // ============================================

        MapStreetStats: {
          type: "object",
          required: [
            "runCount",
            "completionCount",
            "currentPercentage",
            "everCompleted",
            "weightedCompletionRatio",
            "segmentCount",
            "connectorCount",
          ],
          properties: {
            runCount: {
              type: "integer",
              description: "Times the user has run on this street",
            },
            completionCount: {
              type: "integer",
              description: "Times the user achieved >= 90% coverage",
            },
            firstRunDate: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            lastRunDate: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            totalLengthMeters: {
              type: "number",
              description: "Street length in meters",
            },
            currentPercentage: {
              type: "number",
              minimum: 0,
              maximum: 100,
              description: "Current coverage (0-100)",
            },
            everCompleted: {
              type: "boolean",
              description:
                "True if user has ever completed this street (>= 90%)",
            },
            weightedCompletionRatio: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description:
                "Length-weighted completion (0-1); connectors count at CONNECTOR_WEIGHT",
            },
            segmentCount: {
              type: "integer",
              description:
                "Number of OSM segments (parts on map) for this street",
            },
            connectorCount: {
              type: "integer",
              description:
                "Number of segments classified as connectors (length <= CONNECTOR_MAX_LENGTH_METERS)",
            },
          },
        },

        MapStreet: {
          type: "object",
          required: [
            "osmId",
            "name",
            "highwayType",
            "lengthMeters",
            "percentage",
            "status",
            "geometry",
            "stats",
          ],
          properties: {
            osmId: { type: "string", description: "OpenStreetMap way ID" },
            name: { type: "string", description: "Street name" },
            highwayType: {
              type: "string",
              description: "e.g. residential, footway",
            },
            lengthMeters: {
              type: "number",
              description: "Street length in meters",
            },
            percentage: {
              type: "number",
              minimum: 0,
              maximum: 100,
              description: "Current coverage (0-100)",
            },
            status: {
              type: "string",
              enum: ["completed", "partial"],
              description: "completed = green, partial = yellow",
            },
            geometry: {
              type: "object",
              required: ["type", "coordinates"],
              properties: {
                type: { type: "string", enum: ["LineString"] },
                coordinates: {
                  type: "array",
                  items: {
                    type: "array",
                    items: { type: "number" },
                    minItems: 2,
                    maxItems: 2,
                    description: "[lng, lat] pairs",
                  },
                },
              },
            },
            stats: { $ref: "#/components/schemas/MapStreetStats" },
          },
        },

        MapStreetsResponse: {
          type: "object",
          required: [
            "success",
            "streets",
            "segments",
            "center",
            "radiusMeters",
            "totalStreets",
            "completedCount",
            "partialCount",
          ],
          properties: {
            success: { type: "boolean", enum: [true] },
            streets: {
              type: "array",
              items: { $ref: "#/components/schemas/MapStreet" },
              description: "Aggregated logical streets (for list and stats)",
            },
            segments: {
              type: "array",
              items: { $ref: "#/components/schemas/MapStreet" },
              description: "Segment-level streets (for map polylines)",
            },
            center: {
              type: "object",
              required: ["lat", "lng"],
              properties: {
                lat: { type: "number", minimum: -90, maximum: 90 },
                lng: { type: "number", minimum: -180, maximum: 180 },
              },
            },
            radiusMeters: {
              type: "integer",
              description: "Request radius in meters",
            },
            totalStreets: {
              type: "integer",
              description: "Number of streets returned",
            },
            completedCount: {
              type: "integer",
              description: "Streets with status completed (green)",
            },
            partialCount: {
              type: "integer",
              description: "Streets with status partial (yellow)",
            },
          },
        },

        // ============================================
        // Webhook Schemas
        // ============================================

        StravaWebhookPayload: {
          type: "object",
          required: [
            "object_type",
            "object_id",
            "aspect_type",
            "owner_id",
            "subscription_id",
            "event_time",
          ],
          properties: {
            object_type: { type: "string", enum: ["activity", "athlete"] },
            object_id: {
              type: "integer",
              description: "Strava activity or athlete ID",
            },
            aspect_type: {
              type: "string",
              enum: ["create", "update", "delete"],
            },
            owner_id: {
              type: "integer",
              description: "Strava athlete ID (owner)",
            },
            subscription_id: { type: "integer" },
            event_time: { type: "integer", description: "Unix timestamp" },
            updates: { type: "object", additionalProperties: true },
          },
        },

        WebhookResponse: {
          type: "object",
          required: ["status", "action"],
          properties: {
            status: { type: "string", enum: ["received"] },
            action: { type: "string", enum: ["queued", "skipped", "error"] },
            jobId: { type: "string" },
            reason: { type: "string" },
            processingTimeMs: { type: "integer" },
          },
        },
      },
    },
  },
  apis: ["./src/routes/*.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
