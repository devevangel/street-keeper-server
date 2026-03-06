/**
 * Milestone types for the engagement system.
 * Progress shape is unified so UI has no per-type branching.
 */

export type MilestoneUnit =
  | "percent"
  | "streets"
  | "km"
  | "weeks"
  | "runs"
  | "areas";

export interface MilestoneProgress {
  currentValue: number;
  targetValue: number;
  unit: MilestoneUnit;
  ratio: number; // 0-1, clamped
  isCompleted: boolean;
}

export interface MilestoneWithProgress {
  id: string;
  name: string;
  typeSlug: string;
  kind: "auto" | "suggested" | "custom";
  isPinned: boolean;
  progress: MilestoneProgress;
  projectId?: string | null;
}

export interface CreateMilestoneInput {
  typeSlug: string;
  projectId?: string;
  config: Record<string, unknown>;
  name?: string;
}

export interface MilestoneTypeInfo {
  id: string;
  slug: string;
  scope: string;
  name: string;
  description: string | null;
  configSchema: unknown;
  isEnabled: boolean;
  order: number;
}
