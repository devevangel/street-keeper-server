/**
 * Seed MilestoneType table with all plan types. Enabled types are available
 * to users; disabled types are implemented but locked (isEnabled: false).
 */
import type { PrismaClient } from "../src/generated/prisma/client.js";

const MILESTONE_TYPES = [
  // Enabled by default (core experience)
  {
    slug: "first_run_ever",
    scope: "global",
    name: "First Run",
    description: "Complete your first run with Street Keeper",
    isEnabled: true,
    order: 0,
  },
  {
    slug: "first_street_complete",
    scope: "global",
    name: "First Street",
    description: "Complete your first street 100%",
    isEnabled: true,
    order: 1,
  },
  {
    slug: "project_percent",
    scope: "project",
    name: "Project Progress",
    description: "Reach a percentage of your project",
    configSchema: { targetPercent: [5, 10, 25, 50, 75, 100] } as object,
    isEnabled: true,
    order: 2,
  },
  {
    slug: "project_first_street",
    scope: "project",
    name: "First Street in Project",
    description: "Run your first street in this project",
    isEnabled: true,
    order: 3,
  },
  {
    slug: "single_run_distance_km",
    scope: "global",
    name: "Distance Goal",
    description: "Run a single activity of this distance",
    configSchema: { targetKm: [5, 10, 21.1, 42.2] } as object,
    isEnabled: true,
    order: 4,
  },
  {
    slug: "streak_weeks",
    scope: "global",
    name: "Weekly Streak",
    description: "Run at least once per week for N weeks",
    configSchema: { targetWeeks: [1, 4, 12, 26, 52] } as object,
    isEnabled: true,
    order: 5,
  },

  // Locked for now (set isEnabled: false)
  {
    slug: "project_streets",
    scope: "project",
    name: "Street Count",
    description: "Complete N streets in the project",
    configSchema: { targetCount: [10, 25, 50, 100] } as object,
    isEnabled: false,
    order: 10,
  },
  {
    slug: "project_distance_km",
    scope: "project",
    name: "Project Distance",
    description: "Run N km within the project",
    isEnabled: false,
    order: 11,
  },
  {
    slug: "project_first_complete",
    scope: "project",
    name: "Project Complete",
    description: "Complete your first street 100% in this project",
    isEnabled: false,
    order: 12,
  },
  {
    slug: "global_streets",
    scope: "global",
    name: "Total Streets",
    description: "Complete N streets globally",
    configSchema: { targetCount: [50, 100, 250, 500] } as object,
    isEnabled: false,
    order: 13,
  },
  {
    slug: "global_distance_km",
    scope: "global",
    name: "Total Distance",
    description: "Run N km total",
    isEnabled: false,
    order: 14,
  },
  {
    slug: "areas_discovered",
    scope: "global",
    name: "Areas Discovered",
    description: "Discover N distinct areas",
    configSchema: { targetCount: [1, 3, 5, 10] } as object,
    isEnabled: false,
    order: 15,
  },
  {
    slug: "repeat_street",
    scope: "global",
    name: "Repeat Runner",
    description: "Run the same street N times",
    configSchema: { targetRuns: [3, 5, 10] } as object,
    isEnabled: false,
    order: 16,
  },
  {
    slug: "new_streets_in_period",
    scope: "global",
    name: "Weekly Discovery",
    description: "Run N new streets in a period",
    configSchema: { count: 0, periodDays: 7 } as object,
    isEnabled: false,
    order: 17,
  },
  {
    slug: "streets_in_one_run",
    scope: "global",
    name: "Multi-Street Run",
    description: "Run N different streets in one activity",
    configSchema: { targetCount: [3, 5, 10] } as object,
    isEnabled: false,
    order: 18,
  },
];

async function run(prisma: PrismaClient): Promise<void> {
  for (const row of MILESTONE_TYPES) {
    await prisma.milestoneType.upsert({
      where: { slug: row.slug },
      create: {
        slug: row.slug,
        scope: row.scope,
        name: row.name,
        description: row.description ?? null,
        configSchema: row.configSchema ?? null,
        isEnabled: row.isEnabled,
        order: row.order,
      },
      update: {
        name: row.name,
        description: row.description ?? null,
        configSchema: row.configSchema ?? null,
        isEnabled: row.isEnabled,
        order: row.order,
      },
    });
  }
}

export async function seedMilestoneTypes(prisma: PrismaClient): Promise<void> {
  await run(prisma);
}
