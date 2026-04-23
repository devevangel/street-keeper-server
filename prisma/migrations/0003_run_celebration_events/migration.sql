-- Run celebration events (per activity + project)
CREATE TABLE "RunCelebrationEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "projectId" TEXT,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "startedCount" INTEGER NOT NULL DEFAULT 0,
    "improvedCount" INTEGER NOT NULL DEFAULT 0,
    "completedStreetNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "startedStreetNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "improvedStreetNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "projectProgressBefore" DOUBLE PRECISION NOT NULL,
    "projectProgressAfter" DOUBLE PRECISION NOT NULL,
    "projectCompleted" BOOLEAN NOT NULL DEFAULT false,
    "activityDistanceMeters" DOUBLE PRECISION NOT NULL,
    "activityDurationSeconds" INTEGER NOT NULL,
    "activityStartDate" TIMESTAMP(3) NOT NULL,
    "celebrationShownAt" TIMESTAMP(3),
    "sharedToStravaAt" TIMESTAMP(3),
    "shareMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunCelebrationEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RunCelebrationEvent_activityId_projectId_key" ON "RunCelebrationEvent"("activityId", "projectId");

CREATE INDEX "RunCelebrationEvent_userId_celebrationShownAt_idx" ON "RunCelebrationEvent"("userId", "celebrationShownAt");

CREATE INDEX "RunCelebrationEvent_userId_createdAt_idx" ON "RunCelebrationEvent"("userId", "createdAt");

ALTER TABLE "RunCelebrationEvent" ADD CONSTRAINT "RunCelebrationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RunCelebrationEvent" ADD CONSTRAINT "RunCelebrationEvent_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RunCelebrationEvent" ADD CONSTRAINT "RunCelebrationEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
