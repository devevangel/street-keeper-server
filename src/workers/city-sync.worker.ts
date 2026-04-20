/**
 * pg-boss worker: background Overpass city sync (singleton per relation).
 */

import {
  registerCitySyncWorker,
  type CitySyncJobPayload,
} from "../queues/activity.queue.js";
import { syncCity } from "../services/city-sync.service.js";

let workerId: string | undefined;

export async function startCitySyncWorker(): Promise<void> {
  workerId = await registerCitySyncWorker(async (payload: CitySyncJobPayload) => {
    await syncCity(BigInt(payload.relationId), {
      name: payload.name,
      adminLevel: payload.adminLevel,
    });
  });
}

export function getCitySyncWorkerId(): string | undefined {
  return workerId;
}
