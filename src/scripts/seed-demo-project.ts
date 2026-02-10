/**
 * Seed a demo project with realistic progress and one activity (from Lunch_Run.gpx)
 * so you can see dashboard stats, charts, heatmap, and suggestions.
 *
 * Usage: npx tsx src/scripts/seed-demo-project.ts [userId]
 *
 * If userId is omitted, uses the default test user id below.
 * GPX path: backend/Lunch_Run.gpx (or set GPX_PATH).
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import prisma from "../lib/prisma.js";
import { previewProject, createProject } from "../services/project.service.js";
import type { StreetSnapshot, SnapshotStreet } from "../types/project.types.js";
import type { GpxPoint } from "../types/run.types.js";

const DEFAULT_USER_ID = "b3618c96-41f6-49e5-aef4-93f2a7a754db";
const GPX_PATH = process.env.GPX_PATH ?? path.join(process.cwd(), "Lunch_Run.gpx");
const CENTER_LAT = 50.7885;
const CENTER_LNG = -1.088;
const RADIUS_METERS = 2000 as 500 | 1000 | 2000 | 5000 | 10000;
const PROJECT_NAME = "Lunch Run Area (demo)";
const STRAVA_ID_SEED = "seed-demo-lunch-run";

function parseGpxPoints(filePath: string): GpxPoint[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const points: GpxPoint[] = [];
  const re = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      points.push({ lat, lng });
    }
  }
  return points;
}

async function ensureUser(userId: string): Promise<void> {
  await prisma.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      name: "Evangel Iheukwumere",
      stravaId: "171501136",
    },
    update: {},
  });
  console.log(`   User ready: ${userId}`);
}

async function main(): Promise<void> {
  const userId = process.argv[2] ?? DEFAULT_USER_ID;

  console.log("\n🌱 Seed demo project");
  console.log("   User ID:", userId);
  console.log("   GPX:", GPX_PATH);

  if (!fs.existsSync(GPX_PATH)) {
    console.error("\n❌ GPX file not found:", GPX_PATH);
    console.log("   Set GPX_PATH or place Lunch_Run.gpx in backend/");
    process.exit(1);
  }

  const gpxPoints = parseGpxPoints(GPX_PATH);
  console.log(`   Parsed ${gpxPoints.length} track points from GPX`);

  await ensureUser(userId);

  // 1) Preview to fill geometry cache
  console.log("\n📍 Previewing area (fills geometry cache)...");
  const preview = await previewProject(CENTER_LAT, CENTER_LNG, RADIUS_METERS);
  console.log(`   ${preview.totalStreets} streets, ${(preview.totalLengthMeters / 1000).toFixed(1)} km`);

  // 2) Create project (0% progress)
  console.log("\n📁 Creating project...");
  const projectListItem = await createProject(
    userId,
    {
      name: PROJECT_NAME,
      centerLat: CENTER_LAT,
      centerLng: CENTER_LNG,
      radiusMeters: RADIUS_METERS,
    },
    preview.cacheKey
  );
  const projectId = projectListItem.id;
  console.log(`   Project ID: ${projectId}`);

  // 3) Load project and snapshot, then apply varied progress
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) {
    console.error("   Project not found after create");
    process.exit(1);
  }

  const snapshot = project.streetsSnapshot as StreetSnapshot;
  const streets = snapshot.streets as SnapshotStreet[];
  const n = streets.length;
  // ~35% completed, ~25% in progress, ~40% not started
  const nCompleted = Math.max(1, Math.floor(n * 0.35));
  const nInProgress = Math.max(1, Math.floor(n * 0.25));
  const lastRunDate = "2026-02-03T12:54:00.000Z";

  for (let i = 0; i < streets.length; i++) {
    if (i < nCompleted) {
      streets[i].percentage = 90 + Math.random() * 10;
      streets[i].completed = true;
      streets[i].lastRunDate = lastRunDate;
    } else if (i < nCompleted + nInProgress) {
      streets[i].percentage = 10 + Math.random() * 78;
      streets[i].completed = false;
      streets[i].lastRunDate = lastRunDate;
    } else {
      streets[i].percentage = 0;
      streets[i].completed = false;
      streets[i].lastRunDate = null;
    }
  }

  const completedCount = streets.filter((s) => s.completed).length;
  const progress =
    n > 0 ? (completedCount / n) * 100 : 0;

  await prisma.project.update({
    where: { id: projectId },
    data: {
      streetsSnapshot: { streets, snapshotDate: snapshot.snapshotDate } as object,
      completedStreets: completedCount,
      progress,
    },
  });
  console.log(
    `   Snapshot updated: ${completedCount} completed, ${nInProgress} in progress, ${n - completedCount - nInProgress} not started (${progress.toFixed(1)}%)`
  );

  // 4) Find or create activity with GPX coordinates (idempotent: reuse if already seeded)
  let activity = await prisma.activity.findFirst({
    where: { userId, stravaId: STRAVA_ID_SEED },
  });
  if (!activity) {
    activity = await prisma.activity.create({
      data: {
        userId,
        stravaId: STRAVA_ID_SEED,
        name: "Lunch Run",
        distanceMeters: 8500,
        durationSeconds: 2400,
        startDate: new Date("2026-02-03T12:41:22Z"),
        activityType: "Run",
        coordinates: gpxPoints as unknown as object,
        isProcessed: true,
        processedAt: new Date(),
      },
    });
    console.log(`   Activity created: ${activity.id} (${activity.name})`);
  } else {
    console.log(`   Activity reused: ${activity.id} (${activity.name})`);
  }

  // 5) Link activity to project (upsert so re-runs don't duplicate)
  await prisma.projectActivity.upsert({
    where: {
      projectId_activityId: { projectId, activityId: activity.id },
    },
    create: {
      projectId,
      activityId: activity.id,
      streetsCompleted: 3,
      streetsImproved: 8,
    },
    update: {},
  });
  console.log("   ProjectActivity linked (project ↔ activity)");

  console.log("\n✅ Demo project ready!");
  console.log(`   Open project: /projects/${projectId}`);
  console.log("   You should see: progress %, stat cards, charts, heatmap, suggestions.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
