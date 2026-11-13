import { randomBytes } from 'crypto';
import Handlebars from 'handlebars';
import { convert } from 'html-to-text';
import type { EmailContent, EmailDefinition, RenderedEmail } from './email.types';
import { registerFormattingHelpers } from './handlebars-helpers';
import { renderEmailButton, renderEmailLayout, type EmailLayoutInput } from './email-layout';
import { analyzeSensitivePlacement, misplacedMessage } from './sensitive-placement';

/** Helpers tenant-authored templates may call; everything else is refused. */
export const TENANT_EMAIL_HELPERS = [
  'formatCurrency', 'formatNumber', 'formatDate', 'eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'add', 'subtract',
  'multiply', 'divide', 'uppercase', 'lowercase', 'capitalize', 'ifCond', 'inc', 'padStart', 'json', 'button',
  'if', 'unless', 'each', 'with',
] as const;

type Ast = hbs.AST.Program;
type Layout = Omit<EmailLayoutInput, 'bodyHtml'>;

export interface EmailRenderOptions {
  tenantAuthored?: boolean;
  /** Variables holding a one-time link: the template only ever sees a placeholder for them */
  sensitive?: string[];
  /** Sensitive variables that must appear as at least one link */
  requiredLinks?: string[];
}

/** A rendered email whose sensitive values are not filled in yet. */
export interface ComposedEmail {
  /** Why the sensitive values can't be filled in; empty when the email is safe to send */
  problems: string[];
  /** The email with each sensitive variable written into its link(s) — the real value, or e.g. "[hidden]" for the log */
  fill(values: Record<string, string>): RenderedEmail;
}

const PART_LABEL = { subject: 'subject', html: 'body' } as const;
const CHECK_LAYOUT: Layout = { brandName: 'Preview', footerText: '' };

export interface EmailRenderer {
  /** Problems with `content` for `def`, from rendering it with the sample data; empty when it can be sent. */
  check(def: EmailDefinition, content: EmailContent, opts: { tenantAuthored: boolean }): string[];
  compose(content: EmailContent, data: Record<string, unknown>, layout: Layout, opts?: EmailRenderOptions): ComposedEmail;
  /** compose + fill with the values in `data`; throws when a sensitive value is misplaced */
  render(content: EmailContent, data: Record<string, unknown>, layout: Layout, opts?: EmailRenderOptions): RenderedEmail;
}

export function createEmailRenderer(): EmailRenderer {
  // An isolated instance: tenant templates never see helpers registered elsewhere.
  const hbs = Handlebars.create();
  registerFormattingHelpers(hbs);
  hbs.registerHelper('button', (url: unknown, label: unknown, options: Handlebars.HelperOptions) =>
    new hbs.SafeString(renderEmailButton(String(url ?? ''), String(label ?? ''), options?.data?.brandColor)),
  );
  hbs.unregisterHelper('log');
  hbs.unregisterHelper('lookup');

  // Handlebars treats `log` and `lookup` as known helpers unless told otherwise.
  const knownHelpers = { ...Object.fromEntries(TENANT_EMAIL_HELPERS.map((name) => [name, true])), log: false, lookup: false };
  const compileOptions = (part: 'subject' | 'html', tenantAuthored: boolean): CompileOptions => ({
    noEscape: part === 'subject', // the subject is a plain-text header, not HTML
    ...(tenantAuthored ? { knownHelpers, knownHelpersOnly: true } : {}),
  });

  const run = (source: string, part: 'subject' | 'html', data: Record<string, unknown>, tenantAuthored: boolean, brandColor?: string | null) =>
    hbs.compile(source, compileOptions(part, tenantAuthored))(data, { data: { brandColor } });

  function compose(content: EmailContent, data: Record<string, unknown>, layout: Layout, opts: EmailRenderOptions = {}): ComposedEmail {
    const tenantAuthored = opts.tenantAuthored ?? false;
    // Digits only, unique per render: case helpers can't change them, and nothing the
    // template does with a placeholder says anything about the real link.
    const placeholders: Record<string, string> = Object.fromEntries(
      (opts.sensitive ?? []).map((name) => [name, Array.from(randomBytes(20), (b) => b % 10).join('')]),
    );
    const renderData = { ...data, ...placeholders };

    const subject = run(content.subject, 'subject', renderData, tenantAuthored).replace(/\s+/g, ' ').trim();
    const body = run(content.html, 'html', renderData, tenantAuthored, layout.primaryColor);
    const html = renderEmailLayout({ ...layout, bodyHtml: body });

    const { problems, hrefCounts } = analyzeSensitivePlacement(html, subject, placeholders);
    const found = new Set(problems);
    for (const [name, placeholder] of Object.entries(placeholders)) {
      // Every occurrence in the raw HTML must be one of the links the parser validated:
      // anything else (an attribute name, a processing instruction…) is refused too.
      if (html.split(placeholder).length - 1 !== hrefCounts[name]) found.add(misplacedMessage(name));
    }
    for (const name of opts.requiredLinks ?? []) {
      if (!hrefCounts[name]) found.add(`"${name}" must stay in the email as a link`);
    }

    return {
      problems: [...found],
      fill(values) {
        let filled = html;
        for (const [name, placeholder] of Object.entries(placeholders)) {
          filled = filled.split(placeholder).join(hbs.Utils.escapeExpression(values[name] ?? ''));
        }
        const text = convert(filled, { wordwrap: 100, selectors: [{ selector: 'img', format: 'skip' }] });
        return { subject, html: filled, text };
      },
    };
  }

  function render(content: EmailContent, data: Record<string, unknown>, layout: Layout, opts: EmailRenderOptions = {}): RenderedEmail {
    const composed = compose(content, data, layout, opts);
    if (composed.problems.length > 0) {
      throw new Error(`The email places a sensitive value unsafely: ${composed.problems.join('; ')}`);
    }
    return composed.fill(Object.fromEntries((opts.sensitive ?? []).map((name) => [name, String(data[name] ?? '')])));
  }

  function check(def: EmailDefinition, content: EmailContent, opts: { tenantAuthored: boolean }): string[] {
    const problems: string[] = [];
    const used = new Set<string>();

    for (const part of ['subject', 'html'] as const) {
      const label = PART_LABEL[part];
      let ast: Ast;
      try {
        ast = hbs.parse(content[part]);
      } catch (error) {
        problems.push(`The ${label} has a template error: ${firstLine(error)}`);
        continue;
      }
      if (opts.tenantAuthored) problems.push(...forbiddenConstructs(ast, label));
      collectPaths(ast, used);
      try {
        hbs.precompile(content[part], compileOptions(part, opts.tenantAuthored));
      } catch (error) {
        problems.push(`The ${label} uses something that isn't allowed: ${firstLine(error)}`);
      }
    }

    for (const name of def.required ?? []) {
      if (!used.has(name)) problems.push(`"${name}" must stay in the email`);
    }
    if (problems.length > 0) return problems;

    // Always render with the sample data: it must not throw, and sensitive links must be placed safely
    const sensitive = def.sensitive ?? [];
    try {
      return compose(content, def.sample as Record<string, unknown>, CHECK_LAYOUT, {
        tenantAuthored: opts.tenantAuthored,
        sensitive,
        requiredLinks: (def.required ?? []).filter((name) => sensitive.includes(name)),
      }).problems;
    } catch (error) {
      return [`The email could not be rendered: ${firstLine(error)}`];
    }
  }

  return { check, compose, render };
}

const ALLOWED_HELPERS = new Set<string>(TENANT_EMAIL_HELPERS);

/** `{{{ }}}`, `{{& }}`, partials, decorators and unlisted helpers are never allowed in tenant templates. */
function forbiddenConstructs(ast: Ast, label: string): string[] {
  const found = new Set<string>();
  walk(ast, (node) => {
    if (node.type === 'MustacheStatement' || node.type === 'BlockStatement' || node.type === 'SubExpression') {
      const call = node as hbs.AST.MustacheStatement | hbs.AST.BlockStatement | hbs.AST.SubExpression;
      const isCall = node.type !== 'MustacheStatement' || call.params.length > 0 || !!call.hash;
      const name = call.path.type === 'PathExpression' ? (call.path as hbs.AST.PathExpression).original : null;
      if (isCall && name !== null && !ALLOWED_HELPERS.has(name)) {
        found.add(`The ${label} uses "${name}", which isn't an allowed helper`);
      }
    }
    if (node.type === 'MustacheStatement' && (node as hbs.AST.MustacheStatement).escaped === false) {
      found.add(`The ${label} uses unescaped output ({{{ }}} or {{& }}), which isn't allowed`);
    }
    if (node.type === 'PartialStatement' || node.type === 'PartialBlockStatement') {
      found.add(`The ${label} uses a partial ({{> }}), which isn't allowed`);
    }
    if (node.type === 'Decorator' || node.type === 'DecoratorBlock') {
      found.add(`The ${label} uses a decorator, which isn't allowed`);
    }
  });
  return [...found];
}

function collectPaths(ast: Ast, into: Set<string>): void {
  walk(ast, (node) => {
    if (node.type === 'PathExpression') {
      into.add((node as hbs.AST.PathExpression).original.replace(/^(this\.|\.\/)/, ''));
    }
  });
}

function walk(node: unknown, visit: (node: hbs.AST.Node) => void): void {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
  if (!node || typeof node !== 'object') return;
  const typed = node as hbs.AST.Node;
  if (typeof typed.type === 'string') visit(typed);
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'loc' && value && typeof value === 'object') walk(value, visit);
  }
}

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0];
}
