/**
 * Homepage payload types (single aggregation response)
 */
import type { HeroState } from "../services/hero.service.js";
import type { StreakData } from "../services/streak.service.js";
import type { HomepageSuggestion } from "../services/suggestion.service.js";
import type { MilestoneWithProgress } from "./milestone.types.js";

export type { HeroState, StreakData, HomepageSuggestion };

export interface HomepagePayload {
  hero: HeroState;
  streak: StreakData;
  primarySuggestion: HomepageSuggestion | null;
  alternates: HomepageSuggestion[];
  nextMilestone: MilestoneWithProgress | null;
  mapContext: {
    lat: number;
    lng: number;
    radius: number;
    projectId?: string;
  };
  /** Last run summary – set whenever user has any processed activity (so homepage can show "Last run: X days ago · Y km"). */
  lastRun?: {
    date: string; // ISO
    distanceKm: number;
    newStreets: number;
    daysAgo: number;
  };
  /** Rich highlight for runs within last 7 days (new streets + distance). */
  recentHighlights?: {
    newStreets: number;
    distanceKm: number;
  };
  /** Whether this is a new user (no activities yet) */
  isNewUser: boolean;
  /** User's display name for personalization */
  userName?: string;
  /** First street suggestion for new users (nearest shortest street) */
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
