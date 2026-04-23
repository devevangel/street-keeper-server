/**
 * Homepage payload types (single aggregation response)
 */
import type { HomepageSuggestion } from "../services/suggestion.service.js";
import type { MilestoneWithProgress } from "./milestone.types.js";
import type { MapStreet } from "./map.types.js";

export type { HomepageSuggestion };

export type UserState =
  | "brand_new"
  | "syncing"
  | "has_runs_no_project"
  | "project_processing"
  | "active";

export interface HomepagePayload {
  primarySuggestion: HomepageSuggestion | null;
  alternates: HomepageSuggestion[];
  nextMilestone: MilestoneWithProgress | null;
  mapContext: {
    lat: number;
    lng: number;
    radius: number;
    projectId?: string;
  };
  /** Inlined street segments for the map (same data as GET /map/streets). Omitted when no real location. */
  mapSegments?: MapStreet[];
  /** Last run summary – set whenever user has any processed activity (so homepage can show "Last run: X days ago · Y km"). */
  lastRun?: {
    date: string; // ISO
    distanceKm: number;
    newStreets: number;
    daysAgo: number;
    activityId?: string;
    completedStreetNames?: string[];
    improvedStreetNames?: string[];
    bbox?: [number, number, number, number];
  };
  /** Derived user state for panel content and copy */
  userState: UserState;
  /** Total synced activities count (all states) */
  totalActivities?: number;
  /** Total distance km across all activities (all states) */
  totalDistanceKm?: number;
  /** User's display name for personalization */
  userName?: string;
  /** First street suggestion for brand_new users (nearest short street near GPS) — same as nearbyStreets[0] when present */
  firstStreet?: {
    osmId: string;
    name: string;
    lengthMeters: number;
    distanceFromUser: number;
    geometry: Array<{ lat: number; lng: number }>;
    bbox: [number, number, number, number];
  };
  /** 3–5 nearby short streets to explore (brand_new / has_runs_no_project + GPS) */
  nearbyStreets?: Array<{
    osmId: string;
    name: string;
    lengthMeters: number;
    distanceFromUser: number;
    geometry: Array<{ lat: number; lng: number }>;
    bbox: [number, number, number, number];
  }>;
  /** Recent activities for panel list (tappable → map) */
  recentRuns?: Array<{
    activityId: string;
    name: string;
    date: string;
    distanceKm: number;
    bbox: [number, number, number, number];
  }>;
  /** Map area aggregates from suggestion pipeline (same as GET /map/streets). */
  areaStats?: {
    totalStreets: number;
    completedCount: number;
    partialCount: number;
  };
  /** Primary project when map context is project-scoped */
  projectContext?: {
    id: string;
    name: string;
    totalStreets: number;
    completedStreets: number;
    progress: number;
  };
  /** Lifetime + this-calendar-month streets completed (from ProjectActivity), using user timezone for the month window */
  streetTotals: {
    lifetimeStreetsCompleted: number;
    streetsThisMonth: number;
    monthLabel: string;
  };
}

export interface MapContextQuery {
  lat?: string;
  lng?: string;
  radius?: string;
  projectId?: string;
  userLat?: string;
  userLng?: string;
}
