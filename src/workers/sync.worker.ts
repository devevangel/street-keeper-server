/**
 * Sync Job Worker
 * pg-boss worker that processes background Strava sync jobs (onboarding / initial import).
 */

import prisma from "../lib/prisma.js";
import { registerSyncWorker } from "../queues/activity.queue.js";
import { processSyncJob } from "../services/sync.service.js";

let workerId: string | undefined;
let isRunning = false;

export async function startSyncWorker(): Promise<boolean> {
  if (isRunning) {
    console.log("[Worker] Sync worker already running");
    return false;
  }

  try {
    workerId = await registerSyncWorker(async (payload) => {
      try {
        await processSyncJob(payload.syncJobId, payload.userId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[Worker] Sync job failed:", payload.syncJobId, msg);
        await prisma.syncJob.update({
          where: { id: payload.syncJobId },
          data: {
            status: "failed",
            lastErrorMessage: msg,
            completedAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }
    });

    if (!workerId) {
      console.log("[Worker] Queue is disabled, sync worker not started");
      return false;
    }

    isRunning = true;
    console.log(`[Worker] Sync worker started (id: ${workerId})`);
    return true;
  } catch (error) {
    console.error("[Worker] Failed to start sync worker:", error);
    return false;
  }
}

export async function stopSyncWorker(): Promise<void> {
  if (!isRunning) return;
  isRunning = false;
  workerId = undefined;
  console.log("[Worker] Sync worker stopped");
}
