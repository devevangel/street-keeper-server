/**
 * User stats types for homepage and profile
 */

export type ExplorationStyle = "trailblazer" | "balanced" | "habitual";

export interface UserStats {
  totalActivities: number;
  totalDistanceKm: number;
  accountCreatedAt: string; // ISO
  favoriteStreets: Array<{ name: string; runCount: number }>;
  explorationStyle: ExplorationStyle;
  newVsRevisitRatio: number;
}
