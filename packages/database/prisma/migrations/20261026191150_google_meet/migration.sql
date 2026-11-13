-- CreateEnum
CREATE TYPE "integration_meeting_access_type" AS ENUM ('TRUSTED', 'OPEN', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "integration_meeting_space_status" AS ENUM ('ACTIVE', 'CANCELLED', 'ORPHANED');

-- CreateEnum
CREATE TYPE "integration_meeting_lock_state" AS ENUM ('OPEN', 'LOCKED', 'PENDING', 'FAILED');

-- CreateTable
CREATE TABLE "integration_meeting_item" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT,
    "currentSpaceId" TEXT,
    "creatingSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_meeting_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_meeting_space" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "hostAccountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "spaceName" TEXT NOT NULL,
    "joinUrl" TEXT NOT NULL,
    "access" "integration_meeting_access_type" NOT NULL,
    "status" "integration_meeting_space_status" NOT NULL DEFAULT 'ACTIVE',
    "lockState" "integration_meeting_lock_state" NOT NULL DEFAULT 'OPEN',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_meeting_space_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_meeting_item_source_key_key" ON "integration_meeting_item"("source", "key");

-- CreateIndex
CREATE INDEX "integration_meeting_space_itemId_idx" ON "integration_meeting_space"("itemId");

-- CreateIndex
CREATE INDEX "integration_meeting_space_hostUserId_status_idx" ON "integration_meeting_space"("hostUserId", "status");

-- CreateIndex
CREATE INDEX "integration_meeting_space_lockState_idx" ON "integration_meeting_space"("lockState");

-- AddForeignKey
ALTER TABLE "integration_meeting_space" ADD CONSTRAINT "integration_meeting_space_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "integration_meeting_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The Google permissions now cover Calendar and Meet: update their descriptions in EXISTING
-- tenants. Guarded by "an ADMIN role exists", like the earlier plugin migrations: a brand-new
-- schema gets the new descriptions when its permissions are created, and public has none.
UPDATE "Permission" SET "description" = 'Connect your own Google account (Calendar, Meet)', "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'integration.google-calendar.connect' AND EXISTS (SELECT 1 FROM "Role" WHERE "name" = 'ADMIN');

UPDATE "Permission" SET "description" = 'Manage Google Calendar and Meet for the organization', "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'integration.google-calendar.manage' AND EXISTS (SELECT 1 FROM "Role" WHERE "name" = 'ADMIN');
