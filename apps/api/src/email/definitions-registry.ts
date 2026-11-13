import { createEmailRenderer, EMAIL_LOCALES, type EmailDefinition } from '@saas/backend';

export interface RegisteredEmail {
  def: EmailDefinition;
  /** `core` or the plugin key */
  source: string;
}

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Every email core and the plugins declare. Construction validates them all and
 * throws one error listing every problem, so a bad definition stops the API at boot.
 */
export class EmailDefinitionsRegistry {
  private readonly byKey = new Map<string, RegisteredEmail>();

  constructor(core: EmailDefinition[], plugins: Record<string, EmailDefinition[]>) {
    const renderer = createEmailRenderer();
    const problems: string[] = [];
    const entries: RegisteredEmail[] = [
      ...core.map((def) => ({ def, source: 'core' })),
      ...Object.entries(plugins).flatMap(([source, defs]) => defs.map((def) => ({ def, source }))),
    ];

    for (const entry of entries) {
      const found = validate(entry, renderer);
      if (this.byKey.has(entry.def.key)) found.push('is declared more than once');
      problems.push(...found.map((p) => `${entry.def.key} (${entry.source}): ${p}`));
      if (!this.byKey.has(entry.def.key)) this.byKey.set(entry.def.key, entry);
    }

    if (problems.length > 0) {
      throw new Error(`Invalid email definitions:\n- ${problems.join('\n- ')}`);
    }
  }

  get(key: string): RegisteredEmail | undefined {
    return this.byKey.get(key);
  }

  list(): RegisteredEmail[] {
    return [...this.byKey.values()];
  }
}

function validate({ def, source }: RegisteredEmail, renderer: ReturnType<typeof createEmailRenderer>): string[] {
  const problems: string[] = [];
  const namespace = source === 'core' ? 'core' : source;
  const [prefix, ...rest] = def.key.split('.');
  if (prefix !== namespace || rest.length !== 1 || !NAME.test(rest[0])) {
    problems.push(`key must look like "${namespace}.<kebab-name>"`);
  }
  if (def.scope === 'platform' && source !== 'core') {
    problems.push('only core may declare platform emails');
  }
  if (def.showInTenantLog && def.scope !== 'platform') {
    problems.push('showInTenantLog is only for platform emails (tenant emails are in the tenant log already)');
  }

  const variables = Object.keys(def.variables.shape);
  for (const name of [...(def.required ?? []), ...(def.sensitive ?? [])]) {
    if (!variables.includes(name)) problems.push(`"${name}" is listed as required/sensitive but is not a variable`);
  }
  if (!def.variables.safeParse(def.sample).success) {
    problems.push('sample does not match its variables');
  }

  for (const locale of EMAIL_LOCALES) {
    const content = def.defaults?.[locale];
    if (!content || typeof content.subject !== 'string' || typeof content.html !== 'string') {
      problems.push(`missing the "${locale}" default`);
      continue;
    }
    problems.push(...renderer.check(def, content, { tenantAuthored: false }).map((p) => `"${locale}" default: ${p}`));
  }
  return problems;
}
