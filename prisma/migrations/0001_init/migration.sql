-- Enable PostGIS (Supabase includes it; idempotent)
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "stravaId" TEXT,
    "garminId" TEXT,
    "email" TEXT,
    "name" TEXT NOT NULL,
    "profilePic" TEXT,
    "stravaAccessToken" TEXT,
    "stravaRefreshToken" TEXT,
    "stravaTokenExpiresAt" TIMESTAMP(3),
    "stravaGrantedScopes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "type" TEXT NOT NULL DEFAULT 'initial',
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "lastErrorMessage" TEXT,
    "after" INTEGER,
    "before" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "boundaryType" TEXT NOT NULL DEFAULT 'circle',
    "centerLat" DOUBLE PRECISION,
    "centerLng" DOUBLE PRECISION,
    "radiusMeters" INTEGER,
    "polygonCoordinates" JSONB,
    "boundaryMode" TEXT NOT NULL DEFAULT 'intersects',
    "streetsSnapshot" JSONB NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "totalStreets" INTEGER NOT NULL,
    "totalLengthMeters" DOUBLE PRECISION NOT NULL,
    "completedStreets" INTEGER NOT NULL DEFAULT 0,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalStreetNames" INTEGER,
    "completedStreetNames" INTEGER DEFAULT 0,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "countryCode" TEXT,
    "deadline" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "includePreviousRuns" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stravaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "distanceMeters" DOUBLE PRECISION NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "activityType" TEXT NOT NULL DEFAULT 'Run',
    "coordinates" JSONB NOT NULL,
    "isProcessed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectActivity" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "streetsCompleted" INTEGER NOT NULL,
    "streetsImproved" INTEGER NOT NULL,
    "impactDetails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserStreetProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "osmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "highwayType" TEXT NOT NULL,
    "lengthMeters" DOUBLE PRECISION NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "spatialCoverage" JSONB,
    "everCompleted" BOOLEAN NOT NULL DEFAULT false,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "completionCount" INTEGER NOT NULL DEFAULT 0,
    "firstRunDate" TIMESTAMP(3),
    "lastRunDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserStreetProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEdge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "edgeId" TEXT NOT NULL,
    "nodeA" BIGINT NOT NULL,
    "nodeB" BIGINT NOT NULL,
    "wayId" BIGINT NOT NULL,
    "wayName" TEXT,
    "highwayType" TEXT NOT NULL,
    "lengthMeters" DOUBLE PRECISION NOT NULL,
    "firstRunAt" TIMESTAMP(3) NOT NULL,
    "runCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WayCache" (
    "id" TEXT NOT NULL,
    "nodeId" BIGINT NOT NULL,
    "wayIds" JSONB NOT NULL,
    "wayMetadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WayCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CitySync" (
    "id" TEXT NOT NULL,
    "relationId" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "adminLevel" INTEGER NOT NULL,
    "nodeCount" INTEGER NOT NULL DEFAULT 0,
    "wayCount" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "boundary" geometry(Geometry,4326),

    CONSTRAINT "CitySync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WayTotalEdges" (
    "wayId" BIGINT NOT NULL,
    "totalEdges" INTEGER NOT NULL,
    "totalNodes" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT,
    "highwayType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "geometry" geometry(LineString,4326),
    "lengthMeters" DOUBLE PRECISION,
    "surface" TEXT,
    "access" TEXT,
    "ref" TEXT,
    "altNames" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "WayTotalEdges_pkey" PRIMARY KEY ("wayId")
);

-- CreateTable
CREATE TABLE "UserNodeHit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nodeId" BIGINT NOT NULL,
    "hitAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserNodeHit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WayNode" (
    "wayId" BIGINT NOT NULL,
    "nodeId" BIGINT NOT NULL,
    "sequence" INTEGER,

    CONSTRAINT "WayNode_pkey" PRIMARY KEY ("wayId","nodeId")
);

-- CreateTable
CREATE TABLE "NodeCache" (
    "nodeId" BIGINT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "geom" geometry(Point,4326),

    CONSTRAINT "NodeCache_pkey" PRIMARY KEY ("nodeId")
);

-- CreateTable
CREATE TABLE "MilestoneType" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'project',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "configSchema" JSONB,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMilestone" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "typeSlug" TEXT,
    "kind" TEXT,
    "config" JSONB,
    "configKey" TEXT,
    "typeId" TEXT,
    "targetValue" DOUBLE PRECISION,
    "currentValue" DOUBLE PRECISION DEFAULT 0,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "celebrationShownAt" TIMESTAMP(3),
    "shareMessage" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "weekStartsOn" INTEGER NOT NULL DEFAULT 1,
    "lastViewedLat" DOUBLE PRECISION,
    "lastViewedLng" DOUBLE PRECISION,
    "lastViewedRadius" INTEGER,
    "distanceUnit" TEXT NOT NULL DEFAULT 'km',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "dateFormat" TEXT NOT NULL DEFAULT 'short',
    "mapStyle" TEXT NOT NULL DEFAULT 'satellite',
    "defaultMapZoom" INTEGER NOT NULL DEFAULT 15,
    "defaultProjectRadius" INTEGER NOT NULL DEFAULT 300,
    "defaultStreetFilter" TEXT NOT NULL DEFAULT 'all',
    "autoUpdateRunDescription" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "event" TEXT NOT NULL,
    "properties" JSONB,
    "context" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuggestionCooldown" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cooldownKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuggestionCooldown_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_stravaId_key" ON "User"("stravaId");

-- CreateIndex
CREATE UNIQUE INDEX "User_garminId_key" ON "User"("garminId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "SyncJob_userId_idx" ON "SyncJob"("userId");

-- CreateIndex
CREATE INDEX "Project_userId_idx" ON "Project"("userId");

-- CreateIndex
CREATE INDEX "Project_userId_isArchived_idx" ON "Project"("userId", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_stravaId_key" ON "Activity"("stravaId");

-- CreateIndex
CREATE INDEX "Activity_userId_idx" ON "Activity"("userId");

-- CreateIndex
CREATE INDEX "Activity_stravaId_idx" ON "Activity"("stravaId");

-- CreateIndex
CREATE INDEX "Activity_userId_startDate_idx" ON "Activity"("userId", "startDate");

-- CreateIndex
CREATE INDEX "ProjectActivity_projectId_idx" ON "ProjectActivity"("projectId");

-- CreateIndex
CREATE INDEX "ProjectActivity_activityId_idx" ON "ProjectActivity"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectActivity_projectId_activityId_key" ON "ProjectActivity"("projectId", "activityId");

-- CreateIndex
CREATE INDEX "UserStreetProgress_userId_idx" ON "UserStreetProgress"("userId");

-- CreateIndex
CREATE INDEX "UserStreetProgress_userId_percentage_idx" ON "UserStreetProgress"("userId", "percentage");

-- CreateIndex
CREATE UNIQUE INDEX "UserStreetProgress_userId_osmId_key" ON "UserStreetProgress"("userId", "osmId");

-- CreateIndex
CREATE INDEX "UserEdge_userId_idx" ON "UserEdge"("userId");

-- CreateIndex
CREATE INDEX "UserEdge_userId_wayId_idx" ON "UserEdge"("userId", "wayId");

-- CreateIndex
CREATE INDEX "UserEdge_wayId_idx" ON "UserEdge"("wayId");

-- CreateIndex
CREATE UNIQUE INDEX "UserEdge_userId_edgeId_key" ON "UserEdge"("userId", "edgeId");

-- CreateIndex
CREATE UNIQUE INDEX "WayCache_nodeId_key" ON "WayCache"("nodeId");

-- CreateIndex
CREATE INDEX "WayCache_nodeId_idx" ON "WayCache"("nodeId");

-- CreateIndex
CREATE INDEX "WayCache_expiresAt_idx" ON "WayCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CitySync_relationId_key" ON "CitySync"("relationId");

-- CreateIndex
CREATE INDEX "CitySync_relationId_idx" ON "CitySync"("relationId");

-- CreateIndex
CREATE INDEX "CitySync_expiresAt_idx" ON "CitySync"("expiresAt");

-- CreateIndex
CREATE INDEX "UserNodeHit_userId_idx" ON "UserNodeHit"("userId");

-- CreateIndex
CREATE INDEX "UserNodeHit_nodeId_idx" ON "UserNodeHit"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "UserNodeHit_userId_nodeId_key" ON "UserNodeHit"("userId", "nodeId");

-- CreateIndex
CREATE INDEX "WayNode_nodeId_idx" ON "WayNode"("nodeId");

-- CreateIndex
CREATE INDEX "NodeCache_lat_lon_idx" ON "NodeCache"("lat", "lon");

-- CreateIndex
CREATE UNIQUE INDEX "MilestoneType_slug_key" ON "MilestoneType"("slug");

-- CreateIndex
CREATE INDEX "MilestoneType_isEnabled_idx" ON "MilestoneType"("isEnabled");

-- CreateIndex
CREATE INDEX "UserMilestone_userId_idx" ON "UserMilestone"("userId");

-- CreateIndex
CREATE INDEX "UserMilestone_projectId_idx" ON "UserMilestone"("projectId");

-- CreateIndex
CREATE INDEX "UserMilestone_userId_completedAt_idx" ON "UserMilestone"("userId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserMilestone_userId_projectId_typeSlug_configKey_key" ON "UserMilestone"("userId", "projectId", "typeSlug", "configKey");

-- CreateIndex
CREATE UNIQUE INDEX "UserMilestone_userId_projectId_typeId_targetValue_key" ON "UserMilestone"("userId", "projectId", "typeId", "targetValue");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreferences_userId_key" ON "UserPreferences"("userId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_idx" ON "AnalyticsEvent"("userId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_event_idx" ON "AnalyticsEvent"("event");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_timestamp_idx" ON "AnalyticsEvent"("timestamp");

-- CreateIndex
CREATE INDEX "SuggestionCooldown_userId_idx" ON "SuggestionCooldown"("userId");

-- CreateIndex
CREATE INDEX "SuggestionCooldown_expiresAt_idx" ON "SuggestionCooldown"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SuggestionCooldown_userId_cooldownKey_key" ON "SuggestionCooldown"("userId", "cooldownKey");

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStreetProgress" ADD CONSTRAINT "UserStreetProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEdge" ADD CONSTRAINT "UserEdge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNodeHit" ADD CONSTRAINT "UserNodeHit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMilestone" ADD CONSTRAINT "UserMilestone_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMilestone" ADD CONSTRAINT "UserMilestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMilestone" ADD CONSTRAINT "UserMilestone_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "MilestoneType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PostGIS spatial indexes
CREATE INDEX IF NOT EXISTS "WayTotalEdges_geometry_idx" ON "WayTotalEdges" USING GIST("geometry");
CREATE INDEX IF NOT EXISTS "NodeCache_geom_idx" ON "NodeCache" USING GIST("geom");
CREATE INDEX IF NOT EXISTS "CitySync_boundary_idx" ON "CitySync" USING GIST("boundary");

