import type { z } from 'zod';

/**
 * Email contracts shared by core and plugins.
 *
 * Core (apps/api) provides EMAIL_SERVICE globally; a plugin sends with
 * `@Inject(EMAIL_SERVICE) email: IEmailService` and never imports core.
 * Emails are declared with `defineEmail` in a plugin's `src/emails.ts`.
 */

export type EmailLocale = 'en' | 'id';
export const EMAIL_LOCALES: readonly EmailLocale[] = ['en', 'id'];

/** `tenant`: speaks for the tenant, tenants can edit it. `platform`: speaks for the platform, core only. */
export type EmailScope = 'tenant' | 'platform';

export type EmailStatusValue = 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED';

export interface EmailContent {
  subject: string;
  html: string;
}

export interface EmailDefinition<V extends z.ZodObject = z.ZodObject> {
  /** `core.<name>` for core, `<plugin-key>.<name>` for plugins */
  key: string;
  scope: EmailScope;
  name: string;
  description: string;
  variables: V;
  sample: z.infer<V>;
  /** Variables a tenant edit must keep (e.g. the reset link) */
  required?: string[];
  /** Variables hidden in the email log; allowed only as a whole link href */
  sensitive?: string[];
  /**
   * Platform emails only: also listed (read-only) in the email log of the workspace it was
   * sent for. Opt-in, so an email to the platform team (contact sales) never shows.
   */
  showInTenantLog?: boolean;
  defaults: Record<EmailLocale, EmailContent>;
}

/** Identity helper that keeps `sample` typed against `variables`. */
export function defineEmail<V extends z.ZodObject>(def: EmailDefinition<V>): EmailDefinition<V> {
  return def;
}

export interface EmailSendInput {
  template: string;
  to: string | string[];
  data: Record<string, unknown>;
  /** Required for tenant-scope emails; for platform emails it sets the language and the log's tenant column */
  tenantSlug?: string;
  locale?: EmailLocale;
  /** Overrides the tenant's reply-to for this message (e.g. the person who filled in a form) */
  replyTo?: string;
  /** Sending again with the same key returns the first message and sends nothing */
  idempotencyKey?: string;
}

export interface EmailSendResult {
  messageId: string;
  status: EmailStatusValue;
}

export interface EmailDefinitionSummary {
  key: string;
  scope: EmailScope;
  /** `core` or the plugin key */
  source: string;
  name: string;
  description: string;
  variables: Array<{ name: string; description?: string }>;
  required: string[];
  sensitive: string[];
  sample: Record<string, unknown>;
  defaults: Record<EmailLocale, EmailContent>;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface IEmailService {
  send(input: EmailSendInput): Promise<EmailSendResult>;
  /** Tenant-scope definitions from core and from plugins enabled for the tenant */
  listTenantDefinitions(tenantSlug: string): Promise<EmailDefinitionSummary[]>;
  /** Platform-scope definitions (core only); sysadmins edit them */
  listPlatformDefinitions(): EmailDefinitionSummary[];
  /** Problems with an edit (tenant or platform) against the current definition; empty when it can be used */
  checkEdit(key: string, content: EmailContent): string[];
  /**
   * Renders `content` (or the default) with the definition's sample data: in the tenant
   * layout for a tenant email, or the platform layout when `tenantSlug` is null (a platform email)
   */
  preview(tenantSlug: string | null, key: string, locale: EmailLocale, content?: EmailContent): Promise<RenderedEmail>;
  /** Sends `content` (or the default) with sample data to one address, logged as a test (null: a platform email) */
  sendTest(tenantSlug: string | null, key: string, locale: EmailLocale, to: string, content?: EmailContent): Promise<EmailSendResult>;
}

export const EMAIL_SERVICE = Symbol('EMAIL_SERVICE');

/** Implemented by the plugin that stores edits (document-templates). */
export interface IEmailTemplateOverrides {
  /**
   * Edits are used only while this plugin is usable (enabled, and paid for) by the tenant;
   * platform edits follow its access for the System workspace
   */
  readonly pluginKey: string;
  /** `tenantSlug` null: the platform edit, stored in the public schema */
  find(tenantSlug: string | null, key: string, locale: EmailLocale): Promise<EmailContent | null>;
}

/** The workspace sysadmins sign in to */
export const SYSTEM_TENANT_SLUG = 'system';

export const EMAIL_TEMPLATE_OVERRIDES = Symbol('EMAIL_TEMPLATE_OVERRIDES');
