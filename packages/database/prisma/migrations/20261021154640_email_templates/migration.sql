-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "TenantConfig" ADD COLUMN     "emailReplyTo" TEXT,
ADD COLUMN     "emailSenderName" TEXT;

-- CreateTable
CREATE TABLE "email_message" (
    "id" TEXT NOT NULL,
    "tenantSlug" TEXT,
    "templateKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "to" TEXT[],
    "from" TEXT NOT NULL,
    "replyTo" TEXT,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "redacted" BOOLEAN NOT NULL DEFAULT false,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "email_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_template" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "email_template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_message_idempotencyKey_key" ON "email_message"("idempotencyKey");

-- CreateIndex
CREATE INDEX "email_message_createdAt_idx" ON "email_message"("createdAt");

-- CreateIndex
CREATE INDEX "email_message_status_createdAt_idx" ON "email_message"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_template_key_locale_key" ON "email_template"("key", "locale");

-- Backfill the new permissions into EXISTING tenants and grant them to ADMIN.
-- Guarded by "an ADMIN role exists": TenantsService.create runs this migration on a
-- brand-new schema before it creates roles and permissions (createMany would then
-- fail on a duplicate name), and the public schema has no roles.
INSERT INTO "Permission" ("id", "name", "description", "updatedAt")
SELECT gen_random_uuid()::text, v.name, v.description, CURRENT_TIMESTAMP
FROM (VALUES
  ('system.email.read', 'Permission to system.email.read'),
  ('system.email.write', 'Permission to system.email.write'),
  ('document-templates.email-template.read', 'View email templates'),
  ('document-templates.email-template.update', 'Edit, test and reset email templates')
) AS v(name, description)
WHERE EXISTS (SELECT 1 FROM "Role" WHERE "name" = 'ADMIN')
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "_PermissionToRole" ("A", "B")
SELECT p."id", r."id"
FROM "Permission" p, "Role" r
WHERE r."name" = 'ADMIN'
  AND p."name" IN (
    'system.email.read',
    'system.email.write',
    'document-templates.email-template.read',
    'document-templates.email-template.update'
  )
ON CONFLICT DO NOTHING;
