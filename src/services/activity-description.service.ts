/**
 * Activity Description Builder
 * Generates a motivational Strava activity description after processing,
 * appended below the user's existing description (if any).
 *
 * The message includes:
 *  - streets completed / improved this run
 *  - overall project progress (if applicable)
 *  - a randomly chosen motivational line
 *  - hashtags for discoverability
 */

import type { ActivityProcessingResult } from "./activity-processor.service.js";

// ============================================
// Motivational lines — Variable Rewards pool
// ============================================

const MOTIVATIONAL_LINES: string[] = [
  "Every street counts.",
  "Mapping my neighborhood one run at a time.",
  "Running places I didn't know existed.",
  "Becoming a local legend, one street at a time.",
  "No street left behind.",
  "The map is filling in!",
  "Collecting streets like trophies.",
  "Street by street, I'm owning this area.",
  "My city, my playground.",
  "Exploring the roads less run.",
  "Another corner of the map uncovered.",
  "My neighbors think I'm lost. I'm not.",
  "Pac-Man mode: activated.",
  "Building my running map.",
  "If there's a street, I'll run it.",
];

const HASHTAGS = "#StreetKeeper #RunEveryStreet";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ============================================
// Public API
// ============================================

export interface DescriptionContext {
  /** Result returned by processActivity */
  processingResult: ActivityProcessingResult;
  /** Activity type from Strava (Run, Walk, Hike, Trail Run) */
  activityType?: string;
  /** Existing description the user already wrote on Strava — we append below it. */
  existingDescription?: string | null;
}

/**
 * Build the full Strava description (existing text + Street Keeper block).
 * Returns `null` when there's nothing interesting to report (e.g. 0 streets touched).
 */
export function buildActivityDescription(
  ctx: DescriptionContext,
): string | null {
  const { processingResult, existingDescription } = ctx;

  const block = buildStreetKeeperBlock(processingResult);
  if (!block) return null;

  const parts: string[] = [];
  const trimmed = existingDescription?.trim();
  if (trimmed) {
    parts.push(trimmed);
  }
  parts.push(block);
  return parts.join("\n\n");
}

// ============================================
// Internal helpers
// ============================================

function buildStreetKeeperBlock(
  result: ActivityProcessingResult,
): string | null {
  const lines: string[] = [];

  const totalCompleted = result.projects.reduce(
    (sum, p) => sum + p.streetsCompleted,
    0,
  );
  const totalImproved = result.projects.reduce(
    (sum, p) => sum + p.streetsImproved,
    0,
  );
  const totalCovered = result.projects.reduce(
    (sum, p) => sum + p.streetsCovered,
    0,
  );

  const standaloneCompleted = result.standaloneStreetsCompleted ?? 0;
  const standaloneCovered = result.standaloneStreetsCovered ?? 0;

  const anyCompleted = totalCompleted + standaloneCompleted;
  const anyCovered = totalCovered + standaloneCovered;

  if (anyCovered === 0) return null;

  // Headline
  if (anyCompleted > 0) {
    const noun = anyCompleted === 1 ? "street" : "streets";
    lines.push(`🏆 ${anyCompleted} new ${noun} completed!`);
  } else if (totalImproved > 0) {
    const noun = totalImproved === 1 ? "street" : "streets";
    lines.push(`📈 Progress on ${totalImproved} ${noun}`);
  } else {
    lines.push(`🗺️ Covered ${anyCovered} street${anyCovered !== 1 ? "s" : ""}`);
  }

  // Per-project summaries (if user has projects)
  for (const proj of result.projects) {
    if (proj.streetsCovered === 0) continue;
    const parts: string[] = [];
    if (proj.streetsCompleted > 0) {
      parts.push(`${proj.streetsCompleted} completed`);
    }
    if (proj.streetsImproved > 0) {
      parts.push(`${proj.streetsImproved} improved`);
    }
    if (parts.length > 0) {
      lines.push(`📍 ${proj.projectName}: ${parts.join(", ")}`);
    }
  }

  // Motivational line
  lines.push("");
  lines.push(pick(MOTIVATIONAL_LINES));

  // Hashtags + attribution
  lines.push("");
  lines.push(`${HASHTAGS}`);

  return `--- Street Keeper ---\n${lines.join("\n")}`;
}
