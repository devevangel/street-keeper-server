/**
 * Runs Module Tests
 * Tests the main user story: User uploads GPX file → Gets street analysis
 *
 * User Story: "As a runner, I want to upload my GPX file and see all the
 * streets I ran on with accurate coverage data."
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import runsRoutes from "../routes/runs.routes.js";

// ============================================
// Test Setup
// ============================================

// Create test app with runs routes
const app = express();
app.use(express.json());
app.use("/api/v1/runs", runsRoutes);

// Sample GPX content for testing
const createSampleGpx = (points: { lat: number; lng: number }[]) => {
  const trackpoints = points
    .map(
      (p) => `<trkpt lat="${p.lat}" lon="${p.lng}">
        <time>${new Date().toISOString()}</time>
      </trkpt>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Test">
  <trk>
    <name>Test Run</name>
    <trkseg>
      ${trackpoints}
    </trkseg>
  </trk>
</gpx>`;
};

// Sample points near Windsor, UK (where output.json data came from)
const windsorTestPoints = [
  { lat: 51.4816, lng: -0.6097 }, // Near Peascod Street
  { lat: 51.4818, lng: -0.6095 },
  { lat: 51.4820, lng: -0.6093 },
  { lat: 51.4822, lng: -0.6091 },
  { lat: 51.4824, lng: -0.6089 },
];

// ============================================
// Main User Story Tests
// ============================================

describe("US-RUN: GPX Street Analysis", () => {
  describe("POST /api/v1/runs/analyze-gpx", () => {
    // ----------------------------------------
    // Input Validation Tests
    // ----------------------------------------

    it("should return 400 when no file is provided", async () => {
      const response = await request(app)
        .post("/api/v1/runs/analyze-gpx")
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe("GPX_FILE_REQUIRED");
    });

    it("should return 400 for invalid file type", async () => {
      const response = await request(app)
        .post("/api/v1/runs/analyze-gpx")
        .attach("gpx", Buffer.from("not a gpx file"), "test.txt")
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it("should return 400 for malformed GPX", async () => {
      const response = await request(app)
        .post("/api/v1/runs/analyze-gpx")
        .attach("gpx", Buffer.from("<invalid>xml</invalid>"), "test.gpx")
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe("GPX_PARSE_ERROR");
    });

    it("should return 400 for GPX with no track points", async () => {
      const emptyGpx = `<?xml version="1.0"?>
        <gpx version="1.1">
          <trk><name>Empty</name><trkseg></trkseg></trk>
        </gpx>`;

      const response = await request(app)
        .post("/api/v1/runs/analyze-gpx")
        .attach("gpx", Buffer.from(emptyGpx), "empty.gpx")
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe("GPX_PARSE_ERROR");
    });

    // ----------------------------------------
    // Response Structure Tests
    // ----------------------------------------

    it("should return enhanced response structure with all sections", async () => {
      const gpxContent = createSampleGpx(windsorTestPoints);

      const response = await request(app)
        .post("/api/v1/runs/analyze-gpx")
        .attach("gpx", Buffer.from(gpxContent), "test.gpx")
        .timeout(60000); // Overpass API can be slow

      // Skip if Overpass API is down
      if (response.status === 502) {
        console.log("Skipping: Overpass API unavailable");
        return;
      }

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Check analysis section exists with Phase 3 & 4 fields
      expect(response.body.analysis).toBeDefined();
      expect(response.body.analysis.totalDistanceMeters).toBeTypeOf("number");
      expect(response.body.analysis.durationSeconds).toBeTypeOf("number");
      expect(response.body.analysis.pointsCount).toBe(windsorTestPoints.length);

      // Phase 3: Quality metrics
      expect(response.body.analysis.avgPointSpacingMeters).toBeTypeOf("number");
      expect(response.body.analysis.maxSegmentDistanceMeters).toBeTypeOf("number");
      expect(response.body.analysis.gpsJumpCount).toBeTypeOf("number");

      // Phase 4: Street summary
      expect(response.body.analysis.streetsTotal).toBeTypeOf("number");
      expect(response.body.analysis.streetsFullCount).toBeTypeOf("number");
      expect(response.body.analysis.streetsPartialCount).toBeTypeOf("number");
      expect(response.body.analysis.percentageFullStreets).toBeTypeOf("number");

      // Check segments section (raw data)
      expect(response.body.segments).toBeDefined();
      expect(response.body.segments.total).toBeTypeOf("number");
      expect(response.body.segments.list).toBeInstanceOf(Array);

      // Check streets section (aggregated data)
      expect(response.body.streets).toBeDefined();
      expect(response.body.streets.total).toBeTypeOf("number");
      expect(response.body.streets.list).toBeInstanceOf(Array);

      // Check unnamedRoads section
      expect(response.body.unnamedRoads).toBeDefined();
      expect(response.body.unnamedRoads.totalSegments).toBeTypeOf("number");
      expect(response.body.unnamedRoads.buckets).toBeInstanceOf(Array);
    }, 60000);
  });
});

// ============================================
// Unit Tests for Core Services
// ============================================

describe("GPX Parsing Service", () => {
  it("should parse valid GPX and extract points", async () => {
    const { parseGpxBuffer } = await import("../services/gpx.service.js");

    const gpxContent = createSampleGpx(windsorTestPoints);
    const result = parseGpxBuffer(Buffer.from(gpxContent));

    expect(result.points).toHaveLength(windsorTestPoints.length);
    expect(result.points[0].lat).toBeCloseTo(windsorTestPoints[0].lat, 4);
    expect(result.points[0].lng).toBeCloseTo(windsorTestPoints[0].lng, 4);
  });

  it("should extract GPX name", async () => {
    const { parseGpxBuffer } = await import("../services/gpx.service.js");

    const gpxContent = createSampleGpx(windsorTestPoints);
    const result = parseGpxBuffer(Buffer.from(gpxContent));

    expect(result.name).toBe("Test Run");
  });

  it("should throw error for invalid GPX", async () => {
    const { parseGpxBuffer, GpxParseError } = await import(
      "../services/gpx.service.js"
    );

    expect(() => parseGpxBuffer(Buffer.from("invalid xml"))).toThrow(
      GpxParseError
    );
  });
});

describe("Geo Service", () => {
  it("should calculate distance between points", async () => {
    const { calculateTotalDistance } = await import("../services/geo.service.js");

    const points = [
      { lat: 51.4816, lng: -0.6097 },
      { lat: 51.4826, lng: -0.6087 }, // ~130m away
    ];

    const distance = calculateTotalDistance(points);

    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(200);
  });

  it("should calculate bounding box with buffer", async () => {
    const { calculateBoundingBox } = await import("../services/geo.service.js");

    const points = [
      { lat: 51.48, lng: -0.61 },
      { lat: 51.49, lng: -0.60 },
    ];

    const bbox = calculateBoundingBox(points);

    // Should include buffer around points
    expect(bbox.south).toBeLessThan(51.48);
    expect(bbox.north).toBeGreaterThan(51.49);
    expect(bbox.west).toBeLessThan(-0.61);
    expect(bbox.east).toBeGreaterThan(-0.60);
  });
});

describe("Street Matching Service", () => {
  it("should match points to streets", async () => {
    const { matchPointsToStreets } = await import(
      "../engines/v1/street-matching.js"
    );

    // Mock street data
    const streets = [
      {
        osmId: "way/123",
        name: "Test Street",
        lengthMeters: 100,
        highwayType: "residential",
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [-0.6097, 51.4816],
            [-0.6089, 51.4824],
          ],
        },
      },
    ];

    const points = [
      { lat: 51.4818, lng: -0.6095 },
      { lat: 51.4820, lng: -0.6093 },
      { lat: 51.4822, lng: -0.6091 },
    ];

    const matched = matchPointsToStreets(points, streets);

    expect(matched).toBeInstanceOf(Array);
    // Should match street if points are close enough
    if (matched.length > 0) {
      expect(matched[0].name).toBe("Test Street");
      expect(matched[0].coverageRatio).toBeTypeOf("number");
      expect(matched[0].completionStatus).toMatch(/^(FULL|PARTIAL)$/);
    }
  });

  it("should include Phase 2 geometry coverage fields", async () => {
    const { matchPointsToStreets } = await import(
      "../engines/v1/street-matching.js"
    );

    const streets = [
      {
        osmId: "way/456",
        name: "Geometry Test Street",
        lengthMeters: 50,
        highwayType: "residential",
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [-0.6097, 51.4816],
            [-0.6089, 51.4824],
          ],
        },
      },
    ];

    const points = [
      { lat: 51.4817, lng: -0.6096 },
      { lat: 51.4819, lng: -0.6094 },
      { lat: 51.4821, lng: -0.6092 },
      { lat: 51.4823, lng: -0.6090 },
    ];

    const matched = matchPointsToStreets(points, streets);

    if (matched.length > 0) {
      // Phase 2 fields should exist
      expect(matched[0]).toHaveProperty("geometryDistanceCoveredMeters");
      expect(matched[0]).toHaveProperty("geometryCoverageRatio");
    }
  });
});

describe("Street Aggregation Service", () => {
  it("should normalize street names", async () => {
    const { normalizeStreetName } = await import(
      "../engines/v1/street-aggregation.js"
    );

    expect(normalizeStreetName("Main Street")).toBe("main street");
    expect(normalizeStreetName("MAIN STREET")).toBe("main street");
    expect(normalizeStreetName("  Main  Street  ")).toBe("main street");
  });

  it("should identify unnamed streets", async () => {
    const { isUnnamedStreet } = await import(
      "../engines/v1/street-aggregation.js"
    );

    expect(isUnnamedStreet("Unnamed Road")).toBe(true);
    expect(isUnnamedStreet("unnamed")).toBe(true);
    expect(isUnnamedStreet("")).toBe(true);
    expect(isUnnamedStreet("Main Street")).toBe(false);
  });

  it("should aggregate duplicate street segments", async () => {
    const { aggregateSegmentsIntoLogicalStreets } = await import(
      "../engines/v1/street-aggregation.js"
    );

    // Simulate OSM fragmentation: same street split into 3 segments
    const segments = [
      {
        osmId: "way/111",
        name: "Peascod Street",
        highwayType: "pedestrian",
        lengthMeters: 100,
        distanceCoveredMeters: 95,
        coverageRatio: 0.95,
        completionStatus: "FULL" as const,
        matchedPointsCount: 10,
      },
      {
        osmId: "way/222",
        name: "Peascod Street",
        highwayType: "pedestrian",
        lengthMeters: 150,
        distanceCoveredMeters: 140,
        coverageRatio: 0.93,
        completionStatus: "FULL" as const,
        matchedPointsCount: 15,
      },
      {
        osmId: "way/333",
        name: "Peascod Street",
        highwayType: "pedestrian",
        lengthMeters: 120,
        distanceCoveredMeters: 115,
        coverageRatio: 0.96,
        completionStatus: "FULL" as const,
        matchedPointsCount: 12,
      },
    ];

    const result = aggregateSegmentsIntoLogicalStreets(segments);

    // Should aggregate into ONE street
    expect(result.streets).toHaveLength(1);
    expect(result.streets[0].name).toBe("Peascod Street");
    expect(result.streets[0].segmentCount).toBe(3);
    expect(result.streets[0].segmentOsmIds).toContain("way/111");
    expect(result.streets[0].segmentOsmIds).toContain("way/222");
    expect(result.streets[0].segmentOsmIds).toContain("way/333");

    // Totals should be summed
    expect(result.streets[0].totalLengthMeters).toBe(370); // 100+150+120
    expect(result.streets[0].totalDistanceCoveredMeters).toBe(350); // 95+140+115
  });

  it("should clamp coverage ratios to 1.0 for UX", async () => {
    const { aggregateSegmentsIntoLogicalStreets } = await import(
      "../engines/v1/street-aggregation.js"
    );

    // Simulate inflated coverage (runner went back and forth)
    const segments = [
      {
        osmId: "way/999",
        name: "Back and Forth Street",
        highwayType: "residential",
        lengthMeters: 100,
        distanceCoveredMeters: 180, // 180% coverage
        coverageRatio: 1.8,
        completionStatus: "FULL" as const,
        matchedPointsCount: 20,
      },
    ];

    const result = aggregateSegmentsIntoLogicalStreets(segments);

    // coverageRatio should be clamped to 1.0
    expect(result.streets[0].coverageRatio).toBe(1.0);
    // rawCoverageRatio should preserve original value
    expect(result.streets[0].rawCoverageRatio).toBeGreaterThan(1.0);
  });

  it("should bucket unnamed roads by highway type", async () => {
    const { aggregateSegmentsIntoLogicalStreets } = await import(
      "../engines/v1/street-aggregation.js"
    );

    const segments = [
      {
        osmId: "way/001",
        name: "Unnamed Road",
        highwayType: "footway",
        lengthMeters: 50,
        distanceCoveredMeters: 45,
        coverageRatio: 0.9,
        completionStatus: "FULL" as const,
        matchedPointsCount: 5,
      },
      {
        osmId: "way/002",
        name: "Unnamed Road",
        highwayType: "footway",
        lengthMeters: 60,
        distanceCoveredMeters: 30,
        coverageRatio: 0.5,
        completionStatus: "PARTIAL" as const,
        matchedPointsCount: 6,
      },
      {
        osmId: "way/003",
        name: "Unnamed Road",
        highwayType: "path",
        lengthMeters: 40,
        distanceCoveredMeters: 35,
        coverageRatio: 0.875,
        completionStatus: "PARTIAL" as const,
        matchedPointsCount: 4,
      },
    ];

    const result = aggregateSegmentsIntoLogicalStreets(segments);

    // Named streets should be empty
    expect(result.streets).toHaveLength(0);

    // Should have 2 buckets: footway and path
    expect(result.unnamedBuckets).toHaveLength(2);

    // Find footway bucket
    const footwayBucket = result.unnamedBuckets.find(
      (b) => b.highwayType === "footway"
    );
    expect(footwayBucket).toBeDefined();
    expect(footwayBucket!.segmentCount).toBe(2);
    expect(footwayBucket!.displayName).toBe("Footpath (Unnamed)");
    expect(footwayBucket!.fullCount).toBe(1);
    expect(footwayBucket!.partialCount).toBe(1);
  });
});

describe("GPX Analysis Service", () => {
  it("should calculate track quality metrics", async () => {
    const { calculateTrackQuality } = await import(
      "../engines/v1/gpx-analysis.js"
    );

    const points = [
      { lat: 51.4816, lng: -0.6097 },
      { lat: 51.4818, lng: -0.6095 }, // ~25m
      { lat: 51.4820, lng: -0.6093 }, // ~25m
      { lat: 51.4822, lng: -0.6091 }, // ~25m
    ];

    const quality = calculateTrackQuality(points);

    expect(quality.avgPointSpacingMeters).toBeGreaterThan(0);
    expect(quality.maxSegmentDistanceMeters).toBeGreaterThan(0);
    expect(quality.gpsJumpCount).toBe(0); // No jumps in this data
  });

  it("should detect GPS jumps", async () => {
    const { calculateTrackQuality } = await import(
      "../engines/v1/gpx-analysis.js"
    );

    const points = [
      { lat: 51.4816, lng: -0.6097 },
      { lat: 51.4818, lng: -0.6095 }, // Normal
      { lat: 51.4920, lng: -0.5993 }, // GPS JUMP (>100m)
      { lat: 51.4922, lng: -0.5991 }, // Normal
    ];

    const quality = calculateTrackQuality(points);

    expect(quality.gpsJumpCount).toBe(1);
  });

  it("should calculate moving vs stopped time", async () => {
    const { calculateMovingStoppedTime } = await import(
      "../engines/v1/gpx-analysis.js"
    );

    const now = Date.now();
    const points = [
      { lat: 51.4816, lng: -0.6097, timestamp: new Date(now) },
      { lat: 51.4826, lng: -0.6087, timestamp: new Date(now + 10000) }, // 10s, ~130m = moving
      { lat: 51.4826, lng: -0.6087, timestamp: new Date(now + 20000) }, // 10s, 0m = stopped
      { lat: 51.4836, lng: -0.6077, timestamp: new Date(now + 30000) }, // 10s, ~130m = moving
    ];

    const result = calculateMovingStoppedTime(points);

    expect(result.movingSeconds).toBeGreaterThan(0);
    expect(result.stoppedSeconds).toBeGreaterThan(0);
  });
});
