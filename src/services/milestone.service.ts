/**
 * Milestone service: CRUD and progress computation for user milestones.
 * Progress is always returned in a unified shape (currentValue, targetValue, unit, ratio, isCompleted).
 */
import prisma from "../lib/prisma.js";
import { MILESTONES } from "../config/constants.js";
import { getStreak } from "./streak.service.js";
import { buildShareMessage } from "./share-message.service.js";
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

  const effectiveProjectId = data.projectId ?? null;
  const countWhere = {
    userId,
    completedAt: null,
    ...(effectiveProjectId !== null ? { projectId: effectiveProjectId } : { projectId: null }),
  };
  const existingCount = await prisma.userMilestone.count({ where: countWhere });
  const limit =
    effectiveProjectId !== null
      ? MILESTONES.MAX_ACTIVE_PER_PROJECT
      : MILESTONES.MAX_ACTIVE_GLOBAL;
  if (existingCount >= limit) {
    throw new Error(
      effectiveProjectId !== null
        ? `You can have at most ${limit} active milestones per project. Complete or remove one to add another.`
        : `You can have at most ${limit} global milestones. Complete or remove one to add another.`
    );
  }

  const name =
    data.name ??
    `${typeRow.name} ${config.targetPercent ?? config.targetKm ?? config.targetWeeks ?? config.targetCount ?? ""}`.trim();

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
 * Ensure a global milestone exists (create if not). Used for auto global milestones.
 */
async function upsertGlobalMilestone(
  userId: string,
  typeSlug: string,
  config: JsonObject,
): Promise<void> {
  const typeRow = await prisma.milestoneType.findFirst({
    where: { slug: typeSlug, isEnabled: true },
  });
  if (!typeRow) return;
  const configKey = configToKey(config);
  const existing = await prisma.userMilestone.findFirst({
    where: {
      userId,
      projectId: null,
      typeSlug,
      configKey,
    },
  });
  if (existing) return;
  const name =
    typeSlug === "first_run_ever"
      ? "First run"
      : typeSlug === "first_street_complete"
        ? "First street complete"
        : typeSlug === "single_run_distance_km"
          ? `${config.targetKm as number} km run`
          : typeRow.name;
  await prisma.userMilestone.create({
    data: {
      userId,
      projectId: null,
      typeSlug,
      kind: "auto",
      config: config as object,
      configKey,
      name,
    },
  });
}

/**
 * Create global auto milestones when they become relevant (after activity processing).
 */
export async function createGlobalAutoMilestonesIfNeeded(
  userId: string,
): Promise<void> {
  const activityCount = await prisma.activity.count({
    where: { userId, isProcessed: true },
  });
  if (activityCount >= 1) {
    await upsertGlobalMilestone(userId, "first_run_ever", {});
  }

  const hasComplete = await prisma.userStreetProgress.findFirst({
    where: { userId, everCompleted: true },
  });
  if (hasComplete) {
    await upsertGlobalMilestone(userId, "first_street_complete", {});
  }

  await upsertGlobalMilestone(userId, "single_run_distance_km", { targetKm: 5 });
  await upsertGlobalMilestone(userId, "single_run_distance_km", { targetKm: 10 });
}

/**
 * Create auto milestones for a new project (by size).
 * Legacy function - kept for backward compatibility.
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

  const baseTargets = [5, 10];
  const sizeTargets =
    projectSize < 80 ? [50, 100] : projectSize < 250 ? [25, 50, 100] : [25, 50, 100];
  const targets = [...new Set([...baseTargets, ...sizeTargets])].sort(
    (a, b) => a - b,
  );

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

// ============================================
// MVP Milestone Functions (Phase 1)
// ============================================

interface MilestoneConfig {
  type: "street_count" | "percentage" | "first_street";
  target: number;
  name: string;
}

/**
 * Generate MVP milestones for a project based on total street count.
 * Returns milestone configurations (does not create them in DB).
 */
export function generateMilestonesForProject(
  totalStreets: number,
): MilestoneConfig[] {
  const milestones: MilestoneConfig[] = [];

  // Always: First street
  milestones.push({ type: "first_street", target: 1, name: "First street!" });

  if (totalStreets <= 15) {
    // Tiny: 3, 50%, 100%
    milestones.push(
      { type: "street_count", target: 3, name: "Complete 3 streets" },
      { type: "percentage", target: 50, name: "Halfway there!" },
      { type: "percentage", target: 100, name: "Project complete!" },
    );
  } else if (totalStreets <= 50) {
    // Small: 5, 10, 50%, 100%
    milestones.push(
      { type: "street_count", target: 5, name: "Complete 5 streets" },
      { type: "street_count", target: 10, name: "Complete 10 streets" },
      { type: "percentage", target: 50, name: "Halfway there!" },
      { type: "percentage", target: 100, name: "Project complete!" },
    );
  } else if (totalStreets <= 150) {
    // Medium: 10, 25, 25%, 50%, 100%
    milestones.push(
      { type: "street_count", target: 10, name: "Complete 10 streets" },
      { type: "street_count", target: 25, name: "Complete 25 streets" },
      { type: "percentage", target: 25, name: "25% complete!" },
      { type: "percentage", target: 50, name: "Halfway there!" },
      { type: "percentage", target: 100, name: "Project complete!" },
    );
  } else {
    // Large: 10, 25, 50, 25%, 50%, 75%, 100%
    milestones.push(
      { type: "street_count", target: 10, name: "Complete 10 streets" },
      { type: "street_count", target: 25, name: "Complete 25 streets" },
      { type: "street_count", target: 50, name: "Complete 50 streets" },
      { type: "percentage", target: 25, name: "25% complete!" },
      { type: "percentage", target: 50, name: "Halfway there!" },
      { type: "percentage", target: 75, name: "75% complete!" },
      { type: "percentage", target: 100, name: "Project complete!" },
    );
  }

  return milestones;
}

/**
 * Create MVP milestones for a project (called on project creation).
 */
export async function createMVPMilestonesForProject(
  userId: string,
  projectId: string,
  totalStreets: number,
): Promise<void> {
  const milestoneConfigs = generateMilestonesForProject(totalStreets);

  // Get milestone types
  const typeMap = new Map<string, string>();
  for (const slug of ["street_count", "percentage", "first_street"]) {
    const type = await prisma.milestoneType.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (type) {
      typeMap.set(slug, type.id);
    }
  }

  // Create milestones
  for (const config of milestoneConfigs) {
    const typeId = typeMap.get(config.type);
    if (!typeId) continue;

    // Check if already exists
    const existing = await prisma.userMilestone.findFirst({
      where: {
        userId,
        projectId,
        typeId,
        targetValue: config.target,
      },
    });

    if (!existing) {
      await prisma.userMilestone.create({
        data: {
          userId,
          projectId,
          typeId,
          name: config.name,
          targetValue: config.target,
          currentValue: 0,
        },
      });
    }
  }
}

/**
 * Update milestone progress after activity sync.
 * Updates currentValue for MVP milestones based on project progress.
 * Uses street name counts (not segment counts) for accurate milestone tracking.
 */
export async function updateMilestoneProgress(
  userId: string,
  projectId: string,
  completedStreetNames: number,
  totalStreetNames: number,
): Promise<void> {
  const milestones = await prisma.userMilestone.findMany({
    where: {
      userId,
      projectId,
      completedAt: null,
      typeId: { not: null }, // Only MVP milestones have typeId
    },
    include: { type: true },
  });

  for (const milestone of milestones) {
    if (!milestone.typeId || !milestone.type) continue;

    let newValue: number;

    switch (milestone.type.slug) {
      case "street_count":
      case "first_street":
        // Use street name count, not segment count
        newValue = completedStreetNames;
        break;
      case "percentage":
        // Use street name count for percentage calculation
        newValue =
          totalStreetNames > 0
            ? (completedStreetNames / totalStreetNames) * 100
            : 0;
        break;
      default:
        continue;
    }

    await prisma.userMilestone.update({
      where: { id: milestone.id },
      data: { currentValue: newValue },
    });
  }
}

/**
 * Check for completed milestones and generate share messages.
 * Returns list of newly completed milestones.
 */
export async function checkMilestoneCompletion(
  userId: string,
  projectId: string,
  project: {
    name: string;
    totalStreets: number;
    completedStreets: number;
    totalStreetNames?: number;
    completedStreetNames?: number;
    city?: string;
  },
): Promise<Array<{ id: string; name: string; shareMessage: string }>> {
  const milestones = await prisma.userMilestone.findMany({
    where: {
      userId,
      projectId,
      completedAt: null,
      typeId: { not: null }, // Only MVP milestones
    },
    include: { type: true },
  });

  const completed: Array<{ id: string; name: string; shareMessage: string }> = [];

  for (const milestone of milestones) {
    if (!milestone.typeId || !milestone.type || !milestone.targetValue) continue;

    if (milestone.currentValue !== null && milestone.currentValue >= milestone.targetValue) {
      // Generate unique share message
      const shareMessage = buildShareMessage({
        milestone: {
          name: milestone.name,
          targetValue: milestone.targetValue,
          currentValue: milestone.currentValue,
          type: milestone.type,
        },
        project,
      });

      const updated = await prisma.userMilestone.update({
        where: { id: milestone.id },
        data: {
          completedAt: new Date(),
          shareMessage, // Store generated message
        },
      });

      completed.push({
        id: updated.id,
        name: updated.name,
        shareMessage: updated.shareMessage || "",
      });
    }
  }

  return completed;
}
