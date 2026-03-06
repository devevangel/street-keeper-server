/**
 * Recalculate project progress for all projects using the fixed street name counting logic.
 * 
 * This fixes projects that have incorrect progress due to the bug where
 * completedStreets counted segments instead of street names.
 * 
 * Updates:
 * - completedStreetNames (from snapshot)
 * - totalStreetNames (from snapshot)
 * - completedStreets (segment count - kept for backward compatibility)
 * - progress (recalculated percentage)
 * 
 * Usage (from backend directory):
 *   npm run recalculate:project-progress
 */

import "dotenv/config";

import prisma from "../lib/prisma.js";
import type { StreetSnapshot } from "../types/project.types.js";
import { normalizeStreetName } from "../utils/normalize-street-name.js";

// Copy of groupSnapshotByStreetName function (not exported from service)
// Groups streets by normalized name and counts completed street names
function groupSnapshotByStreetName(snapshot: StreetSnapshot): {
  totalStreetNames: number;
  completedStreetNames: number;
} {
  const byName = new Map<string, any[]>();
  for (const s of snapshot.streets) {
    const key = normalizeStreetName(s.name || "Unnamed");
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(s);
  }
  let completed = 0;
  for (const ways of byName.values()) {
    // A street name is complete only when ALL its segments are complete
    if (ways.every((w) => w.completed)) {
      completed += 1;
    }
  }
  return {
    totalStreetNames: byName.size,
    completedStreetNames: completed,
  };
}

async function main(): Promise<void> {
  console.log("[Recalculate] Finding all projects...");

  const projects = await prisma.project.findMany({
    select: {
      id: true,
      name: true,
      userId: true,
      streetsSnapshot: true,
      totalStreets: true,
      completedStreets: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`[Recalculate] Found ${projects.length} project(s).`);

  if (projects.length === 0) {
    console.log("[Recalculate] No projects to update.");
    return;
  }

  let updatedCount = 0;
  let errorCount = 0;

  for (const project of projects) {
    try {
      const snapshot = project.streetsSnapshot as StreetSnapshot;
      
      if (!snapshot || !snapshot.streets || snapshot.streets.length === 0) {
        console.log(`[Recalculate] ⚠ Skipping project "${project.name}" - no streets in snapshot`);
        continue;
      }

      // Calculate street name-based counts using the fixed logic
      const { totalStreetNames, completedStreetNames } = groupSnapshotByStreetName(snapshot);

      // Recalculate segment-based counts (for backward compatibility)
      const completedStreets = snapshot.streets.filter((s) => s.completed).length;
      const totalStreets = snapshot.streets.length;

      // Recalculate progress percentage (using street names, not segments)
      const progress = totalStreetNames > 0 
        ? (completedStreetNames / totalStreetNames) * 100 
        : 0;

      // Update project with recalculated values
      // Note: totalStreetNames and completedStreetNames are only available after migration
      // This script will work before migration (updating only existing fields)
      await prisma.project.update({
        where: { id: project.id },
        data: {
          completedStreets, // Keep segment count for backward compatibility
          totalStreets, // Should already be correct, but ensure it matches snapshot
          progress,
          // After running migration, uncomment these:
          // totalStreetNames,
          // completedStreetNames,
        },
      });

      updatedCount++;
      
      const oldProgress = Math.round((project.completedStreets / project.totalStreets) * 100);
      const newProgress = Math.round(progress);
      
      if (oldProgress !== newProgress || completedStreetNames !== project.completedStreets) {
        console.log(
          `[Recalculate] ✓ "${project.name}": ${completedStreetNames}/${totalStreetNames} street names ` +
          `(was ${project.completedStreets}/${project.totalStreets} segments) | Progress: ${newProgress}% (was ${oldProgress}%)`
        );
      } else {
        console.log(`[Recalculate] ✓ "${project.name}" - no change needed`);
      }
    } catch (err) {
      errorCount++;
      console.error(
        `[Recalculate] ✗ Failed to update project "${project.name}" (${project.id}):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    `\n[Recalculate] Done. Updated ${updatedCount} project(s)${errorCount > 0 ? `, ${errorCount} error(s)` : ""}.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
