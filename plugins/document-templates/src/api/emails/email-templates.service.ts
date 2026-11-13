import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  EMAIL_SERVICE,
  PrismaService,
  sanitizeEmailHtml,
  type EmailContent,
  type EmailLocale,
  type IEmailService,
  type IEmailTemplateOverrides,
} from '@saas/backend';

export interface EmailTemplateEdit {
  key: string;
  locale: string;
  subject: string;
  html: string;
  version: number;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

/**
 * Edits of the emails core and plugins declare. Core reads them through
 * EMAIL_TEMPLATE_OVERRIDES, and only while this plugin is usable by the tenant.
 * `tenantSlug` null is the platform's edit of a platform email, kept in the public
 * schema; core uses it while this plugin is usable by the System workspace.
 */
@Injectable()
export class EmailTemplatesService implements IEmailTemplateOverrides {
  readonly pluginKey = 'document-templates';

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_SERVICE) private readonly email: IEmailService,
  ) {}

  async find(tenantSlug: string | null, key: string, locale: EmailLocale): Promise<EmailContent | null> {
    const row = await this.db(tenantSlug).emailTemplate.findUnique({ where: { key_locale: { key, locale } } });
    return row ? { subject: row.subject, html: row.html } : null;
  }

  listEdits(tenantSlug: string | null): Promise<EmailTemplateEdit[]> {
    return this.db(tenantSlug).emailTemplate.findMany({ orderBy: [{ key: 'asc' }, { locale: 'asc' }] });
  }

  /** Cleans the HTML, then refuses anything the current definition doesn't allow. */
  async save(tenantSlug: string | null, key: string, locale: EmailLocale, content: EmailContent, userId?: string): Promise<EmailTemplateEdit> {
    const subject = content.subject.trim();
    if (!subject || subject.length > 200 || /[\r\n]/.test(subject)) {
      throw new BadRequestException({ message: 'Template has problems', errors: { template: ['The subject must be one line of 1–200 characters'] } });
    }
    const html = sanitizeEmailHtml(content.html);

    const problems = this.email.checkEdit(key, { subject, html });
    // `errors` is the error shape GlobalExceptionFilter passes through to the client
    if (problems.length > 0) throw new BadRequestException({ message: 'Template has problems', errors: { template: problems } });

    // create or update, not upsert: the audit log records these and skips upsert
    const templates = this.db(tenantSlug).emailTemplate;
    const where = { key_locale: { key, locale } };
    const update = () => templates.update({ where, data: { subject, html, version: { increment: 1 }, updatedBy: userId } });
    if (await templates.findUnique({ where })) return update();
    try {
      return await templates.create({ data: { key, locale, subject, html, createdBy: userId, updatedBy: userId } });
    } catch (error) {
      // Another first save of the same email and language got there first: save over it
      if ((error as { code?: string } | null)?.code === 'P2002') return update();
      throw error;
    }
  }

  reset(tenantSlug: string | null, key: string, locale: EmailLocale): Promise<{ count: number }> {
    return this.db(tenantSlug).emailTemplate.deleteMany({ where: { key, locale } });
  }

  private db(tenantSlug: string | null) {
    return tenantSlug ? this.prisma.getTenantClient(tenantSlug) : this.prisma;
  }
}
