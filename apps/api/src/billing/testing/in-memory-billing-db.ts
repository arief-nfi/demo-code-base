/**
 * Test-only in-memory stand-in for the public-schema tables billing uses, with
 * just enough of Prisma's query API (where: equals / lt / lte / gt / gte / not / in,
 * unique violations as P2002, $transaction, a no-op $executeRaw) for the billing specs.
 */
type Row = Record<string, any>;
type Where = Record<string, any> | undefined;

function matchValue(actual: any, cond: any): boolean {
  if (cond === null) return actual === null || actual === undefined;
  if (cond instanceof Date) return actual instanceof Date && actual.getTime() === cond.getTime();
  if (typeof cond === 'object' && !Array.isArray(cond)) {
    if ('not' in cond && !('equals' in cond)) {
      return !matchValue(actual, cond.not);
    }
    if ('in' in cond) return cond.in.includes(actual);
    const a = actual instanceof Date ? actual.getTime() : actual;
    const v = (x: any) => (x instanceof Date ? x.getTime() : x);
    if ('lt' in cond && !(a != null && a < v(cond.lt))) return false;
    if ('lte' in cond && !(a != null && a <= v(cond.lte))) return false;
    if ('gt' in cond && !(a != null && a > v(cond.gt))) return false;
    if ('gte' in cond && !(a != null && a >= v(cond.gte))) return false;
    if ('equals' in cond) return actual === cond.equals;
    return true;
  }
  return actual === cond;
}

export function matches(row: Row, where: Where): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Where[]).some((w) => matches(row, w));
    if (key === 'AND') return (cond as Where[]).every((w) => matches(row, w));
    return matchValue(row[key], cond);
  });
}

function uniqueViolation(field: string): Error {
  const err = new Error(`Unique constraint failed on the fields: (\`${field}\`)`) as Error & { code: string; meta: unknown };
  err.code = 'P2002';
  err.meta = { target: [field] };
  return err;
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  if (!orderBy) return rows;
  const [[field, dir]] = Object.entries(Array.isArray(orderBy) ? orderBy[0] : orderBy) as [string, string][];
  const key = (r: Row) => (r[field] instanceof Date ? r[field].getTime() : r[field]);
  return [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (dir === 'desc' ? -1 : 1));
}

function table(name: string, opts: { unique?: string[]; defaults?: (data: Row) => Row; idField?: string } = {}) {
  const rows: Row[] = [];
  const idField = opts.idField ?? 'id';
  let seq = 0;
  const findByUnique = (where: Row) => rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null;

  return {
    rows,
    async create({ data }: { data: Row }) {
      // Like Prisma, an undefined field means "not set": the default applies
      const given = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
      const row: Row = { ...(opts.defaults?.(data) ?? {}), ...given };
      if (row[idField] === undefined) row[idField] = `${name}-${++seq}`;
      for (const field of [idField, ...(opts.unique ?? [])]) {
        if (row[field] !== undefined && rows.some((r) => r[field] === row[field])) throw uniqueViolation(field);
      }
      rows.push(row);
      return { ...row };
    },
    async findUnique({ where }: { where: Row }) {
      const row = findByUnique(where);
      return row ? { ...row } : null;
    },
    async findFirst({ where, orderBy }: { where?: Row; orderBy?: any } = {}) {
      const row = sortRows(rows.filter((r) => matches(r, where)), orderBy)[0];
      return row ? { ...row } : null;
    },
    async findMany({ where, orderBy, skip, take, distinct }: { where?: Row; orderBy?: any; skip?: number; take?: number; distinct?: string[]; select?: unknown } = {}) {
      let out = sortRows(rows.filter((r) => matches(r, where)), orderBy);
      if (distinct) {
        const seen = new Set<string>();
        out = out.filter((r) => {
          const k = distinct.map((d) => r[d]).join('|');
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      }
      return out.slice(skip ?? 0, take !== undefined ? (skip ?? 0) + take : undefined).map((r) => ({ ...r }));
    },
    async count({ where }: { where?: Row } = {}) {
      return rows.filter((r) => matches(r, where)).length;
    },
    async update({ where, data }: { where: Row; data: Row }) {
      const row = findByUnique(where);
      if (!row) throw new Error(`${name} not found`);
      Object.assign(row, data);
      return { ...row };
    },
    async delete({ where }: { where: Row }) {
      const row = findByUnique(where);
      if (!row) throw new Error(`${name} not found`);
      rows.splice(rows.indexOf(row), 1);
      return { ...row };
    },
    async deleteMany({ where }: { where?: Row } = {}) {
      const hits = rows.filter((r) => matches(r, where));
      hits.forEach((r) => rows.splice(rows.indexOf(r), 1));
      return { count: hits.length };
    },
    async updateMany({ where, data }: { where?: Row; data: Row }) {
      const hits = rows.filter((r) => matches(r, where));
      hits.forEach((r) => Object.assign(r, data));
      return { count: hits.length };
    },
    async upsert({ where, create, update }: { where: Row; create: Row; update: Row }) {
      const row = findByUnique(where);
      if (row) {
        for (const [k, v] of Object.entries(update)) {
          row[k] = v && typeof v === 'object' && 'increment' in v ? row[k] + (v as any).increment : v;
        }
        return { ...row };
      }
      return this.create({ data: create });
    },
    async groupBy({ by, where, _sum }: { by: string[]; where?: Row; _sum: Record<string, true> }) {
      const groups = new Map<string, Row>();
      for (const r of rows.filter((x) => matches(x, where))) {
        const key = by.map((b) => r[b]).join('|');
        const g = groups.get(key) ?? { ...Object.fromEntries(by.map((b) => [b, r[b]])), _sum: Object.fromEntries(Object.keys(_sum).map((f) => [f, 0])) };
        for (const f of Object.keys(_sum)) g._sum[f] = Number(g._sum[f]) + Number(r[f]);
        groups.set(key, g);
      }
      return [...groups.values()].map((g) => ({ ...g, _sum: Object.fromEntries(Object.entries(g._sum).map(([k, v]) => [k, { toString: () => String(v) }])) }));
    },
  };
}

function createTables() {
  return {
    invoice: table('invoice', {
      unique: ['number', 'dedupeKey'],
      defaults: () => ({ status: 'OPEN', taxAmount: '0', creditAmount: '0', includes: null, complimentary: false, activationError: null, paidAt: null, voidedAt: null, issuedAt: new Date() }),
    }),
    invoiceCounter: table('invoiceCounter', { idField: 'year', defaults: () => ({ last: 0 }) }),
    paymentCheckout: table('paymentCheckout', { unique: ['externalId'], defaults: () => ({ status: 'PENDING', completedAt: null, createdAt: new Date() }) }),
    billingSettings: table('billingSettings'),
    billingProfile: table('billingProfile', { idField: 'tenantId' }),
    plugin: table('plugin', { idField: 'key' }),
    tenant: table('tenant'),
    app: table('app', { unique: ['key'], defaults: () => ({ isPublished: false, icon: 'package', trialDays: 0, pricingLabel: null, description: null }) }),
    appPlugin: table('appPlugin'),
    billingCredit: table('billingCredit', { defaults: () => ({ sourceKey: null, invoiceId: null, createdAt: new Date() }) }),
    /** Raw SQL (the credit advisory lock) is a no-op in memory. */
    $executeRaw: async (..._args: unknown[]) => 0,
  };
}

type Tables = ReturnType<typeof createTables>;

export type BillingDb = Tables & { $transaction<T>(fn: (tx: Tables) => Promise<T>): Promise<T> };

export function createBillingDb(): BillingDb {
  const tables = createTables();
  return { ...tables, $transaction: (fn) => fn(tables) };
}
