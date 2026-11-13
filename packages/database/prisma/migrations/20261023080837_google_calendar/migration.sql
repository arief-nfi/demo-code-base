-- CreateEnum
CREATE TYPE "integration_calendar_connection_status" AS ENUM ('CONNECTED', 'NEEDS_RECONNECT', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "integration_calendar_link_status" AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'REMOVED');

-- CreateTable
CREATE TABLE "integration_calendar_connection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "externalAccountId" TEXT NOT NULL,
    "accountEmail" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "calendarId" TEXT,
    "calendarName" TEXT,
    "status" "integration_calendar_connection_status" NOT NULL DEFAULT 'CONNECTED',
    "lastError" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_calendar_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_calendar_event_link" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "desired" JSONB,
    "status" "integration_calendar_link_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_calendar_event_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_calendar_account_index" (
    "id" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "tenantSlug" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_calendar_account_index_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_calendar_connection_userId_key" ON "integration_calendar_connection"("userId");

-- CreateIndex
CREATE INDEX "integration_calendar_event_link_status_idx" ON "integration_calendar_event_link"("status");

-- CreateIndex
CREATE INDEX "integration_calendar_event_link_userId_idx" ON "integration_calendar_event_link"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_calendar_event_link_userId_source_key_key" ON "integration_calendar_event_link"("userId", "source", "key");

-- CreateIndex
CREATE INDEX "integration_calendar_account_index_externalAccountId_idx" ON "integration_calendar_account_index"("externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_calendar_account_index_tenantSlug_userId_key" ON "integration_calendar_account_index"("tenantSlug", "userId");

-- Backfill the new permissions into EXISTING tenants and grant them to ADMIN.
-- Guarded by "an ADMIN role exists": TenantsService.create runs this migration on a
-- brand-new schema before it creates roles and permissions (createMany would then
-- fail on a duplicate name), and the public schema has no roles.
INSERT INTO "Permission" ("id", "name", "description", "updatedAt")
SELECT gen_random_uuid()::text, v.name, v.description, CURRENT_TIMESTAMP
FROM (VALUES
  ('integration.google-calendar.connect', 'Connect your own Google Calendar'),
  ('integration.google-calendar.manage', 'Turn Google Calendar sync on or off and view sync status')
) AS v(name, description)
WHERE EXISTS (SELECT 1 FROM "Role" WHERE "name" = 'ADMIN')
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "_PermissionToRole" ("A", "B")
SELECT p."id", r."id"
FROM "Permission" p, "Role" r
WHERE r."name" = 'ADMIN'
  AND p."name" IN (
    'integration.google-calendar.connect',
    'integration.google-calendar.manage'
  )
ON CONFLICT DO NOTHING;
