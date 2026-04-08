/**
 * pg-boss worker: deferred GPX analysis when city street data was not ready.
 */

import {
  registerGpxAnalyzeWorker,
  enqueueGpxAnalyzeJob,
  type GpxAnalyzeJobPayload,
} from "../queues/activity.queue.js";
import { isCitySynced } from "../services/city-sync.service.js";
import { runEnhancedGpxAnalysis } from "../services/gpx-analyze-runner.service.js";

let workerId: string | undefined;

export async function startGpxAnalyzeWorker(): Promise<void> {
  workerId = await registerGpxAnalyzeWorker(
    async (payload: GpxAnalyzeJobPayload) => {
      const synced = await isCitySynced(payload.centerLat, payload.centerLng);
      if (!synced) {
        if (payload.deferCount >= 5) {
          throw new Error(
            `[GPX] City not synced after ${payload.deferCount} deferrals — sync may have failed`,
          );
        }
        await enqueueGpxAnalyzeJob(
          { ...payload, deferCount: payload.deferCount + 1 },
          { startAfter: 30 },
        );
        return;
      }
      const buf = Buffer.from(payload.gpxBase64, "base64");
      const result = await runEnhancedGpxAnalysis(buf);
      console.log(
        `[GPX] Deferred analysis complete: ${result.streets.total} logical streets`,
      );
    },
  );
}

export function getGpxAnalyzeWorkerId(): string | undefined {
  return workerId;
}
