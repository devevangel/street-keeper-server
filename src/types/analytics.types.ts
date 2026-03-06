/**
 * Analytics event types for client-side event tracking
 */

// ============================================
// Event payload (client → server)
// ============================================

export interface AnalyticsEventPayload {
  event: string;
  properties?: Record<string, unknown>;
  sessionId?: string;
  timestamp?: string; // ISO
}

export interface AnalyticsEventsBatchRequest {
  events: AnalyticsEventPayload[];
}

// ============================================
// Stored event (server)
// ============================================

export interface StoredAnalyticsEvent {
  id: string;
  userId: string | null;
  sessionId: string | null;
  event: string;
  properties: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  timestamp: Date;
}
