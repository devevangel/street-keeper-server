/**
 * Overpass Service
 * Queries OpenStreetMap via Overpass API for street data.
 *
 * Rate-limiting strategy (from the official docs):
 *
 * The Overpass public servers expose /api/status which reports how many
 * query slots a client currently has free and, if none, when the next
 * slot opens.  HTTP 504 means "server rejected the query because the
 * declared [timeout:][maxsize:] exceeds currently available capacity."
 * HTTP 429 means "rate-limited — try later."
 *
 * overpass-api.de resolves (DNS round-robin) to two independent servers,
 * gall.openstreetmap.de and lambert.openstreetmap.de, each with its own
 * rate-limit pool.  We probe both in parallel, pick whichever has a free
 * slot, and wait only when truly necessary.
 *
 * @see https://dev.overpass-api.de/overpass-doc/en/preface/commons.html
 * @see https://wiki.openstreetmap.org/wiki/Overpass_API
 */

import axios from "axios";
import type { OverpassResponse } from "../types/run.types.js";
import { OVERPASS } from "../config/constants.js";

// ============================================
// Server Status & Slot Management
// ============================================

interface SlotInfo {
  slotsAvailable: number;
  /** Seconds until the soonest slot opens (null if unknown) */
  waitSeconds: number | null;
}

function serverName(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Query /api/status on a single Overpass server.
 * Returns slot availability, or null if the server is unreachable.
 *
 * Response format (plain text):
 *   Connected as: 1234567890
 *   Current time: 2026-04-07T12:00:00Z
 *   Rate limit: 2
 *   2 slots available now.
 *   — or —
 *   Slot available after: 2026-04-07T12:00:05Z, in 5 seconds.
 */
async function checkServerStatus(serverUrl: string): Promise<SlotInfo | null> {
  const statusUrl = serverUrl.replace(/\/interpreter$/, "/status");
  try {
    const res = await axios.get<string>(statusUrl, {
      timeout: 2_000,
      responseType: "text",
      headers: {
        "User-Agent": "StreetKeeper/1.0 (https://street-keeper-client.vercel.app; contact@streetkeeper.app)",
      },
    });
    const text = res.data;

    const slotsMatch = text.match(/(\d+) slots? available now/);
    if (slotsMatch) {
      return {
        slotsAvailable: parseInt(slotsMatch[1], 10),
        waitSeconds: null,
      };
    }

    // Multiple "Slot available after:" lines may appear — grab the first (soonest).
    const waitMatch = text.match(/Slot available after:.*?in (\d+) seconds/);
    if (waitMatch) {
      return {
        slotsAvailable: 0,
        waitSeconds: parseInt(waitMatch[1], 10),
      };
    }

    return { slotsAvailable: 0, waitSeconds: null };
  } catch {
    return null;
  }
}

interface ServerCandidate {
  url: string;
  status: SlotInfo | null;
}

/**
 * Probe all configured servers in parallel and return them ordered by
 * readiness: servers with free slots first, then shortest wait, then
 * unreachable ones last (still attempted as a hail-mary).
 */
async function rankServers(): Promise<ServerCandidate[]> {
  const results = await Promise.allSettled(
    OVERPASS.SERVERS.map(async (url) => ({
      url,
      status: await checkServerStatus(url),
    })),
  );

  const candidates: ServerCandidate[] = results
    .filter(
      (r): r is PromiseFulfilledResult<ServerCandidate> =>
        r.status === "fulfilled",
    )
    .map((r) => r.value);

  candidates.sort((a, b) => {
    const aReady = a.status?.slotsAvailable ?? 0;
    const bReady = b.status?.slotsAvailable ?? 0;
    if (aReady > 0 && bReady <= 0) return -1;
    if (aReady <= 0 && bReady > 0) return 1;
    const aWait = a.status?.waitSeconds ?? Infinity;
    const bWait = b.status?.waitSeconds ?? Infinity;
    return aWait - bWait;
  });

  // Append any servers whose status check threw (e.g. network error) at the end.
  const seen = new Set(candidates.map((c) => c.url));
  for (const url of OVERPASS.SERVERS) {
    if (!seen.has(url)) {
      candidates.push({ url, status: null });
    }
  }

  return candidates;
}

// ============================================
// Core Execution
// ============================================

const NETWORK_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNABORTED",
]);

export interface OverpassQueryOptions {
  /**
   * Max seconds to spend waiting for a free slot across all servers.
   * Use a short budget (default) for user-facing request paths and a
   * longer one for pg-boss background jobs.
   */
  maxWaitSeconds?: number;
  /**
   * Set for known call sites (e.g. "city-sync", "detect-city") so unexpected
   * callers can be logged in production.
   */
  caller?: string;
}

/**
 * Execute an Overpass query with status-aware server selection.
 *
 * Flow:
 * 1. Probe all servers' /api/status in parallel (~2 s max).
 * 2. Try each server in readiness order.  If a server reports
 *    "slot available in N seconds" and we have budget, wait for it.
 * 3. On 504 (capacity rejection), re-check status and wait once more
 *    before moving to the next server.
 * 4. On DNS / network failure, immediately skip to the next server.
 * 5. On 400 (bad query), throw immediately — retrying won't help.
 */
export async function executeRawOverpassQuery(
  query: string,
  opts?: OverpassQueryOptions,
): Promise<OverpassResponse> {
  const caller = opts?.caller;
  if (
    caller !== "city-sync" &&
    caller !== "detect-city"
  ) {
    console.warn(
      "[OVERPASS_USER_PATH] Unexpected Overpass call — pass opts.caller for known sites",
      { caller: caller ?? "unknown" },
    );
  }

  const waitBudget = opts?.maxWaitSeconds ?? OVERPASS.MAX_SLOT_WAIT_SECONDS;
  const deadline = Date.now() + waitBudget * 1_000;
  const errors: string[] = [];

  const candidates = await rankServers();

  for (const { url, status } of candidates) {
    const host = serverName(url);

    // Wait for slot if the server told us when one opens.
    if (status && status.slotsAvailable <= 0 && status.waitSeconds != null) {
      const waitMs = (status.waitSeconds + 1) * 1_000;
      if (Date.now() + waitMs > deadline) {
        errors.push(`${host}: slot in ${status.waitSeconds}s exceeds deadline`);
        continue;
      }
      console.log(
        `[Overpass] ${host}: waiting ${status.waitSeconds}s for slot`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }

    // Attempt the query (with one status-aware retry on 504).
    for (let attempt = 0; attempt < OVERPASS.MAX_RETRIES; attempt++) {
      try {
        const response = await axios.post<OverpassResponse>(url, query, {
          headers: {
            "Content-Type": "text/plain",
            "User-Agent": "StreetKeeper/1.0 (https://street-keeper-client.vercel.app; contact@streetkeeper.app)",
          },
          timeout: OVERPASS.TIMEOUT_MS,
        });

        console.log(`[Overpass] ${host}: success (attempt ${attempt + 1})`);
        return response.data;
      } catch (error) {
        const msg = describeError(error);
        errors.push(`${host}: ${msg}`);
        console.warn(
          `[Overpass] ${host} failed (attempt ${attempt + 1}/${OVERPASS.MAX_RETRIES}): ${msg}`,
        );

        if (!axios.isAxiosError(error)) break;

        // Bad request → query is wrong, retrying won't help.
        if (error.response?.status === 400) {
          throw new OverpassError(`Bad Overpass query: ${msg}`);
        }

        // Network-level failure → this server is unreachable, skip.
        if (error.code && NETWORK_ERROR_CODES.has(error.code)) break;

        const httpStatus = error.response?.status;

        // 406 (Not Acceptable) → server is refusing our requests (IP/UA policy). Skip immediately.
        if (httpStatus === 406) break;

        // 504 (capacity) or 429 (rate-limit): re-check status, wait if slot imminent.
        if (
          (httpStatus === 504 || httpStatus === 429) &&
          attempt < OVERPASS.MAX_RETRIES - 1
        ) {
          const fresh = await checkServerStatus(url);
          if (fresh?.waitSeconds != null && fresh.waitSeconds > 0) {
            const waitMs = (fresh.waitSeconds + 1) * 1_000;
            if (Date.now() + waitMs <= deadline) {
              console.log(
                `[Overpass] ${host}: slot in ${fresh.waitSeconds}s, waiting before retry`,
              );
              await new Promise((r) => setTimeout(r, waitMs));
              continue;
            }
          }
          // No slot info — short backoff then retry or move on.
          const backoff = Math.min(2_000 * Math.pow(2, attempt), 10_000);
          if (Date.now() + backoff <= deadline) {
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
          break; // out of time, try next server
        }
      }
    }
  }

  throw new OverpassError(
    `All Overpass servers failed. Errors:\n  ${errors.join("\n  ")}`,
  );
}

function describeError(error: unknown): string {
  if (!axios.isAxiosError(error)) return String(error);
  if (error.code === "ECONNABORTED")
    return `timeout after ${OVERPASS.TIMEOUT_MS}ms`;
  const status = error.response?.status;
  if (status === 504) return "504 — server has no capacity (reduce timeout/maxsize)";
  if (status === 429) return "429 — rate-limited";
  if (status === 503) return "503 — service unavailable";
  if (status === 502) return "502 — bad gateway";
  if (status === 400) return `400 — bad request: ${error.message}`;
  return `${status ?? error.code ?? "unknown"}: ${error.message}`;
}

// ============================================
// Custom Error Class
// ============================================

export class OverpassError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OverpassError";
  }
}
