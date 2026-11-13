import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  CacheService,
  createEmailRenderer,
  EMAIL_TEMPLATE_OVERRIDES,
  JOB_NAMES,
  PluginAccess,
  PrismaService,
  QUEUE_NAMES,
  RETRY_POLICIES,
  SYSTEM_TENANT_SLUG,
  type ComposedEmail,
  type EmailContent,
  type EmailDefinition,
  type EmailDefinitionSummary,
  type EmailLocale,
  type EmailScope,
  type EmailSendInput,
  type EmailSendResult,
  type IEmailService,
  type IEmailTemplateOverrides,
  type RenderedEmail,
} from '@saas/backend';
import { EmailDefinitionsRegistry, type RegisteredEmail } from './definitions-registry';
import { EMAIL_ENV, type EmailEnv } from './email-env';
import { EMAIL_TRANSPORT, type EmailEnvelope, type EmailTransportRef } from './smtp-transport';
import type { EmailJob } from './email.processor';

export const EMAIL_DEFINITIONS = Symbol('EMAIL_DEFINITIONS');

interface Delivery {
  entry: RegisteredEmail;
  data: Record<string, unknown>;
  to: string[];
  tenantSlug?: string;
  locale?: EmailLocale;
  replyTo?: string;
  idempotencyKey?: string;
  isTest: boolean;
  /** Tenant-authored content to send instead of looking up the stored edit (a test of a draft) */
  draft?: EmailContent;
}

interface SenderContext {
  brandName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  locale?: EmailLocale;
  sender: { name: string; address: string };
  replyTo?: string;
}

type Layout = { brandName: string; logoUrl: string | null; primaryColor: string | null; footerText: string };

const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === 'P2002';
const formatAddress = ({ name, address }: { name: string; address: string }) => `"${name.replace(/["\\\r\n]/g, '')}" <${address}>`;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const notUsed = (problem: string) => `customized template not used: ${problem}`;

/**
 * The one way to send email. Renders a declared template (or the tenant's edit of
 * it), logs the message (tenant schema for tenant emails, public for platform
 * emails) and queues it; delivery happens in EmailProcessor, so callers never wait
 * for SMTP.
 */
@Injectable()
export class EmailService implements IEmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly renderer = createEmailRenderer();
  private readonly access: PluginAccess;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.EMAIL) private readonly queue: Queue,
    @Inject(EMAIL_ENV) private readonly env: EmailEnv,
    @Inject(EMAIL_DEFINITIONS) private readonly definitions: EmailDefinitionsRegistry,
    @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransportRef,
    private readonly moduleRef: ModuleRef,
    cache: CacheService,
  ) {
    this.access = new PluginAccess(prisma, cache);
  }

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    const entry = this.definitions.get(input.template);
    if (!entry) throw new BadRequestException(`Unknown email "${input.template}"`);

    const parsed = entry.def.variables.safeParse(input.data);
    if (!parsed.success) {
      throw new BadRequestException({ message: `Invalid data for email "${input.template}"`, issues: parsed.error.issues });
    }
    if (entry.def.scope === 'tenant' && !input.tenantSlug) {
      throw new BadRequestException(`Email "${input.template}" is sent for a tenant: tenantSlug is required`);
    }
    const to = (Array.isArray(input.to) ? input.to : [input.to]).map((address) => address?.trim()).filter(Boolean);
    if (to.length === 0) throw new BadRequestException(`Email "${input.template}" has no recipient`);
    if (input.replyTo !== undefined && /[\r\n]/.test(input.replyTo)) throw new BadRequestException('replyTo must be a single address');

    return this.deliver({
      entry,
      data: parsed.data as Record<string, unknown>,
      to,
      tenantSlug: input.tenantSlug,
      locale: input.locale,
      replyTo: input.replyTo?.trim() || undefined,
      idempotencyKey: input.idempotencyKey,
      isTest: false,
    });
  }

  async listTenantDefinitions(tenantSlug: string): Promise<EmailDefinitionSummary[]> {
    const summaries: EmailDefinitionSummary[] = [];
    for (const { def, source } of this.definitions.list()) {
      if (def.scope !== 'tenant') continue;
      if (source !== 'core' && !(await this.access.check(source, tenantSlug)).ok) continue;
      summaries.push(summarize(def, source));
    }
    return summaries;
  }

  listPlatformDefinitions(): EmailDefinitionSummary[] {
    return this.definitions.list().filter(({ def }) => def.scope === 'platform').map(({ def, source }) => summarize(def, source));
  }

  /** Platform edits get exactly the checks tenant edits get */
  checkEdit(key: string, content: EmailContent): string[] {
    const entry = this.definitions.get(key);
    if (!entry) return ['Unknown email'];
    return this.renderer.check(entry.def, content, { tenantAuthored: true });
  }

  async preview(tenantSlug: string | null, key: string, locale: EmailLocale, content?: EmailContent): Promise<RenderedEmail> {
    const { def } = this.editable(key, tenantSlug);
    const ctx = await this.context(def.scope, tenantSlug ?? undefined);
    const sample = def.sample as Record<string, unknown>;
    let composed: ComposedEmail;
    try {
      composed = this.renderer.compose(content ?? def.defaults[locale] ?? def.defaults.en, this.templateData(ctx, sample), this.layout(ctx), {
        tenantAuthored: !!content,
        sensitive: def.sensitive,
      });
    } catch (error) {
      throw new BadRequestException({ message: 'Template has problems', errors: { template: [errorText(error).split('\n')[0]] } });
    }
    // `errors` is the error shape GlobalExceptionFilter passes through to the client
    if (composed.problems.length > 0) throw new BadRequestException({ message: 'Template has problems', errors: { template: composed.problems } });
    return composed.fill(this.sensitiveValues(def, sample));
  }

  async sendTest(tenantSlug: string | null, key: string, locale: EmailLocale, to: string, content?: EmailContent): Promise<EmailSendResult> {
    const entry = this.editable(key, tenantSlug);
    if (content) {
      const problems = this.checkEdit(key, content);
      // `errors` is the error shape GlobalExceptionFilter passes through to the client
      if (problems.length > 0) throw new BadRequestException({ message: 'Template has problems', errors: { template: problems } });
    }
    return this.deliver({
      entry,
      data: entry.def.sample as Record<string, unknown>,
      to: [to],
      tenantSlug: tenantSlug ?? undefined,
      locale,
      isTest: true,
      draft: content,
    });
  }

  /** Puts a logged message on the queue; a message that can't be queued is marked FAILED. */
  async enqueueMessage(messageId: string, tenantSlug: string | null, envelope: EmailEnvelope, redacted: boolean, jobId = messageId): Promise<EmailSendResult> {
    const job: EmailJob = { messageId, tenantSlug, envelope };
    try {
      await this.queue.add(JOB_NAMES.SEND_EMAIL, job, {
        jobId,
        attempts: RETRY_POLICIES.email.attempts,
        backoff: RETRY_POLICIES.email.backoff,
        removeOnComplete: true,
        // A redacted message carries a live link only in its job: never keep it around
        removeOnFail: redacted ? true : { count: 500 },
      });
      return { messageId, status: 'QUEUED' };
    } catch (error) {
      this.logger.error(`Email ${messageId} could not be queued: ${errorText(error)}`);
      await this.messages(tenantSlug).update({ where: { id: messageId }, data: { status: 'FAILED', lastError: `Could not be queued: ${errorText(error)}` } });
      return { messageId, status: 'FAILED' };
    }
  }

  private async deliver(delivery: Delivery): Promise<EmailSendResult> {
    const { def, source } = delivery.entry;
    const ctx = await this.context(def.scope, delivery.tenantSlug);
    const locale = delivery.locale ?? ctx.locale ?? 'en';
    const fallback = def.defaults[locale] ?? def.defaults.en;
    const layout = this.layout(ctx);
    const data = this.templateData(ctx, delivery.data);
    const sensitive = def.sensitive ?? [];
    // Templates only ever see placeholders for sensitive values: the real link is written
    // into the validated <a href>s afterwards (fill), so no helper can copy it elsewhere.
    const options = { sensitive, requiredLinks: (def.required ?? []).filter((name) => sensitive.includes(name)) };
    const compose = (content: EmailContent, tenantAuthored: boolean) => this.renderer.compose(content, data, layout, { ...options, tenantAuthored });

    // An edit (or a draft under test) is used only while it still passes the current
    // definition's checks; otherwise the default goes out and the log says why.
    let composed: ComposedEmail | null = null;
    let note: string | null = null;
    const edit = delivery.draft ?? (await this.findEdit(def.scope === 'tenant' ? delivery.tenantSlug! : null, def.key, locale));
    if (edit) {
      // The decisive check renders the real data: a condition can hide a misuse from the sample
      const problems = this.renderer.check(def, edit, { tenantAuthored: true });
      if (problems.length > 0) {
        note = notUsed(problems[0]);
      } else {
        try {
          composed = compose(edit, true);
          if (composed.problems.length > 0) [note, composed] = [notUsed(composed.problems[0]), null];
        } catch (error) {
          note = notUsed(errorText(error).split('\n')[0]);
        }
      }
    }
    if (!composed) {
      composed = compose(fallback, false);
      if (composed.problems.length > 0) {
        throw new Error(`Email "${def.key}" default places a sensitive value unsafely: ${composed.problems.join('; ')}`);
      }
    }
    if (note) this.logger.warn(`${def.key} for ${delivery.tenantSlug}: ${note}`);

    const rendered = composed.fill(this.sensitiveValues(def, delivery.data));
    // The log never holds a live link: the same email with [hidden] in its place
    const logged = sensitive.length > 0 ? composed.fill(Object.fromEntries(sensitive.map((name) => [name, '[hidden]']))) : rendered;

    const replyTo = delivery.replyTo ?? ctx.replyTo;
    const schemaTenant = def.scope === 'tenant' ? delivery.tenantSlug! : null;
    const messages = this.messages(schemaTenant);
    let row: { id: string };
    try {
      row = await messages.create({
        data: {
          tenantSlug: delivery.tenantSlug ?? null,
          templateKey: def.key,
          source,
          locale,
          to: delivery.to,
          from: formatAddress(ctx.sender),
          replyTo: replyTo ?? null,
          subject: logged.subject,
          html: logged.html,
          text: logged.text,
          redacted: sensitive.length > 0,
          isTest: delivery.isTest,
          note,
          status: 'QUEUED',
          idempotencyKey: delivery.idempotencyKey ?? null,
        },
      });
    } catch (error) {
      if (delivery.idempotencyKey && isUniqueViolation(error)) {
        const existing = await messages.findUnique({ where: { idempotencyKey: delivery.idempotencyKey } });
        if (existing) return { messageId: existing.id, status: existing.status };
      }
      throw error;
    }

    if (!this.transport.current) {
      await messages.update({ where: { id: row.id }, data: { status: 'SKIPPED', lastError: 'SMTP not configured' } });
      return { messageId: row.id, status: 'SKIPPED' };
    }

    const envelope: EmailEnvelope = {
      from: ctx.sender,
      to: delivery.to,
      ...(replyTo ? { replyTo } : {}),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    };
    return this.enqueueMessage(row.id, schemaTenant, envelope, sensitive.length > 0);
  }

  /**
   * The stored edit, if the plugin that stores edits is usable by the tenant. A platform
   * edit (`tenantSlug` null) follows the System workspace's access, where sysadmins edit it.
   */
  private async findEdit(tenantSlug: string | null, key: string, locale: EmailLocale): Promise<EmailContent | null> {
    let provider: IEmailTemplateOverrides;
    try {
      provider = this.moduleRef.get<IEmailTemplateOverrides>(EMAIL_TEMPLATE_OVERRIDES, { strict: false });
    } catch {
      return null; // no plugin provides edits
    }
    if (!(await this.access.check(provider.pluginKey, tenantSlug ?? SYSTEM_TENANT_SLUG)).ok) return null;
    try {
      return await provider.find(tenantSlug, key, locale);
    } catch (error) {
      this.logger.warn(`Could not load the ${key} edit for ${tenantSlug ?? 'the platform'}, sending the default: ${errorText(error)}`);
      return null;
    }
  }

  private sensitiveValues(def: EmailDefinition, data: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries((def.sensitive ?? []).map((name) => [name, String(data[name] ?? '')]));
  }

  /** A tenant email for a tenant, or a platform email when `tenantSlug` is null */
  private editable(key: string, tenantSlug: string | null): RegisteredEmail {
    const entry = this.definitions.get(key);
    if (!entry || (tenantSlug === null) !== (entry.def.scope === 'platform')) throw new BadRequestException(`Email "${key}" cannot be edited`);
    return entry;
  }

  private layout(ctx: SenderContext): Layout {
    return {
      brandName: ctx.brandName,
      logoUrl: ctx.logoUrl,
      primaryColor: ctx.primaryColor,
      footerText: `© ${new Date().getFullYear()} ${ctx.brandName}`,
    };
  }

  /** Variables every template gets, under the definition's own */
  private templateData(ctx: SenderContext, data: Record<string, unknown>): Record<string, unknown> {
    return { company: { name: ctx.brandName, logoUrl: ctx.logoUrl ?? '' }, appUrl: this.env.frontendUrl, ...data };
  }

  private async context(scope: EmailScope, tenantSlug?: string): Promise<SenderContext> {
    const platformName = this.env.mailFromName ?? 'SaaS';
    const mailFrom = this.env.mailFrom ?? '';

    const tenant = tenantSlug ? await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } }) : null;
    if (scope === 'tenant' && !tenant) throw new BadRequestException(`Unknown tenant "${tenantSlug}"`);
    const config = tenant ? await this.prisma.getTenantClient(tenant.slug).tenantConfig.findFirst() : null;
    const locale: EmailLocale | undefined = config?.language === 'INDONESIA' ? 'id' : config?.language === 'ENGLISH' ? 'en' : undefined;

    if (scope === 'platform') {
      return { brandName: platformName, logoUrl: null, primaryColor: null, locale, sender: { name: platformName, address: mailFrom } };
    }
    const brandName = tenant!.name;
    return {
      brandName,
      logoUrl: this.absoluteUrl(config?.logo),
      primaryColor: config?.primaryColor ?? null,
      locale,
      sender: { name: config?.emailSenderName?.trim() || brandName, address: mailFrom },
      replyTo: config?.emailReplyTo || undefined,
    };
  }

  private absoluteUrl(path?: string | null): string | null {
    if (!path) return null;
    if (/^https?:\/\//i.test(path)) return path;
    return `${this.env.apiPublicUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  private messages(tenantSlug: string | null) {
    return (tenantSlug ? this.prisma.getTenantClient(tenantSlug) : this.prisma).emailMessage;
  }
}

function summarize(def: EmailDefinition, source: string): EmailDefinitionSummary {
  return {
    key: def.key,
    scope: def.scope,
    source,
    name: def.name,
    description: def.description,
    variables: Object.entries(def.variables.shape).map(([name, schema]) => {
      const description = (schema as { description?: string }).description;
      return description ? { name, description } : { name };
    }),
    required: def.required ?? [],
    sensitive: def.sensitive ?? [],
    sample: def.sample as Record<string, unknown>,
    defaults: def.defaults,
  };
}
