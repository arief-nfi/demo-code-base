import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, type EmailSendResult } from '@saas/backend';
import { EmailDefinitionsRegistry } from './definitions-registry';
import { EMAIL_DEFINITIONS, EmailService } from './email.service';
import type { EmailEnvelope } from './smtp-transport';

export type EmailStatusFilter = 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED';

export interface EmailLogQuery {
  status?: EmailStatusFilter;
  template?: string;
  /** A workspace log: only its own emails, or only those the platform sent it */
  origin?: EmailOrigin;
  /** The platform log: only the emails sent for this workspace (slug) */
  tenant?: string;
  page: number;
  limit: number;
}

/** `tenant`: the workspace's own email; `platform`: one the platform sent (read-only in a workspace log) */
export type EmailOrigin = 'tenant' | 'platform';

export interface EmailSettings {
  senderName: string | null;
  replyTo: string | null;
  /** What recipients see when no sender name is set: the tenant name */
  defaultSenderName: string;
}

// The list never carries message bodies; the detail view loads one message at a time
const LIST_FIELDS = {
  id: true, tenantSlug: true, templateKey: true, source: true, locale: true, to: true, from: true, replyTo: true,
  subject: true, redacted: true, isTest: true, note: true, status: true, attempts: true, lastError: true,
  createdAt: true, sentAt: true,
} as const;

/**
 * The email log and sender settings. `tenantSlug` picks the schema: a tenant's own
 * emails, or null for platform emails in the public schema (sysadmin).
 */
@Injectable()
export class EmailLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    @Inject(EMAIL_DEFINITIONS) private readonly definitions: EmailDefinitionsRegistry,
  ) {}

  async getSettings(tenantSlug: string): Promise<EmailSettings> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const config = await this.prisma.getTenantClient(tenantSlug).tenantConfig.findFirst();
    return { senderName: config?.emailSenderName ?? null, replyTo: config?.emailReplyTo ?? null, defaultSenderName: tenant.name };
  }

  async updateSettings(tenantSlug: string, settings: { senderName?: string | null; replyTo?: string | null }): Promise<EmailSettings> {
    const configs = this.prisma.getTenantClient(tenantSlug).tenantConfig;
    const config = await configs.findFirst();
    if (!config) throw new NotFoundException('Tenant settings not found');
    await configs.update({
      where: { id: config.id },
      data: {
        ...(settings.senderName !== undefined ? { emailSenderName: settings.senderName } : {}),
        ...(settings.replyTo !== undefined ? { emailReplyTo: settings.replyTo } : {}),
      },
    });
    return this.getSettings(tenantSlug);
  }

  async list(tenantSlug: string | null, query: EmailLogQuery) {
    const status = query.status ? { status: query.status } : {};
    const template = query.template ? { templateKey: query.template } : {};
    const meta = (total: number) => ({ total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) });
    const order = { createdAt: 'desc' } as const;

    // The platform log: every platform email, or those sent for one workspace
    if (!tenantSlug) {
      const where = { ...status, ...template, ...(query.tenant ? { tenantSlug: query.tenant } : {}) };
      const [rows, total] = await Promise.all([
        this.prisma.emailMessage.findMany({ where, select: LIST_FIELDS, orderBy: order, skip: (query.page - 1) * query.limit, take: query.limit }),
        this.prisma.emailMessage.count({ where }),
      ]);
      return { data: rows.map((row) => ({ ...row, origin: 'platform' as const })), meta: meta(total) };
    }

    // A workspace log: its own emails and the platform emails sent for it, newest first
    const own = { ...status, ...template };
    const sentTo = await this.sentToWorkspace(tenantSlug, query.template);
    const sent = { ...status, ...sentTo };
    const ownMessages = this.prisma.getTenantClient(tenantSlug).emailMessage;
    const withOwn = query.origin !== 'platform';
    const withSent = query.origin !== 'tenant' && sentTo !== null;

    const [ownTotal, sentTotal] = await Promise.all([
      withOwn ? ownMessages.count({ where: own }) : 0,
      withSent ? this.prisma.emailMessage.count({ where: sent }) : 0,
    ]);
    const total = ownTotal + sentTotal;
    const offset = (query.page - 1) * query.limit;
    if (offset >= total) return { data: [], meta: meta(total) };

    // A row's place in the merged list is at least its place in its own source, and at most that
    // plus the other source's size. So each source's first `offset - other total` rows come before
    // this page and are never read: a deep page reads about `limit` + the workspace's platform rows.
    const skipOwn = Math.max(0, offset - sentTotal);
    const skipSent = Math.max(0, offset - ownTotal);
    const end = offset + query.limit;
    const [ownRows, sentRows] = await Promise.all([
      withOwn && ownTotal > skipOwn
        ? ownMessages.findMany({ where: own, select: LIST_FIELDS, orderBy: order, skip: skipOwn, take: Math.min(end, ownTotal) - skipOwn })
        : [],
      withSent && sentTotal > skipSent
        ? this.prisma.emailMessage.findMany({ where: sent, select: LIST_FIELDS, orderBy: order, skip: skipSent, take: Math.min(end, sentTotal) - skipSent })
        : [],
    ]);
    const merged = [
      ...ownRows.map((row) => ({ ...row, origin: 'tenant' as EmailOrigin })),
      ...sentRows.map((row) => ({ ...row, origin: 'platform' as EmailOrigin })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    // What was read starts with the rows before this page that weren't skipped
    const first = offset - skipOwn - skipSent;
    return { data: merged.slice(first, first + query.limit), meta: meta(total) };
  }

  async get(tenantSlug: string | null, id: string) {
    if (!tenantSlug) {
      const message = await this.prisma.emailMessage.findUnique({ where: { id } });
      if (!message) throw new NotFoundException('Email not found');
      return { ...message, origin: 'platform' as EmailOrigin };
    }
    const own = await this.prisma.getTenantClient(tenantSlug).emailMessage.findUnique({ where: { id } });
    if (own) return { ...own, origin: 'tenant' as EmailOrigin };
    // A platform email is shown only to the workspace it was sent for, and only when its definition allows it
    const sentTo = await this.sentToWorkspace(tenantSlug);
    const sent = sentTo && (await this.prisma.emailMessage.findFirst({ where: { id, ...sentTo } }));
    if (!sent) throw new NotFoundException('Email not found');
    return { ...sent, origin: 'platform' as EmailOrigin };
  }

  /** Sends a failed email again from its logged copy. */
  async retry(tenantSlug: string | null, id: string): Promise<EmailSendResult> {
    const message = await this.get(tenantSlug, id);
    if (tenantSlug && message.origin === 'platform') {
      throw new ForbiddenException('Platform emails can only be resent from the platform email log');
    }
    if (message.redacted) {
      // The logged copy has [hidden] where the link was; the link itself is gone on purpose
      throw new ConflictException('This email held a one-time link and cannot be sent again. Ask the user to request a new link.');
    }
    if (message.status !== 'FAILED') {
      throw new ConflictException(`Only failed emails can be retried (this one is ${message.status})`);
    }

    // Claim it: of two retries at once, only one re-queues the email
    const claimed = await this.messages(tenantSlug).updateMany({ where: { id, status: 'FAILED' }, data: { status: 'QUEUED', lastError: null, queuedAt: new Date() } });
    if (claimed.count === 0) throw new ConflictException('This email is already being retried');

    const envelope: EmailEnvelope = {
      from: parseAddress(message.from),
      to: message.to,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      subject: message.subject,
      html: message.html,
      text: message.text,
    };
    // A new job id: the failed job may still exist under the message id
    return this.email.enqueueMessage(id, tenantSlug, envelope, false, `${id}:retry:${Date.now()}`);
  }

  /**
   * Which public rows are this workspace's: its slug, a template it may see, and sent since it
   * was created. A slug is free again once a workspace is deleted, and the platform log keeps
   * that workspace's rows: a new workspace with the same slug must not see them. Null: none.
   */
  private async sentToWorkspace(tenantSlug: string, template?: string) {
    const visible = this.visibleTemplates(template);
    if (visible.length === 0) return null;
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { createdAt: true } });
    if (!tenant) return null;
    return { tenantSlug, templateKey: { in: visible }, createdAt: { gte: tenant.createdAt } };
  }

  /** Platform emails a workspace sees in its own log (narrowed to one template when filtering) */
  private visibleTemplates(template?: string): string[] {
    return this.definitions
      .list()
      .filter(({ def }) => def.scope === 'platform' && def.showInTenantLog && (!template || def.key === template))
      .map(({ def }) => def.key);
  }

  private messages(tenantSlug: string | null) {
    return (tenantSlug ? this.prisma.getTenantClient(tenantSlug) : this.prisma).emailMessage;
  }
}

/** Reads back the `"Name" <address>` form EmailService logs */
function parseAddress(from: string): { name: string; address: string } {
  const match = /^"(.*)" <(.*)>$/.exec(from);
  return match ? { name: match[1], address: match[2] } : { name: '', address: from };
}
