/** In-memory stand-ins for the Meet tests: a tiny Prisma-like model and a fake Google client. */
type Row = Record<string, any>;

export function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([field, cond]) => {
    if (field === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    if (cond === null) return row[field] === null || row[field] === undefined;
    if (cond instanceof Date) return row[field]?.getTime() === cond.getTime();
    if (typeof cond === 'object') {
      if ('in' in cond) return cond.in.includes(row[field]);
      if ('not' in cond) return row[field] !== cond.not;
      if ('lt' in cond) return row[field] != null && row[field] < cond.lt;
      return matches(row, cond); // compound unique, e.g. source_key
    }
    return row[field] === cond;
  });
}

/** Like Prisma: copies out, ids, timestamps and column defaults on create, `include` through resolvers */
export function fakeModel(initial: Row[] = [], includes: Record<string, (row: Row) => Row | null> = {}, defaults: Row = {}) {
  const rows: Row[] = initial.map((row) => ({ ...row }));
  let seq = 0;
  const out = (row: Row | undefined, include?: Row) => {
    if (!row) return null;
    const copy: Row = { ...row };
    for (const name of Object.keys(include ?? {})) copy[name] = includes[name]?.(row) ?? null;
    return copy;
  };
  return {
    rows,
    findUnique: jest.fn(async ({ where, include }: Row) => out(rows.find((r) => matches(r, where)), include)),
    findFirst: jest.fn(async ({ where, include }: Row = {}) => out(rows.find((r) => matches(r, where)), include)),
    findMany: jest.fn(async ({ where, include }: Row = {}) => rows.filter((r) => matches(r, where)).map((r) => out(r, include))),
    create: jest.fn(async ({ data }: Row) => {
      const row = { id: `id-${++seq}-${Math.random().toString(36).slice(2, 6)}`, createdAt: new Date(), updatedAt: new Date(), ...defaults, ...data };
      rows.push(row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }: Row) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('not found');
      Object.assign(row, data, { updatedAt: new Date() });
      return { ...row };
    }),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data, { updatedAt: new Date() }));
      return { count: hit.length };
    }),
    upsert: jest.fn(async ({ where, create, update }: Row) => {
      const row = rows.find((r) => matches(r, where));
      if (row) return { ...Object.assign(row, update, { updatedAt: new Date() }) };
      const created = { id: `id-${++seq}`, createdAt: new Date(), updatedAt: new Date(), creatingSince: null, currentSpaceId: null, ...create };
      rows.push(created);
      return { ...created };
    }),
  };
}

export function fakeMeetDb(seed: { connections?: Row[]; items?: Row[]; spaces?: Row[] } = {}) {
  const meetingItem = fakeModel(seed.items);
  const meetingSpace = fakeModel(
    seed.spaces,
    { item: (row) => meetingItem.rows.find((item) => item.id === row.itemId) ?? null },
    { provider: 'google', status: 'ACTIVE', lockState: 'OPEN', lastError: null },
  );
  const calendarConnection = fakeModel(seed.connections);
  return { meetingItem, meetingSpace, calendarConnection };
}

export function fakeMeetGoogle() {
  let seq = 0;
  return {
    createSpace: jest.fn(async (_token: string, _access: string) => {
      seq += 1;
      return { name: `spaces/space${seq}`, meetingUri: `https://meet.google.com/aaa-bbbb-cc${seq}` };
    }),
    setSpaceAccess: jest.fn(async (_token: string, _space: string, _access: string) => undefined),
    endActiveConference: jest.fn(async (_token: string, _space: string) => undefined),
  };
}
