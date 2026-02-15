/**
 * Milestone service: CRUD and progress computation for user milestones.
 * Progress is always returned in a unified shape (currentValue, targetValue, unit, ratio, isCompleted).
 */
import prisma from "../lib/prisma.js";
import { getStreak } from "./streak.service.js";
import type {
  MilestoneProgress,
  MilestoneWithProgress,
  CreateMilestoneInput,
} from "../types/milestone.types.js";

type JsonObject = Record<string, unknown>;

function configToKey(config: JsonObject): string {
  const keys = Object.keys(config).sort();
  const obj: JsonObject = {};
  for (const k of keys) obj[k] = (config as Record<string, unknown>)[k];
  return JSON.stringify(obj);
}

function clampRatio(ratio: number): number {
  return Math.min(1, Math.max(0, ratio));
}

/**
 * Compute progress for a single milestone (unified shape).
 */
export async function computeProgress(
  milestone: {
    id: string;
    typeSlug: string;
    config: unknown;
    completedAt: Date | null;
    userId: string;
    projectId: string | null;
  }
): Promise<MilestoneProgress> {
  const config = (milestone.config || {}) as JsonObject;

  if (milestone.completedAt) {
    return {
      currentValue: 1,
      targetValue: 1,
      unit: "runs",
      ratio: 1,
      isCompleted: true,
    };
  }

  switch (milestone.typeSlug) {
    case "first_run_ever": {
      const count = await prisma.activity.count({
        where: { userId: milestone.userId, isProcessed: true },
      });
      const current = count > 0 ? 1 : 0;
      return {
        currentValue: current,
        targetValue: 1,
        unit: "runs",
        ratio: current,
        isCompleted: current >= 1,
      };
    }

    case "first_street_complete": {
      const hasComplete = await prisma.userStreetProgress.findFirst({
        where: { userId: milestone.userId, everCompleted: true },
      });
      const current = hasComplete ? 1 : 0;
      return {
        currentValue: current,
        targetValue: 1,
        unit: "streets",
        ratio: current,
        isCompleted: current >= 1,
      };
    }

    case "project_percent": {
      if (!milestone.projectId) {
        return { currentValue: 0, targetValue: 100, unit: "percent", ratio: 0, isCompleted: false };
      }
      const project = await prisma.project.findUnique({
        where: { id: milestone.projectId },
        select: { progress: true },
      });
      const target = (config.targetPercent as number) ?? 100;
      const current = project?.progress ?? 0;
      const ratio = clampRatio(current / target);
      return {
        currentValue: current,
        targetValue: target,
        unit: "percent",
        ratio,
        isCompleted: ratio >= 1,
      };
    }

    case "project_streets": {
      if (!milestone.projectId) {
        return { currentValue: 0, targetValue: 100, unit: "streets", ratio: 0, isCompleted: false };
      }
      const proj = await prisma.project.findUnique({
        where: { id: milestone.projectId },
        select: { completedStreets: true },
      });
      const targetCount = (config.targetCount as number) ?? 100;
      const currentCount = proj?.completedStreets ?? 0;
      const ratio = clampRatio(currentCount / targetCount);
      return {
        currentValue: currentCount,
        targetValue: targetCount,
        unit: "streets",
        ratio,
        isCompleted: ratio >= 1,
      };
    }

    case "project_first_street":
    case "project_first_complete": {
      if (!milestone.projectId) {
        return { currentValue: 0, targetValue: 1, unit: "streets", ratio: 0, isCompleted: false };
      }
      const snap = await prisma.project.findUnique({
        where: { id: milestone.projectId },
        select: { streetsSnapshot: true },
      });
      const streets = (snap?.streetsSnapshot as { streets?: { percentage?: number }[] })?.streets ?? [];
      const hasOne = streets.some((s) => (s.percentage ?? 0) >= 90);
      const current = hasOne ? 1 : 0;
      return {
        currentValue: current,
        targetValue: 1,
        unit: "streets",
        ratio: current,
        isCompleted: current >= 1,
      };
    }

    case "single_run_distance_km": {
      const targetKm = (config.targetKm as number) ?? 5;
      const max = await prisma.activity.aggregate({
        where: { userId: milestone.userId, isProcessed: true },
        _max: { distanceMeters: true },
      });
      const currentKm = (max._max.distanceMeters ?? 0) / 1000;
      const ratio = clampRatio(currentKm / targetKm);
      return {
        currentValue: Math.round(currentKm * 100) / 100,
        targetValue: targetKm,
        unit: "km",
        ratio,
        isCompleted: ratio >= 1,
      };
    }

    case "streak_weeks": {
      const targetWeeks = (config.targetWeeks as number) ?? 1;
      const streak = await getStreak(milestone.userId);
      const current = streak.currentWeeks;
      const ratio = clampRatio(current / targetWeeks);
      return {
        currentValue: current,
        targetValue: targetWeeks,
        unit: "weeks",
        ratio,
        isCompleted: ratio >= 1,
      };
    }

    default:
      return {
        currentValue: 0,
        targetValue: 1,
        unit: "runs",
        ratio: 0,
        isCompleted: false,
      };
  }
}

/**
 * List milestones for a user (with progress). Optionally filter by project.
 */
export async function getMilestonesForUser(
  userId: string,
  projectId?: string
): Promise<MilestoneWithProgress[]> {
  const where: { userId: string; completedAt: null; projectId?: string | null } = {
    userId,
    completedAt: null,
  };
  if (projectId !== undefined) where.projectId = projectId;

  const rows = await prisma.userMilestone.findMany({
    where,
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });

  const result: MilestoneWithProgress[] = [];
  for (const row of rows) {
    const progress = await computeProgress(row);
    result.push({
      id: row.id,
      name: row.name,
      typeSlug: row.typeSlug,
      kind: row.kind as "auto" | "suggested" | "custom",
      isPinned: row.isPinned,
      progress,
      projectId: row.projectId,
    });
  }
  return result;
}

/**
 * Get the single "next" milestone for the homepage (selection order: pinned > closest > smallest small win).
 */
export async function getNextMilestone(
  userId: string,
  projectId?: string
): Promise<MilestoneWithProgress | null> {
  const list = await getMilestonesForUser(userId, projectId);
  if (list.length === 0) return null;

  const pinned = list.find((m) => m.isPinned);
  if (pinned) return pinned;

  const byRatio = [...list].sort((a, b) => b.progress.ratio - a.progress.ratio);
  const closest = byRatio[0];
  if (closest && closest.progress.ratio > 0) return closest;

  const smallWins = list.filter(
    (m) => m.typeSlug === "project_percent" && (m.progress.targetValue === 5 || m.progress.targetValue === 10)
  );
  if (smallWins.length > 0) return smallWins[0];

  return list[0];
}

/**
 * Create a custom or suggested milestone.
 */
export async function createMilestone(
  userId: string,
  data: CreateMilestoneInput
): Promise<{ id: string; name: string }> {
  const config = (data.config || {}) as JsonObject;
  const configKey = configToKey(config);
  const typeRow = await prisma.milestoneType.findUnique({
    where: { slug: data.typeSlug },
  });
  if (!typeRow || !typeRow.isEnabled) {
    throw new Error(`Milestone type ${data.typeSlug} is not available`);
  }

  const name =
    data.name ??
    `${typeRow.name} ${config.targetPercent ?? config.targetKm ?? config.targetWeeks ?? ""}`.trim();

  const created = await prisma.userMilestone.create({
    data: {
      userId,
      projectId: data.projectId ?? null,
      typeSlug: data.typeSlug,
      kind: "custom",
      config: config as object,
      configKey,
      name,
    },
  });
  return { id: created.id, name: created.name };
}

/**
 * Mark a milestone as completed.
 */
export async function completeMilestone(milestoneId: string): Promise<void> {
  await prisma.userMilestone.update({
    where: { id: milestoneId },
    data: { completedAt: new Date() },
  });
}

/**
 * Pin or unpin a milestone.
 */
export async function pinMilestone(
  milestoneId: string,
  isPinned: boolean
): Promise<void> {
  await prisma.userMilestone.update({
    where: { id: milestoneId },
    data: { isPinned },
  });
}

/**
 * Create auto milestones for a new project (by size).
 */
export async function createAutoMilestones(
  userId: string,
  projectId: string,
  projectSize: number
): Promise<void> {
  const typeRow = await prisma.milestoneType.findFirst({
    where: { slug: "project_percent", isEnabled: true },
  });
  if (!typeRow) return;

  const targets =
    projectSize < 80
      ? [50, 100]
      : projectSize < 250
        ? [25, 50, 100]
        : [10, 25, 50, 100];

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true },
  });
  const projectName = project?.name ?? "Project";

  for (const pct of targets) {
    const config = { targetPercent: pct };
    const configKey = configToKey(config);
    const existing = await prisma.userMilestone.findFirst({
      where: {
        userId,
        projectId,
        typeSlug: "project_percent",
        configKey,
      },
    });
    if (!existing) {
      await prisma.userMilestone.create({
        data: {
          userId,
          projectId,
          typeSlug: "project_percent",
          kind: "auto",
          config,
          configKey,
          name: `${pct}% of ${projectName}`,
        },
      });
    }
  }
}
