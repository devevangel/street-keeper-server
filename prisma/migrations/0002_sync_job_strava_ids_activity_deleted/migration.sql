-- Sync job: stable Strava activity ID list for crash-safe resume
ALTER TABLE "SyncJob" ADD COLUMN IF NOT EXISTS "stravaActivityIds" JSONB;

-- Soft-delete activities from Strava (webhook delete); do not purge node hits
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "isDeleted" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Activity_userId_isDeleted_idx" ON "Activity" ("userId", "isDeleted");
