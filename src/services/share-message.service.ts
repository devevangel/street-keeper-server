/**
 * Share Message Builder Service
 * Builds unique share messages for completed milestones using templates.
 * Uses Variable Rewards pattern - random selection from category.
 */

import { TEMPLATES, MessageTemplate } from "./share-templates.js";

export interface ShareContext {
  milestone: {
    name: string;
    targetValue: number;
    currentValue: number;
    type: { slug: string };
  };
  project: {
    name: string;
    totalStreets: number;
    completedStreets: number;
    totalStreetNames?: number;
    completedStreetNames?: number;
    city?: string;
  };
  activityType?: string; // Run, Walk, Hike, Trail Run
}

/**
 * Build a unique share message for a completed milestone.
 * Uses Variable Rewards pattern - random selection from category.
 */
export function buildShareMessage(ctx: ShareContext): string {
  const { milestone, project } = ctx;
  const typeSlug = milestone.type.slug;

  // Select template pool based on milestone type
  let pool: MessageTemplate[];

  if (typeSlug === "first_street") {
    // Mix first street templates with viral marketing templates for better shareability
    pool = TEMPLATES.filter(
      (t) => t.category === "first" || t.category === "viral",
    );
  } else if (typeSlug === "percentage" && milestone.targetValue === 100) {
    pool = TEMPLATES.filter((t) => t.category === "completion");
  } else if (typeSlug === "percentage") {
    pool = TEMPLATES.filter(
      (t) => t.category === "percentage" || t.category === "celebratory",
    );
  } else {
    // Default: mix of celebratory, proud, identity, playful, stats, motivational, viral
    pool = TEMPLATES.filter((t) =>
      [
        "celebratory",
        "proud",
        "identity",
        "playful",
        "stats",
        "motivational",
        "viral",
      ].includes(t.category),
    );
  }

  // Random selection (Variable Rewards)
  const template = pool[Math.floor(Math.random() * pool.length)];

  // Fill placeholders
  let message = fillPlaceholders(template.template, ctx);

  // Add attribution
  message += "\n— via Street Keeper";

  return message;
}

function fillPlaceholders(template: string, ctx: ShareContext): string {
  const { milestone, project, activityType } = ctx;
  
  // Use street names if available, fallback to segments
  const totalNames = project.totalStreetNames ?? project.totalStreets;
  const completedNames = project.completedStreetNames ?? project.completedStreets;
  
  const percent = Math.round(
    (completedNames / totalNames) * 100,
  );
  const remaining = totalNames - completedNames;
  
  // Map activity type to verb
  let activityVerb = "explored";
  if (activityType) {
    const typeLower = activityType.toLowerCase();
    if (typeLower === "run" || typeLower === "trail run") {
      activityVerb = "ran";
    } else if (typeLower === "walk") {
      activityVerb = "walked";
    } else if (typeLower === "hike") {
      activityVerb = "hiked";
    }
  }

  return template
    .replace(/{achievement}/g, milestone.name)
    .replace(/{project}/g, project.name)
    .replace(/{count}/g, String(completedNames))
    .replace(/{total}/g, String(totalNames))
    .replace(/{remaining}/g, String(remaining))
    .replace(/{percent}/g, String(percent))
    .replace(/{streetNames}/g, String(completedNames))
    .replace(/{totalNames}/g, String(totalNames))
    .replace(/{city}/g, project.city || "")
    .replace(/{activityVerb}/g, activityVerb);
}

/**
 * Get a preview of what categories are available.
 * Useful for debugging or admin views.
 */
export function getTemplateStats(): { category: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of TEMPLATES) {
    counts.set(t.category, (counts.get(t.category) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([category, count]) => ({
    category,
    count,
  }));
}
