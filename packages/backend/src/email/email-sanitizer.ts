import type { IOptions } from 'sanitize-html';

const COMMON_ATTRIBUTES = ['style', 'title', 'align', 'valign', 'width', 'height', 'bgcolor'];
const CELL_ATTRIBUTES = [...COMMON_ATTRIBUTES, 'colspan', 'rowspan'];

// An allowlist, never a denylist: anything not named here is removed.
const OPTIONS: IOptions = {
  allowedTags: [
    'a', 'b', 'i', 'u', 'em', 'strong', 'p', 'br', 'hr', 'div', 'span', 'h1', 'h2', 'h3', 'h4',
    'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img', 'blockquote', 'small',
  ],
  allowedAttributes: {
    '*': COMMON_ATTRIBUTES,
    a: [...COMMON_ATTRIBUTES, 'href', 'target'],
    img: [...COMMON_ATTRIBUTES, 'src', 'alt', 'border'],
    table: [...COMMON_ATTRIBUTES, 'border', 'cellpadding', 'cellspacing'],
    td: CELL_ATTRIBUTES,
    th: CELL_ATTRIBUTES,
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
};

/** Cleans tenant-authored email HTML (Handlebars expressions pass through untouched). */
export function sanitizeEmailHtml(html: string): string {
  // Loaded on first use: sanitize-html is ESM-only, and requiring it lazily keeps
  // test runners that merely import @saas/backend from having to load it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sanitize = require('sanitize-html') as typeof import('sanitize-html');
  return sanitize(html, OPTIONS);
}
