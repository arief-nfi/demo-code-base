import { z } from 'zod';
import { defineEmail } from '@saas/backend';

/**
 * Emails this plugin sends. Tenants can reword them in Templates → Emails.
 * Send one with `@Inject(EMAIL_SERVICE) email: IEmailService`:
 *   email.send({ template: 'sample-plugin.article-published', tenantSlug, to, data })
 */
export const samplePluginEmails = [
  defineEmail({
    key: 'sample-plugin.article-published',
    scope: 'tenant',
    name: 'Article published',
    description: 'Sent to the author when their article goes live',
    variables: z.object({
      authorName: z.string().describe("The author's name"),
      articleTitle: z.string().describe('The article title'),
      articleUrl: z.string().url().describe('Link to the article'),
    }),
    sample: { authorName: 'Budi', articleTitle: 'Hello world', articleUrl: 'https://app.example.com/articles/1' },
    required: ['articleUrl'],
    defaults: {
      en: {
        subject: 'Your article "{{articleTitle}}" is live',
        html: '<p>Hi {{authorName}},</p><p>Your article <strong>{{articleTitle}}</strong> has been published.</p>{{button articleUrl "Read the article"}}',
      },
      id: {
        subject: 'Artikel Anda "{{articleTitle}}" sudah terbit',
        html: '<p>Halo {{authorName}},</p><p>Artikel Anda <strong>{{articleTitle}}</strong> sudah diterbitkan.</p>{{button articleUrl "Baca artikel"}}',
      },
    },
  }),
];
