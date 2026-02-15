/**
 * Analytics event tracking service.
 * Stores client-side events for homepage_viewed, suggestion_opened, etc.
 * Supports batch ingestion; can add queue/flush for high throughput later.
 */
import prisma from "../lib/prisma.js";
import type { AnalyticsEventPayload } from "../types/analytics.types.js";

const BATCH_FLUSH_MS = 2000;
const BATCH_MAX_SIZE = 20;

interface QueuedEvent {
  userId: string | null;
  sessionId: string | null;
  event: string;
  properties?: Record<string, unknown>;
  context?: Record<string, unknown>;
  timestamp?: string;
}

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Track a single event (enqueued and flushed in batch).
 */
export function trackEvent(
  userId: string | null,
  sessionId: string | null,
  event: string,
  properties?: Record<string, unknown>,
  context?: Record<string, unknown>
): void {
  queue.push({
    userId,
    sessionId,
    event,
    properties,
    context,
    timestamp: new Date().toISOString(),
  });
  scheduleFlush();
}

/**
 * Ingest a batch of events from the client (e.g. POST /analytics/events).
 */
export async function trackEventsBatch(
  userId: string | null,
  events: AnalyticsEventPayload[]
): Promise<void> {
  if (events.length === 0) return;

  const rows = events.map((e) => ({
    userId,
    sessionId: e.sessionId ?? null,
    event: e.event,
    properties: e.properties ?? null,
    context: null as Record<string, unknown> | null,
    timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
  }));

  await prisma.analyticsEvent.createMany({
    data: rows,
  });
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushQueue().catch((err) => console.error("[analytics] flush error:", err));
  }, BATCH_FLUSH_MS);
}

async function flushQueue(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, BATCH_MAX_SIZE);
  const data = batch.map((e) => ({
    userId: e.userId ?? null,
    sessionId: e.sessionId ?? null,
    event: e.event,
    properties: (e.properties ?? null) as object | null,
    context: (e.context ?? null) as object | null,
    timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
  }));
  await prisma.analyticsEvent.createMany({ data });
}

/**
 * Retrieve events for a user (debugging / exports).
 */
export async function getEventsByUser(
  userId: string,
  options: { limit?: number; since?: Date; event?: string } = {}
): Promise<{ id: string; event: string; properties: unknown; timestamp: Date }[]> {
  const { limit = 100, since, event } = options;
  const rows = await prisma.analyticsEvent.findMany({
    where: {
      userId,
      ...(since && { timestamp: { gte: since } }),
      ...(event && { event }),
    },
    orderBy: { timestamp: "desc" },
    take: limit,
    select: { id: true, event: true, properties: true, timestamp: true },
  });
  return rows;
}
