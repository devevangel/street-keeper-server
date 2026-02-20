/**
 * User preferences service
 * Get and update user preferences (distance unit, theme, etc.)
 */

import prisma from "../lib/prisma.js";

const ALLOWED_KEYS = [
  "timezone",
  "weekStartsOn",
  "lastViewedLat",
  "lastViewedLng",
  "lastViewedRadius",
  "distanceUnit",
  "theme",
  "dateFormat",
  "defaultMapZoom",
  "defaultProjectRadius",
  "defaultStreetFilter",
] as const;

export type UpdatePreferencesInput = Partial<{
  timezone: string;
  weekStartsOn: number;
  lastViewedLat: number;
  lastViewedLng: number;
  lastViewedRadius: number;
  distanceUnit: string;
  theme: string;
  dateFormat: string;
  defaultMapZoom: number;
  defaultProjectRadius: number;
  defaultStreetFilter: string;
}>;

export async function getPreferences(userId: string) {
  let prefs = await prisma.userPreferences.findUnique({
    where: { userId },
  });
  if (!prefs) {
    prefs = await prisma.userPreferences.create({
      data: { userId },
    });
  }
  return prefs;
}

export async function updatePreferences(userId: string, data: UpdatePreferencesInput) {
  const filtered: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    if (key in data && data[key as keyof UpdatePreferencesInput] !== undefined) {
      filtered[key] = data[key as keyof UpdatePreferencesInput];
    }
  }
  return prisma.userPreferences.upsert({
    where: { userId },
    update: filtered,
    create: { userId, ...filtered },
  });
}
