import type { PrismaClient } from '@saas/database';

/**
 * Models that exist in tenant schemas.
 * Compile-time guard — prevents accessing public-only models
 * (e.g., Tenant) via a tenant client.
 *
 * MAINTENANCE: Plugin model names are listed after the sentinel comment.
 * Run `pnpm plugins:merge-prisma` to auto-update this list when new plugins add models.
 */
type TenantModelKeys =
  // Core tenant models
  | 'tenant'
  | 'user'
  | 'role'
  | 'permission'
  | 'tenantConfig'
  | 'auditLog'
  | 'auditConfig'
  | 'plugin'
  | 'tenantSubscription'
  | 'notification'
  | 'notificationPreference'
  | 'file'
  | 'emailMessage'
  // Workflow models
  | 'workflowProcess'
  | 'workflowStep'
  | 'workflowTransition'
  // Import models
  | 'importJob'
  // Plugin-contributed models appended by merge-prisma-schemas.js
  | 'documentTemplate'
  | 'documentRender'
  | 'emailTemplate'
  | 'integrationPartner'
  | 'integrationWebhookEvent'
  | 'integrationWebhook'
  | 'integrationApiKey'
  | 'integrationWebhookDelivery'
  | 'calendarConnection'
  | 'calendarEventLink'
  | 'meetingItem'
  | 'meetingSpace'
  | 'sampleItem'
  | 'sampleArticle';

/**
 * A restricted PrismaClient type that only exposes tenant-schema models.
 * Returned by PrismaService.getTenantClient() to prevent accidental
 * access to public-schema-only models (e.g., Tenant).
 */
export type TenantPrismaClient = Pick<
  PrismaClient,
  | TenantModelKeys
  | '$transaction'
  | '$queryRaw'
  | '$executeRaw'
  | '$queryRawUnsafe'
  | '$executeRawUnsafe'
>;
