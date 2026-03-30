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
  };
  /** Derived user state for panel content and copy */
  userState: UserState;
  /** Total synced activities count (when userState is has_runs_no_project) */
  totalActivities?: number;
  /** Total distance km across all activities (when userState is has_runs_no_project) */
  totalDistanceKm?: number;
  /** User's display name for personalization */
  userName?: string;
  /** First street suggestion for brand_new users (nearest short street near GPS) */
  firstStreet?: {
    osmId: string;
    name: string;
    lengthMeters: number;
    distanceFromUser: number;
    geometry: Array<{ lat: number; lng: number }>;
    bbox: [number, number, number, number];
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
