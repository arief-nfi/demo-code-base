import { BadRequestException } from '@nestjs/common';
import { EMAIL_LOCALES, sanitizeEmailHtml, type EmailContent, type EmailLocale, type IEmailService } from '@saas/backend';
import type { DraftEmailTemplateDto } from './dto/save-email-template.dto';
import type { EmailTemplateEdit } from './email-templates.service';

export type LocaleState = { state: 'default' | 'customized' | 'needs_attention'; problems: string[]; updatedAt?: string };

/** Each language's state; an edit is re-checked against the current definition (a release may have changed it since the save) */
export function localeStates(email: IEmailService, key: string, edits: EmailTemplateEdit[]): Record<EmailLocale, LocaleState> {
  return Object.fromEntries(
    EMAIL_LOCALES.map((locale): [EmailLocale, LocaleState] => {
      const edit = edits.find((e) => e.key === key && e.locale === locale);
      if (!edit) return [locale, { state: 'default', problems: [] }];
      const problems = email.checkEdit(key, edit);
      return [locale, { state: problems.length ? 'needs_attention' : 'customized', problems, updatedAt: edit.updatedAt.toISOString() }];
    }),
  ) as Record<EmailLocale, LocaleState>;
}

/** The stored edit of each language (null when it uses the default), with its current problems */
export function editsByLocale(email: IEmailService, key: string, edits: EmailTemplateEdit[]) {
  return Object.fromEntries(
    EMAIL_LOCALES.map((locale) => {
      const edit = edits.find((e) => e.key === key && e.locale === locale);
      return [locale, edit
        ? { subject: edit.subject, html: edit.html, version: edit.version, updatedAt: edit.updatedAt, updatedBy: edit.updatedBy, problems: email.checkEdit(key, edit) }
        : null];
    }),
  );
}

export function parseLocale(value: string): EmailLocale {
  if (!(EMAIL_LOCALES as readonly string[]).includes(value)) throw new BadRequestException(`Unknown language "${value}"`);
  return value as EmailLocale;
}

/** A draft is previewed and tested exactly as it would be saved */
export function cleanDraft(draft: DraftEmailTemplateDto): EmailContent | undefined {
  if (draft?.subject === undefined || draft.html === undefined) return undefined;
  return { subject: draft.subject, html: sanitizeEmailHtml(draft.html) };
}
