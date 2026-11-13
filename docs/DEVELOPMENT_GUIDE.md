# Development Guide (for Vibe Coding Agents)

This guide is the primary reference for any agent writing or modifying code in this repository. Read it end-to-end on first contact, keep it nearby for lookups, and treat the **Non-negotiable rules** as hard constraints — violating them breaks multi-tenancy, RBAC, or the plugin system.

The guide complements the task templates in [.forge/task_templates/](../.forge/task_templates/) — the templates describe **what** a single task produces; this guide describes **how** this codebase works.

---

## 1. Read this first — Non-negotiable rules

If you skip everything else, read this block.

1. **Multi-tenancy is schema-per-tenant**. Every per-tenant Prisma model lives inside a `tenant_{slug}` PostgreSQL schema. **Never** add a `tenantId` column to a tenant-scoped model — the schema *is* the scope. The public schema holds platform-wide rows:
   - `Tenant` and `Plugin`, the app catalog (`App`, `AppPlugin`) and workflow templates;
   - billing (`Invoice`, `InvoiceCounter`, `PaymentCheckout`, `BillingSettings`, `BillingProfile`, `BillingCredit`);
   - platform emails (`EmailMessage` rows for `platform` emails, and the sysadmins' edits in `EmailTemplate`), and `CalendarAccountIndex`.

   The billing rows are keyed by `tenantId`: sysadmins list across tenants, invoice numbers are global, and payment callbacks arrive with no tenant context. Note that every tenant schema receives the full merged schema too: `Tenant` is mirrored into it and `Plugin` (per-tenant enablement/config) and `TenantSubscription` are read through the tenant client. So whether a model is public or per-tenant depends on which client reads it, not on where it is declared.
2. **Every authenticated API request carries `x-tenant-id`**. `TenancyMiddleware` resolves it to a tenant context on `req.tenant`. The web `apiClient` injects it automatically from `useAuthStore`.
3. **Data access goes through `PrismaService.getTenantClient(tenantSlug)`**. Never call `this.prisma.{model}` directly in plugin services — that binds to the public schema and will silently return empty results or write to the wrong schema. The only exception is a deliberately public row, such as the sysadmins' platform email edits in document-templates (`EmailTemplatesService` uses `this.prisma` when the tenant slug is `null`).
4. **Guard order on controllers is fixed**: `@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)` — in that order. `JwtAuthGuard` populates `req.user`; `PluginEnabledGuard` returns 403 when the plugin is disabled (system-wide or for the tenant, or its subscription is blocked) and 404 only when the plugin key is unknown; `RbacGuard` reads the user + permissions to authorize. Reordering breaks auth.
5. **Validation uses Zod, applied per-parameter**: `@Body(new ZodValidationPipe(schema))`. Never apply `@UsePipes(...)` at the method level — it catches `@Param()` too and will reject path params.
6. **Never write `AuditLog` rows by hand**. The Prisma middleware logs every `create`/`update`/`delete` (and their `*Many` forms) and maintains a hash chain. Manual writes double-log and corrupt the chain. **`upsert` is not audited**: where a write must be in the audit log, use `findUnique` and then `update` or `create`.
7. **Plugin registries are generated, not hand-edited**. After any plugin change, run `pnpm plugins:register` (code/menus/permissions) or `pnpm plugins:merge-prisma` (schema fragment).
8. **The `.env` database port is 5435 (Postgres) and 6380 (Redis)** — not the defaults. Don't assume 5432 / 6379.
9. **Permissions follow `{plugin-slug}.{resource}.{action}`** — always. Declare them in `plugins/{slug}/src/permissions.ts`; enforce them with `@Permissions(...)` on controllers and `<Protect>` / `useRBAC()` on UI.
10. **Every user-visible string must be translated in both `en` and `id`** in the plugin's `dictionaries.ts` (core app strings: [apps/web/lib/dictionaries.ts](../apps/web/lib/dictionaries.ts)). No hardcoded English — not even temporarily.

---

## 2. What this codebase is

A monorepo SaaS multitenant platform:

- **pnpm 9 workspaces + TurboRepo** for builds and caching
- **NestJS 10** backend ([apps/api](../apps/api))
- **Next.js 16 App Router + React 19 + Tailwind CSS 4** frontend ([apps/web](../apps/web))
- **PostgreSQL 15** with schema-per-tenant isolation, **Redis** for caching + queues
- **Prisma ORM** with a schema merged from plugin fragments
- **Plugin system** — the primary extension mechanism. Every domain feature ships as a plugin under [plugins/](../plugins)

### Terminology

| Term | Meaning |
|------|---------|
| **Tenant** | A customer organization. Identified by `slug` (e.g. `acme`). Gets its own PostgreSQL schema `tenant_acme`. |
| **Plugin** | A full-stack feature package under [plugins/](../plugins). Exports NestJS modules, React pages, permissions, menus, i18n, and an optional Prisma fragment. |
| **Module** | Synonymous with **plugin** in this codebase (a NestJS module *inside* a plugin is a normal NestJS concept). |
| **Fragment** | A plugin's Prisma schema file at `plugins/{slug}/src/database/prisma/fragment.prisma`, merged into the central schema. |
| **Public schema** | Postgres `public` schema. Holds rows shared across every tenant. |
| **Tenant schema** | `tenant_{slug}`. Holds that tenant's data in isolation from every other tenant. |
| **Registry** | Auto-generated index of plugins (API side: [apps/api/src/plugin-registry.ts](../apps/api/src/plugin-registry.ts); web side: [apps/web/lib/plugin-menus.ts](../apps/web/lib/plugin-menus.ts), [plugin-dictionaries.ts](../apps/web/lib/plugin-dictionaries.ts), [plugin-routes.ts](../apps/web/lib/plugin-routes.ts)). |

---

## 3. Repository layout

```
saas-multitenant/
├── apps/
│   ├── api/                    NestJS backend (port 3001). Entry: src/main.ts. Core features in src/:
│   │                           auth, tenants, systems (users, roles), plugins, billing, apps, email,
│   │                           calendar, meetings, notifications, jobs, uploads, imports, seed.ts
│   └── web/                    Next.js frontend (port 3000). Entry: app/layout.tsx
├── packages/
│   ├── backend/  (@saas/backend)   Shared NestJS code: Prisma, auth, middleware, audit, cache, queue, storage, websocket,
│   │                               events, plugin access, the email / calendar / meetings contracts, workflow,
│   │                               ZodValidationPipe, GlobalExceptionFilter, BaseCrudService, ExportService
│   ├── database/ (@saas/database)  Prisma schema header + merged schema.prisma + generated client
│   └── ui/       (@saas/ui)        Shared React components, hooks, stores, api-client
├── plugins/
│   ├── sample-plugin/         Reference implementation — copy its shape (SampleItem, SampleArticle)
│   ├── audit-log/             Core plugin; zero schema footprint
│   ├── document-templates/    DocumentTemplate, DocumentRender, EmailTemplate (tenant email edits; Templates → Emails)
│   └── integration/           Partners, webhooks, API keys (IntegrationPartner, IntegrationWebhook, …) and the Google
│                              provider: CalendarConnection, CalendarEventLink, CalendarAccountIndex, MeetingItem, MeetingSpace
├── scripts/                    plugin generator, registry, schema merge, tenant migrate, dev watcher (dev-watch, wait-for-dev-build), plugin-dev
├── .forge/task_templates/      Task templates (see § 4)
└── docs/                       This guide, browser test guides (*_TESTING.md), design specs and plans (superpowers/)
```

---

## 4. Task workflow — how to use the templates

The templates in [.forge/task_templates/](../.forge/task_templates/) describe standard task shapes. Typical task order for a new feature:

1. **NEW-MODULE.md** (once per new plugin) — scaffold the plugin
2. **MODEL.md** — Prisma fragment, migrations
3. **REPOSITORY.md** — data access (via `BaseCrudService` or direct `PrismaService`)
4. **SERVICE.md** — NestJS service with business rules
5. **API.md** — NestJS controller with guards + Zod DTOs
6. **MENUS.md** — plugin menus + routes
7. **UI.md** — Next.js page

For modifications to an existing plugin/module, start with **CHANGE-REQUEST.md** to produce the impact plan before touching code. **BUILD.md** is the build-verification task for a module.

Don't skip templates when the task legitimately requires them, and don't run them sequentially when two tasks have no dependency — e.g. API and UI can proceed in parallel once the service exists.

---

## 5. Command reference (run these — don't reinvent them)

### Runtime

```bash
pnpm bootstrap                # Fresh clone (needs .env + Postgres): install → db:migrate:deploy → build → db:seed → db:migrate:tenants
pnpm dev                      # Start API (3001) + Web (3000) + one watcher for backend & all plugins
pnpm dev:watch                # Only the watcher (tsc -b --watch over tsconfig.dev.json)
pnpm build                    # Build everything via Turbo (@saas/database runs prisma generate first, so a fresh clone builds)
pnpm test                     # Run all tests: Jest (API, backend, plugins), Vitest (@saas/ui), node --test (scripts/)
pnpm test:api / test:ui / test:scripts   # One of those
pnpm lint                     # ESLint in apps/api, apps/web, @saas/ui (errors fail it; warnings don't)
pnpm format                   # Prettier all .ts/.tsx/.md
docker-compose up -d          # Start PostgreSQL (5435) + Redis (6380)
```

### Database

```bash
pnpm db:generate                              # Regenerate the Prisma client (after any schema change)
pnpm db:migrate:dev --name {migration-name}   # Create + apply migration (public schema)
pnpm db:migrate:deploy                        # Apply pending migrations (production)
pnpm db:migrate:tenants                       # Apply pending migrations to every tenant_{slug} schema
pnpm db:migrate:status                        # Show what's pending
pnpm db:studio                                # Prisma Studio GUI
pnpm db:seed                                  # Seed initial platform data (requires build first)
```

### Plugins

```bash
pnpm plugin:new                          # Interactive plugin generator
pnpm plugins:register                    # Regenerate API + Web registries + Tailwind @source directives
pnpm plugins:merge-prisma                # Merge plugin fragments into packages/database/prisma/schema.prisma
pnpm plugins:merge-prisma:check          # Validates fragments only (does NOT diff against schema.prisma)
pnpm plugins:watch                       # Re-run plugins:register whenever a plugin's structural files change
pnpm plugin:dev {plugin-name}            # The same for one plugin, plus pnpm dev
```

### When to run what

| You changed… | Run this |
|--------------|----------|
| Plugin code (modules, services, controllers, pages, menus, permissions, dictionaries, lifecycle) | `pnpm plugins:register` |
| A Prisma fragment (`fragment.prisma`) | `pnpm plugins:merge-prisma` → `pnpm db:generate` → `pnpm db:migrate:dev --name X` → `pnpm db:migrate:tenants`. **New model?** Also add its camelCase delegate to `TenantModelKeys` in [packages/backend/src/prisma/tenant-prisma-client.ts](../packages/backend/src/prisma/tenant-prisma-client.ts) — no script does this, and without it `getTenantClient(slug).yourModel` is a type error |
| `packages/database/prisma/header.prisma` | `pnpm db:generate` → `pnpm db:migrate:dev --name X` (public schema only — tenant migrate usually not required for header-only changes) |
| Added a new plugin | `pnpm plugins:register` (it also rewrites `transpilePackages` in [apps/web/next.config.js](../apps/web/next.config.js), the Tailwind `@source` lines and the app dependencies — check the diff) |

---

## 6. Backend conventions (NestJS)

### Controller shape

```ts
@ApiTags('{PluginName} - {Resource}')
@ApiBearerAuth()
@Controller('plugins/{plugin-slug}/{resource}')
@PluginKey('{plugin-slug}')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@Roles('ADMIN')
export class XController {
  constructor(private readonly service: XService) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) throw new Error('Tenant context is required');
    return req.tenant.slug;
  }

  @Get()
  @Permissions('plugin-slug.resource.read')
  @ApiOperation({ summary: 'List X' })
  findAll(@Req() req: AuthenticatedRequest, @Query() query: XQueryDto) {
    return this.service.findAll(this.getTenantSlug(req), query);
  }

  @Post()
  @Permissions('plugin-slug.resource.write')
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createXSchema)) dto: CreateXDto,
  ) {
    return this.service.create(dto, this.getTenantSlug(req));
  }
}
```

Controllers stay thin — no business logic, no manual auth checks, no audit writes.

### Service shape

```ts
@Injectable()
export class XService {
  constructor(private readonly prisma: PrismaService) {}

  private getClient(tenantSlug: string) {
    return this.prisma.getTenantClient(tenantSlug);
  }

  async create(dto: CreateXDto, tenantSlug: string): Promise<X> {
    const client = this.getClient(tenantSlug);
    const existing = await client.x.findFirst({ where: { name: dto.name } });
    if (existing) throw new ConflictException(`X with name '${dto.name}' exists`);
    return client.x.create({ data: dto });
  }
}
```

### When to use `BaseCrudService`

Extend `BaseCrudService<TEntity, TQuery>` for standard CRUD resources. You declare `config` (searchFields, defaultSortBy, includes) and `getDelegate(tenantSlug)` — you get `findAll` (paginated + searchable), `findOne`, `remove`, `removeMany`, `checkAvailability`, `exportCsv`, `exportData` for free. Implement `create`/`update` yourself — they need entity-specific logic.

See [packages/backend/src/crud/base-crud.service.ts](../packages/backend/src/crud/base-crud.service.ts).

### Error handling

Throw NestJS exceptions and let [GlobalExceptionFilter](../packages/backend/src/filters/global-exception.filter.ts) translate them. Prisma errors (`P2002`, `P2025`, `P2003`, …) are auto-mapped — don't catch them unless you need to rephrase.

| Situation | Exception |
|-----------|-----------|
| Record not found | `NotFoundException` → 404 |
| Duplicate unique key | `ConflictException` → 409 |
| Business rule violated | `BadRequestException` → 400 |
| Ownership / permission conditional on state | `ForbiddenException` → 403 |

### Transactions

```ts
const client = this.prisma.getTenantClient(tenantSlug);
await client.$transaction(async (tx) => {
  const parent = await tx.parent.create({ data: ... });
  await tx.child.createMany({ data: ... });
  return parent;
});
```

Rules:
- Never span two tenants in one transaction
- Keep transactions short — no external HTTP, no queue enqueues inside
- Enqueue jobs **after** the transaction returns

### Module registration

Every feature module must:
1. Import `PrismaModule` (and anything else you inject)
2. Declare `controllers`, `providers`, and optional `exports`
3. Be re-exported from `plugins/{slug}/src/api/index.ts`

Example: [plugins/sample-plugin/src/api/sample-items/sample-items.module.ts](../plugins/sample-plugin/src/api/sample-items/sample-items.module.ts).

---

## 7. Frontend conventions (Next.js + @saas/ui)

### Rendering mode

- **Server Components** by default — no `'use client'`, no browser APIs
- **Client Components** when the screen has state, effects, stores, or API calls — `'use client';` as the first line
- Plugin pages are **almost always client components** because they subscribe to `useAuthStore` / `useRBAC` and fetch on mount

### Page shape

```tsx
'use client';

import {
  PageContainer, PageHeader, Button, Protect,
  useRBAC, useLanguage, usePaginatedApi,
} from '@saas/ui';

export const ItemsPage = () => {
  const { t } = useLanguage();
  const { authorize, isLoading } = useRBAC();
  const { data, loading, error, refetch } = usePaginatedApi<Item>(
    '/plugins/{plugin-slug}/items',
    { page, limit, search },
  );

  if (!isLoading && !authorize({ permissions: ['plugin-slug.item.read'] })) {
    return <Forbidden />;
  }

  return (
    <PageContainer>
      <PageHeader title={t('plugin.items.title')} description={t('plugin.items.description')}>
        {/* children are the header's action buttons; breadcrumbs come from the URL */}
        <Protect permissions={['plugin-slug.item.write']}>
          <Button>{t('plugin.items.create')}</Button>
        </Protect>
      </PageHeader>
      {/* list */}
    </PageContainer>
  );
};
```

### Data fetching

Use **typed hooks** from `@saas/ui`:

- `usePaginatedApi<T>(path, { page, limit, search, sortBy, sortOrder, skip })` — list endpoints returning `{ data, meta }`
- `useApi<T>(path, params?, { skip })` — detail / custom queries (`skip` is in the **third** argument; the second is the query string)
- `apiClient.get(path, params?)` (query object passed directly, not `{ params }`) and `apiClient.{post,put,patch,delete}(path, body)` — direct calls for mutations
- Both hooks return `error` as a `string | null`; a failed call throws `ApiRequestError` (`statusCode`, `message`, `errors` per field) or `ApiNetworkError` (no response)

The hooks automatically inject `x-tenant-id`, send JWT cookies, deduplicate 401 refreshes, and redirect to `/login` on failure. **Do not** build a second HTTP client.

### Forms

Always **react-hook-form + zodResolver**. The form's schema mirrors the backend DTO's: same fields, same limits. It may add checks only the browser can do, such as the async name check in the sample's item dialog ([SampleItemDialog.tsx](../plugins/sample-plugin/src/web/pages/sample-items/SampleItemDialog.tsx)). Plugin pages keep that copy next to the form rather than importing the DTO, so **change the form schema whenever you change the DTO**. The API validates again either way.

```tsx
const form = useForm<CreateXDto>({
  resolver: zodResolver(createXSchema),
  defaultValues: { /* ... */ },
});
```

On submit:
- `toast.success(t('...'))` from `sonner` on success. Plugins declare `sonner` `^2.0.7`, like the app; [apps/web/next.config.js](../apps/web/next.config.js) aliases every `sonner` import to the app's copy, without which plugin toasts never reach the app's `<Toaster>`
- Map server `response.errors` back to `form.setError(field, ...)` for inline field errors
- 409 → field-level error, not blocking toast

### RBAC in UI

- `<Protect permissions={[...]}>` to hide elements
- `useRBAC().authorize({ permissions, roles, logic })` at the top of a page to gate the whole view → render `<Forbidden />` if false
- Backend enforces permissions authoritatively — the UI check is for UX only

### Auth gating (no flash of protected UI)

- [apps/web/proxy.ts](../apps/web/proxy.ts) redirects any page request without a session to `/login?returnUrl=…` before it renders. Pages reachable without login are listed in `PUBLIC_PATHS` in [packages/ui/src/lib/auth-routing.ts](../packages/ui/src/lib/auth-routing.ts) — **add new public pages there**, or visitors get sent to `/login`.
- "Has a session" means the API's `token`/`refresh_token` cookie or the web app's own `has_session` hint cookie. The hint is set by `useAuthStore.setSession` (login) and cleared by `clearSession` (logout, 401), so the proxy also works when web and API run on different hosts without `COOKIE_DOMAIN`. Sign users out with `signOut()` from `@saas/ui`, never by hand.
- Everything under `app/(dashboard)/` (including plugin pages) renders inside `SessionGate` ([apps/web/components/session-gate.tsx](../apps/web/components/session-gate.tsx)): a loading screen until `/auth/me` succeeds. So `useRBAC()` / `useAuthStore` are already populated when a page first renders, and pages never handle "not logged in" themselves. If `/auth/me` fails for another reason, the gate shows `SessionErrorScreen`. When the browser is offline or the API is down or returns 5xx/429, the screen says so and retries on its own: after 3 s, doubling up to 30 s, and at once when the browser comes back online. Any other failure gets **Try again** and **Sign out**. The API client throws `ApiNetworkError` when a request gets no response; `classifyLoadError` (`@saas/ui`) tells the cases apart.

### State

| Concern | Where it lives |
|---------|----------------|
| Screen-local state | `useState`, `useReducer` |
| Auth / tenant / user | `useAuthStore` (Zustand + persist; localStorage key `auth-storage`) |
| RBAC | `useRBACStore` — access via `useRBAC()` hook, never directly |
| Preferences (locale, date format, sidebar) | `usePreferencesStore` |

Do **not** introduce new Zustand stores for per-screen state.

### Styling

- **Tailwind CSS 4** — utility classes only, no per-component CSS files
- **Tenant theming** via CSS variables from `useTenantTheme()` — use `bg-primary`, `text-primary-foreground`, `bg-sidebar`, etc. — never hardcoded hex
- **Dark mode** via `dark:` prefix; provider toggles `dark` class on `<html>`
- **Icons**: `lucide-react` only
- Plugin CSS is picked up via Tailwind 4 `@source` directives in [apps/web/app/globals.css](../apps/web/app/globals.css) — regenerated by `pnpm plugins:register`

### Loading / empty / error patterns

| State | Component |
|-------|-----------|
| Initial load | `<Skeleton />` rows matching final layout |
| Empty data | `<EmptyState title description action />` |
| API error | `<ErrorAlert message={error} onRetry={refetch} />` |
| Submitting | Disabled button + `<Spinner />` |
| Forbidden | `<Forbidden />` full-page placeholder |

---

## 8. Data layer — Prisma schema-per-tenant

### Schema placement

| Data nature | Location |
|-------------|----------|
| Shared across every tenant (platform-level) | [packages/database/prisma/header.prisma](../packages/database/prisma/header.prisma) |
| Owned per-tenant (default for plugin models) | `plugins/{slug}/src/database/prisma/fragment.prisma` |
| No persistence | no file — see `plugins/audit-log/` as an example |

### Fragment rules

- **No** `datasource` or `generator` blocks (merge validator rejects both)
- **No** redefining reserved models (`Tenant`, `Plugin`, `User`, `Role`, `Permission`, `TenantConfig`, `AuditLog`, `AuditConfig` — the list enforced by `scripts/merge-prisma-schemas.js`), nor any other model already in `header.prisma`
- **No** `tenantId` column on tenant-scoped models — tenancy is enforced by the schema itself
- Every model: `id String @id @default(uuid())`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`
- Model names PascalCase; Prisma client exposes camelCase delegates (`SampleItem` → `client.sampleItem`)
- Always declare both sides of a relation with explicit `onDelete` / `onUpdate`

### Migration flow

```bash
# 1. Edit fragment.prisma or header.prisma
pnpm plugins:merge-prisma                     # Validate + merge
pnpm db:generate                              # Regenerate Prisma client
pnpm db:migrate:dev --name add-x-model        # Creates the migration
pnpm db:migrate:tenants                       # Applies to every tenant_{slug} except TERMINATED tenants
```

**Never** run `prisma migrate reset` on an environment with tenant schemas — it drops every `tenant_*`.

### Seeding

- **Platform-wide** (public schema, once) → [apps/api/src/seed.ts](../apps/api/src/seed.ts), run with `pnpm db:seed`
- **Per-tenant defaults** (every tenant on install) → implement in the plugin's `lifecycle.onInstall(ctx)` hook. Example: [plugins/sample-plugin/src/lifecycle.ts](../plugins/sample-plugin/src/lifecycle.ts)

---

## 9. Plugin system

### Anatomy

```
plugins/{slug}/
├── package.json                    name: @saas/plugin-{slug}; "exports" (./api, ./web, ./menus, ./permissions,
│                                   ./dictionaries, ./lifecycle, optional ./emails, ./config-schema) and "pluginManifest"
├── src/
│   ├── permissions.ts              [{ name, description }, ...]
│   ├── dictionaries.ts             Dictionaries = { en: {...}, id: {...} }
│   ├── lifecycle.ts                onInstall / onActivate / onDeactivate / onUpgrade / healthCheck / getDefaultConfig
│   ├── emails.ts                   optional: emails it sends (defineEmail), see § Email
│   ├── config.schema.ts            optional: the plugin's settings (Zod), exported as ./config-schema, see § Plugin manifest and settings
│   ├── api/
│   │   ├── index.ts                re-exports NestJS modules
│   │   └── {feature}/              feature sub-modules
│   ├── web/
│   │   ├── index.ts                re-exports React pages
│   │   ├── menus.ts                MenuNode[] for sidebar
│   │   ├── pages/
│   │   └── components/
│   └── database/
│       └── prisma/fragment.prisma  optional
```

### Lifecycle hooks

`lifecycle.ts` exports an object with:

- `onInstall(ctx)` — runs the first time a tenant enables the plugin (via toggle or subscription). Seeds defaults. **Must be idempotent** — a failed install can be retried.
- `onActivate(ctx)` — same idempotency; called when the plugin is re-enabled after being disabled.
- `onDeactivate(ctx)` — reversible cleanup only. Do **not** drop tenant data.
- `onUpgrade(ctx)` — runs when the tenant enables a plugin whose version changed (`ctx.fromVersion`, `ctx.toVersion`); use it for data migrations. Throwing rolls back to the previous version.
- `getDefaultConfig()` — the settings stored the first time the plugin is installed for a tenant.
- `healthCheck(ctx)` — called by the plugin health endpoint (`PluginHealthService`, 3 s budget); returns `healthy`, `degraded` or `unhealthy`.

Throwing from `onInstall`, `onActivate` or `onDeactivate` **prevents the toggle**, so the plugin stays as it was. There is no uninstall: a plugin is only enabled or disabled per tenant, and its data stays. See [plugin-lifecycle.interface.ts](../packages/backend/src/plugin/plugin-lifecycle.interface.ts).

Lifecycle hooks run **outside NestJS DI**. Build a short-lived `PrismaClient` bound to `tenant_{ctx.tenantSlug}` yourself — see the reference in [plugins/sample-plugin/src/lifecycle.ts](../plugins/sample-plugin/src/lifecycle.ts).

### Dev mode — one watcher for every plugin

`pnpm dev` runs exactly three turbo tasks: `api#dev`, `web#dev` and the root `//#dev:watch` ([scripts/dev-watch.js](../scripts/dev-watch.js)). The watcher is a single `tsc -b --watch` over [tsconfig.dev.json](../tsconfig.dev.json), which references `packages/backend` and every plugin (each a `composite` project). It:

- builds each project into its own `dist` (identical to that package's `pnpm build`) and prints every type error, for API and web code, in the `pnpm dev` output;
- runs a plugin's `assets` script (e.g. copying `.html` templates) once at start;
- re-checks the projects that depend on a changed shared input, since those are imported from outside each plugin's own files: `@saas/ui` source → the plugins (not `packages/backend`, which doesn't use it); the generated Prisma client → `packages/backend` and every plugin (they reach it through `@saas/backend`). Projects are re-checked one after another, so this takes longer than a normal edit — measured with 4 plugins: `@saas/ui` change ≈ 6 s to the first error, ≈ 12–17 s for all plugins; Prisma client change (`pnpm db:generate`) ≈ 20–30 s, growing with the number of plugins. On startup it also re-checks projects built before the latest `@saas/ui` / Prisma client change, so a change made while `pnpm dev` was stopped is still type-checked after a restart;
- only rebuilds the projects you change (a plugin edit shows its errors in ≈ 3 s), so adding plugins does not add processes or turbo slots — no `--concurrency` flag needed;
- picks up plugins registered while it runs (`pnpm plugins:register` updates `tsconfig.dev.json`; the watcher restarts `tsc` and builds the new plugin).

On a fresh clone (no `dist` yet) the API's dev script first runs [scripts/wait-for-dev-build.js](../scripts/wait-for-dev-build.js), which waits for the watcher's first build before starting Nest; on a warm start it returns immediately. `tsc -b` decides what is out of date from file timestamps, so a file restored with an *older* timestamp (`cp -p`, `rsync -t`, extracting an archive) is not rebuilt — `touch` it.

The API dev server restarts automatically — **once per completed watcher build cycle** in which backend or plugin output the API loads changed (the watcher writes `.dev-watch/api-reload.stamp`, which is all the API's webpack watches). A type change that ripples through several plugins is still one restart; plugin UI-only edits (`src/web`) don't restart the API. Plugins and `packages/backend` deliberately have **no** `dev` script; do not add one (turbo would start a second compiler writing the same `dist`).

### Adding a plugin — required follow-up

1. `pnpm plugins:register`
2. Check that `pnpm plugins:register` added `@saas/plugin-{slug}` to `transpilePackages` in [apps/web/next.config.js](../apps/web/next.config.js) (it rewrites that array)
3. If the plugin has a fragment: `pnpm plugins:merge-prisma` → `pnpm db:generate` → migrate

Skipping any of these leaves the plugin invisible to the app or produces Tailwind/build errors.

### Registries

These files are **generated** and regenerated by `pnpm plugins:register`:

- [apps/api/src/plugin-registry.ts](../apps/api/src/plugin-registry.ts) — exports `PluginModules`, `PluginPermissions`, `PluginLifecycles`, `PluginConfigSchemas`, `PluginEmails`, `PluginList`, `PluginManifests`, `PluginDependencyGraph`
- [apps/web/lib/plugin-menus.ts](../apps/web/lib/plugin-menus.ts) — `PluginMenus` (imports only each plugin's `/menus` entry; used by the sidebar)
- [apps/web/lib/plugin-dictionaries.ts](../apps/web/lib/plugin-dictionaries.ts) — `PluginDictionaries` (imports only `/dictionaries`; used by the root layout)
- [apps/web/lib/plugin-routes.ts](../apps/web/lib/plugin-routes.ts) — `PluginRouteLoaders`, one lazy `import('<plugin>/web')` per plugin, so a plugin's pages are only compiled/loaded when one of its routes is opened
- [tsconfig.dev.json](../tsconfig.dev.json) — the dev watcher's solution file (`packages/backend` + every plugin)

`plugins:register` also **validates each plugin's `tsconfig.json`**: it must be a composite project (`"composite": true`, `"rootDir": "./src"`, `"tsBuildInfoFile": "./dist/tsconfig.tsbuildinfo"`, `"references": [{ "path": "../../packages/backend" }]`). `pnpm plugin:new` generates exactly that. Never import the plugin `/web` entry statically from shared app code (layout, sidebar) — it would compile every plugin's pages into every route again.

**Never hand-edit** these files. Changes to them will be overwritten on the next registry run.

### Plugin manifest and settings

- **Manifest**: `pluginManifest` in the plugin's `package.json`: `key`, `displayName`, `description` (shown in the plugin lists), `category`, `tags`, `sdkVersion`, `coreCompatibility` (semver range), `pluginDependencies` (`{ "<plugin-key>": "<semver range>" }`) and `pluginConflicts` (keys). `pnpm plugins:register` copies it into `PluginManifests` and `PluginDependencyGraph`, and **fails** on a missing dependency, a version or core mismatch, a conflict that is present, or a dependency cycle. A tenant can't enable a plugin until its dependencies are enabled; apps switch plugins on dependencies first (§ Apps).
- **Settings** (`src/config.schema.ts`, exported as `./config-schema`): a Zod object whose fields have `.default(…)`. See [plugins/integration/src/config.schema.ts](../plugins/integration/src/config.schema.ts). Tenant admins read and save them with `GET` / `PUT /tenant-plugins/:key/config` (ADMIN). **`PUT` merges** with the stored settings: keys the body leaves out keep their value, and the result is validated against the schema. Services read a tenant's settings from that tenant's `Plugin` row (`config`); `lifecycle.getDefaultConfig()` seeds it on first install.

### Billing (paid plugins)

Design: [docs/superpowers/specs/2026-10-20-plugin-billing-design.md](superpowers/specs/2026-10-20-plugin-billing-design.md). Code: [apps/api/src/billing/](../apps/api/src/billing/).

- **Every charge is an invoice** (public schema, `Invoice`, numbered `INV-<YYYY>-<NNNN>`, with seller/bill-to/price snapshots). Paying it is what switches a paid plugin on — there is no manual approval. Sysadmins can **Mark paid** (bank transfer, or *complimentary* = free and not counted as revenue) or **Void** an invoice.
- **Lifecycle** (tenant schema, `TenantSubscription.status`): `PENDING_PAYMENT` (first invoice unpaid, plugin off) → `ACTIVE` (paid through `currentPeriodEnd`; one-time = no end, shown as *Owned*) → renewal invoice `renewalLeadDays` before the end → `PAST_DUE` (plugin on, `graceDays`) → `PAUSED` (plugin off, data kept) → paying resumes. `TRIAL` gets its conversion invoice before the trial ends and pauses if unpaid. Cancel = end at period end (undo with resume); anything not yet paid ends at once. The rules are pure functions in `lifecycle.ts`; the hourly `BillingJob` executes them under the plugin toggle lock.
- **One liveness rule**: `isSubscriptionLive` (`@saas/backend`) — ACTIVE, PAST_DUE, unexpired TRIAL. The paywall and `PluginEnabledGuard` both use it; a paid plugin with no live subscription is blocked.
- **Payment providers** implement `PaymentProvider` (`providers/payment-provider.ts`: `createCheckout` + `parseCallback`) and are chosen in `providers/resolve-provider.ts` from `BILLING_PROVIDER`. The `fake` provider's page is `/pay/<checkoutId>` (public) and its callbacks go through the same `POST /billing/callbacks/:provider` path a real provider would use. To add Xendit: implement the interface with the Xendit Invoice API, register it in `resolveProvider`, set `BILLING_PROVIDER=xendit` + `BILLING_CALLBACK_TOKEN`.
- `BILLING_PROVIDER` has **no default** (paid plugins unavailable). `fake` on a production build also needs `BILLING_FAKE_ALLOWED=true`.
- Pricing changes apply at the next invoice; a plugin made **free** voids open invoices, a plugin made **paid** gives its current users a trial (its `trialDays`, or 14).
- After a billing schema change: `pnpm db:migrate:deploy && pnpm db:migrate:tenants`. Trigger the job by hand: `POST /billing/admin/run-job` (sysadmin) or the button on the sysadmin Billing page.

### Apps (plugin bundles)

Design: [docs/superpowers/specs/2026-10-27-app-bundles-design.md](superpowers/specs/2026-10-27-app-bundles-design.md). Code: [apps/api/src/apps/](../apps/api/src/apps/) (catalog, tenant store, content changes) and the billing files named below.

- **An app is a catalog product** (public schema): `App` (key, name, icon, description, pricing like a plugin's, `isPublished`) and `AppPlugin` (its plugins, ordered). The sysadmin creates and prices apps at `/plugins/apps` (`/apps` API, `SYSADMIN`); no code per app. An app key never equals a plugin key, and an app must contain every plugin its plugins depend on.
- **Product keys.** `TenantSubscription.pluginKey` and `Invoice.pluginKey` hold a *product key*: a plugin key, or `app:<appKey>` (`appRef` / `appKeyOf` in `@saas/backend`). Apps go through the same lifecycle, job, invoices, checkout and locks as plugins; `CatalogService.getProduct(productKey)` resolves the price and contents of either.
- **One access rule** — `isPluginGranted(pluginKey, subscriptions)` (`packages/backend/src/plugin/entitlement.ts`): a paid plugin is usable when its own subscription is live **or** a live app subscription whose `grantedPlugins` contains it. `PluginAccess` (the guard), the paywall in `toggleTenantUnlocked`, the store and billing all use it. Clear the access cache (`AppPluginsService.clearAccessCache`) for every plugin an app subscription grants whenever it changes.
- **What a subscription grants** is `TenantSubscription.grantedPlugins`, set from the app's contents when it starts and refreshed whenever an invoice for it is paid. Adding a plugin to an app reaches live subscribers at once (`AppContentsListener`); where it can't be switched on, the tenant is told and the Apps page lists it (`App.switchOnFailures`, shown while the tenant holds the app and the plugin is still off). Removing one takes effect at each subscriber's next paid invoice (recurring subscribers are notified). Owned (one-time) and free app subscriptions keep what they have, and so does a live subscription when its app is made free.
- **Buying an app** switches its plugins on, dependencies first (`AppPluginsService.switchOn`). When the app is paid, the tenant's own subscriptions to its plugins give way (`replacementFor`): active and recurring in the app's currency → ended, unused time becomes credit; another currency → stops renewing; owned → kept; trial / unpaid / paused → ended. The plugin is never switched off by that — nor later, when an own subscription ends or pauses while a live app grants the plugin (`SubscriptionsService.grantedByApp`). Credit counts only time paid under the current own subscription (periods starting at its `startDate`), so time credited once is never credited again. A plugin a live app grants can't be bought on its own, unless it was taken out of the app (it can then be bought before the renewal drops it). A plugin an app subscription lists (unless ENDED) never gets a free → paid trial of its own.
- **Credit** is a ledger (`BillingCredit`: GRANT / USE / RESTORE per tenant and currency, `CreditService`). Invoices take it when issued (`InvoiceService`, under a Postgres advisory lock per tenant and currency): Subtotal − Credit, then tax. A voided invoice gives its credit back (`restoreForInvoices` skips one that was paid meanwhile). A fully credited invoice is settled by `CreditSettlementListener` (provider `credit`) after the issuer releases its lock; the hourly job never marks a subscription past due or pauses it over such an invoice, and settles any the listener missed (a restart in between); when both try, the second does nothing (not a "paid twice" flag). The tenant gets no "New invoice" notice for it, only "Paid from your credit" (email `core.billing-paid-with-credit`).
- **Pausing or ending an app** switches off the plugins nothing else grants (free ones stay), dependents first (`AppPluginsService.switchOffUngranted`, order from `switchOffOrder`); data is kept. The pause notice names them, and the cancel dialog shows them in advance (`switchesOff` on the app's row in `GET /billing/subscriptions`).
- **A hidden app** (`isPublished` off) can't be bought, but an invoice a tenant still owes for it can be paid from the store as well as from Billing.
- **Locks:** app operations take `toggle:<slug>:app:<key>` first, then each plugin's lock — never the other way round. While holding only an app lock, switch plugins with `PluginsService.toggleTenant` (it takes the plugin lock).
- **Tenant endpoints:** `GET /tenant-apps` (store) and `GET /tenant-apps/:key/preview` (ADMIN), `GET /tenant-apps/menu` (any tenant user; the sidebar's app sections), `GET /billing/credit`. Subscribe / cancel / resume use the billing routes with the encoded product key (`/billing/subscriptions/app%3Awarehouse`).

### Email

Design: [docs/superpowers/specs/2026-10-21-email-templates-design.md](superpowers/specs/2026-10-21-email-templates-design.md). Code: [apps/api/src/email/](../apps/api/src/email/) (sending, log), [packages/backend/src/email/](../packages/backend/src/email/) (contracts, renderer), [plugins/document-templates/src/api/emails/](../plugins/document-templates/src/api/emails/) (tenant edits).

**Every email is a template someone declared.** A plugin lists its emails in `src/emails.ts` (and `exports["./emails"]` in its `package.json`); `pnpm plugins:register` picks them up:

```ts
export const myPluginEmails = [
  defineEmail({
    key: 'my-plugin.order-shipped',          // '{plugin-key}.{kebab-name}'
    scope: 'tenant',                         // plugins may only declare tenant emails
    name: 'Order shipped', description: 'Sent to the customer when an order ships',
    variables: z.object({ orderNumber: z.string(), trackingUrl: z.string().describe('Carrier link') }),
    sample: { orderNumber: 'SO-1', trackingUrl: 'https://track.example/1' },
    required: ['trackingUrl'],               // a tenant edit must keep it
    sensitive: [],                           // e.g. ['resetUrl']: hidden in the log, link-only
    defaults: { en: { subject: '…', html: '…' }, id: { subject: '…', html: '…' } },  // both languages
  }),
];
```

Send it from any service, without importing core: `@Inject(EMAIL_SERVICE) email: IEmailService` then `await email.send({ template: 'my-plugin.order-shipped', tenantSlug, to, data, idempotencyKey? })`. `send` validates `data` against `variables`, renders, logs and **queues** the email; it returns at once and never throws because delivery failed (only for an unknown template, bad data, or a database error). The API refuses to boot if a definition is invalid.

- **Templates** are Handlebars inside a fixed, branded layout (tenant logo, name, primary colour). Every template also gets `company.name`, `company.logoUrl` and `appUrl`. Helpers: the document helpers (`formatDate`, `formatCurrency`, `eq`, `ifCond`, …) plus `{{button url "Label"}}`.
- **Tenants reword them** in **Templates → Emails** (document-templates plugin), per language. Saving cleans the HTML (allowlist) and refuses `{{{ }}}`, partials, unlisted helpers, a dropped `required` variable, or a `sensitive` variable anywhere but a whole link. An edit is used only while document-templates is enabled (and paid for) for the tenant, and only while it still passes the current definition's checks; otherwise the default goes out and the log says why.
- **Scopes**: `tenant` emails are logged in the tenant schema and each tenant can edit them. `platform` emails (core only: workspace lifecycle, billing notices, contact sales) are logged in public, and **sysadmins** edit them in the **Platform emails** group of Templates → Emails, which only sysadmins see. Those edits are stored in public (`email_template`) and go through the same checks as tenant edits. They are used while document-templates is usable by the System workspace (`PluginAccess.check('document-templates', 'system')`, the same rule that opens the editor); otherwise the default goes out.
- **Statuses**: `QUEUED` → `SENT`, or `FAILED` after 3 attempts, or `SKIPPED` when SMTP isn't configured. Emails with a sensitive link are logged with `[hidden]` and can't be retried. Logs older than `EMAIL_LOG_RETENTION_DAYS` (90) are deleted nightly.
- **Logs**:
  - **Tenant log, Systems → Email.** Sender name, reply-to and retry. It also lists, read-only and marked *Platform*, the platform emails sent for that tenant whose definition sets `showInTenantLog: true` (billing, welcome, workspace notices; never contact sales). It merges both sources newest first, and only the platform can resend those emails.
  - **Platform log, System → Platform Email Log** (sysadmin). Every platform email, with a workspace filter.
- **Configuration**: `SMTP_HOST`, `SMTP_PORT` (TLS on 465), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_FROM_NAME`; `API_PUBLIC_URL` makes logo URLs absolute. Unset `SMTP_HOST` or `MAIL_FROM` → every email is `SKIPPED`.
- **Local development**: run [Mailpit](https://mailpit.axllent.org/) (`docker run -p 1025:1025 -p 8025:8025 axllent/mailpit`, or the `mailpit` service in your local `infra/` compose) and set `SMTP_HOST=localhost`, `SMTP_PORT=1025`, empty `SMTP_USER`/`SMTP_PASS`. Every email lands in the Mailpit inbox at http://localhost:8025 instead of reaching real people.

### Google Calendar

Design: [docs/superpowers/specs/2026-10-23-google-calendar-design.md](superpowers/specs/2026-10-23-google-calendar-design.md). Code: [packages/backend/src/calendar/](../packages/backend/src/calendar/) (contract, validation), [apps/api/src/calendar/](../apps/api/src/calendar/) (facade, `calendar` queue worker, replay sweep), [plugins/integration/src/api/google-calendar/](../plugins/integration/src/api/google-calendar/) (the Google provider, connections, routes). Example caller: the sample plugin's articles.

**Plugins put items on a user's own calendar without knowing about Google.** Inject the contract and call it after your own write:

```ts
constructor(@Optional() @Inject(CALENDAR_SYNC) private calendar?: ICalendarSync) {}

await this.calendar?.upsert({
  tenantSlug, userId,                       // whose calendar
  source: 'my-plugin', key: `order:${id}`,  // your plugin key + your id: upserts are idempotent on (user, source, key)
  title: 'Delivery: SO-1',
  start: order.deliverAt,                   // ISO string or Date; end defaults to +30 min
  allDay: false, timeZone: undefined,       // allDay → dates only (end exclusive); zone defaults to the tenant's
  description: '…', location: '…', url: `${FRONTEND_URL}/…`,  // url: a link back to the item, http(s)
  meetingUrl: meeting.joinUrl,              // optional video meeting, https: a Meet link becomes the event's Google Meet
});
await this.calendar?.remove({ tenantSlug, userId, source: 'my-plugin', key: `order:${id}` });
```

- **It returns at once** with a status; it never calls Google itself. `queued` = recorded and queued; `not-connected` = the user has no working connection (a broken one still records it); `disabled` = the tenant switched Google Calendar off or the Integration plugin isn't usable (recorded and replayed when it is back); `not-configured` = the platform has no Google credentials (nothing recorded). Only bad input throws (`BadRequestException`): an empty title, an invalid date or zone, an end before the start, a non-http(s) `url`, a non-https `meetingUrl`, or a `source`/`key` that breaks the rules. Wrap the call in try/catch anyway so calendar trouble never fails your action.
- **`meetingUrl`** (e.g. a `joinUrl` from Google Meet) is the event's video meeting. A `https://meet.google.com/…` link becomes the event's Google Meet: Calendar shows **Join with Google Meet** in its conferencing section, not in Location. Every write sends `conferenceDataVersion=1`, so a new link replaces the old one and an upsert without `meetingUrl` removes it. Meet that someone adds by hand in Google to an event the app manages is removed at the next sync. Any other link goes in Location (or the description, when you also pass `location`). Should Google refuse the Meet link as conferencing, the event is saved with the link in Location instead and a warning is logged.
- **Every event is applied as its latest requested state**, so call `upsert` again after any change (same key) and `remove` when the item goes away. A remove for an event that was never synced is harmless.
- **Backfill on connect**: listen to `SystemEvents.INTEGRATION_CALENDAR_CONNECTED` (`{ tenantSlug, userId }`) with `@OnPluginEvent(event, '<your-plugin-key>')` and upsert that user's current items (keep it bounded; the sample sends the 100 latest).
- **What people see**: **Integration → Google** (the same page holds Google Meet, below). With `integration.google-calendar.connect` a user connects their Google account; the app creates a calendar of its own in it (`<tenant> (via <MAIL_FROM_NAME>)`) and only ever touches that calendar. With `integration.google-calendar.manage` an admin switches the integration on for the tenant (it starts off), sees who is connected, and sees the sync log with **Retry** for failed events. ADMIN has both. **Disconnect** without *"Also delete the calendar"* leaves the calendar in Google and keeps its event records, so changes made meanwhile are applied when the user reconnects the same account; with it, both go. Every user also sees their connection on **Account → Profile** (*Connected account*, with what it is used for), served by core (`GET /calendar/connection`, `POST /calendar/connection/disconnect`, signed-in user only), so they can disconnect even while Integration is switched off or unpaid. A broken connection (access revoked, calendar deleted, Testing-mode expiry) becomes *Needs reconnecting* and the user gets a notification; deleting or deactivating a user removes the app's calendar from their Google account, and deleting a tenant does that for all its users first (`SystemEvents.TENANT_DELETING`, awaited before the schema is dropped).
- **Under the hood**: requests are recorded in `CalendarEventLink` (tenant schema) and a job carrying only `{ tenantSlug, userId, source, key }` applies the row's current state with a deterministic Google event id, so late or repeated jobs do no harm. A 10-minute sweep (`CalendarReplayJob`) re-queues whatever is pending once syncing can resume. Refresh tokens are stored encrypted (`secretBox`, AES-256-GCM, bound to their tenant and user so a copied value won't open); access tokens live only in memory. A provider implements `ICalendarProvider` (`record`, `apply`, `pendingRefs`, plus `connectionOf` / `disconnect` for the account page). Revoking at Google ends every grant the Google account gave the platform, so the app revokes only when no other connection, in any tenant, uses that account (`CalendarAccountIndex`, public schema). The queue is `calendar` on the Jobs page.

**Setup** (one Google Cloud project for the platform):

1. In [Google Cloud console](https://console.cloud.google.com/): create a project, enable the **Google Calendar API**.
2. **OAuth consent screen**: User type *External*, publishing status *Testing*; add the scope `https://www.googleapis.com/auth/calendar.app.created` (plus `openid`, `email`); add your test users (only they can connect while in Testing).
3. **Credentials → Create OAuth client ID → Web application**, with the authorized redirect URI `${FRONTEND_URL}/plugins/integration/google-calendar/callback` (e.g. `http://localhost:3000/plugins/integration/google-calendar/callback`).
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `INTEGRATION_ENCRYPTION_KEY` (`openssl rand -base64 32`; keep it — changing it makes every stored connection unreadable, and users must reconnect). Restart the API. If any of the three is missing or the key isn't 32 bytes, the page says Google Calendar isn't set up.
5. Enable the Integration plugin for the tenant, open **Integration → Google**, switch it on, connect.

- **Testing mode**: Google expires refresh tokens after **7 days**, and at most 100 test users can connect. Connections then show *Needs reconnecting*; that's expected until the app is published.
- **Production checklist**: publish the consent screen (*In production*); add your **authorized domains**, a **privacy policy URL** and a homepage; check the scope's classification shown in the console (sensitive scopes need **Google verification**, which takes days to weeks — unverified apps show a warning and stay capped at 100 users); register the production redirect URI; set the three variables in the production environment and keep `INTEGRATION_ENCRYPTION_KEY` in your secret store.

### Google Meet

Design: [docs/superpowers/specs/2026-10-27-google-meet-design.md](superpowers/specs/2026-10-27-google-meet-design.md). Code: [packages/backend/src/meetings/](../packages/backend/src/meetings/) (contract, validation), [apps/api/src/meetings/](../apps/api/src/meetings/) (facade, lock sweep), [plugins/integration/src/api/google-calendar/](../plugins/integration/src/api/google-calendar/) (`google-meet.provider.ts`, `meet-spaces.service.ts`; same connection and page as Calendar). Example caller: the sample plugin's article review meeting ([sample-article-meetings.service.ts](../plugins/sample-plugin/src/api/sample-articles/sample-article-meetings.service.ts)).

**Plugins get a meeting link for one of their items, hosted in a user's own Google account.** Inject the contract:

```ts
constructor(@Optional() @Inject(MEETINGS) private meetings?: IMeetingService) {}

const ref = { tenantSlug, source: 'my-plugin', key: `order:${id}` }; // one meeting per (source, key)
const result = await this.meetings?.create({ ...ref, hostUserId, title: 'Handover: SO-1', access: 'TRUSTED' });
const meeting = await this.meetings?.get(ref);       // { provider, joinUrl, hostUserId, access, status } or null
const { status, locked } = await this.meetings!.cancel(ref);
```

To put the meeting on the host's calendar, pass `meetingUrl: meeting.joinUrl` to `calendar.upsert` (not `location`): it becomes the event's Google Meet.

- **`create` is idempotent on the key**: `created` the first time, then `existing` with the same link while the same host asks; a different `access` from the same host changes it in Google. Statuses without a meeting: `not-connected` (the host has no working Google connection), `needs-permission` (connected, but hasn't allowed Meet), `disabled` (the tenant has Meet off or Integration isn't usable), `not-configured` (no Google credentials, or no meetings provider). `unavailable` and `failed` carry a `message` to show: Google was slow (the call gives up after 10 s, but the meeting may still be made, so a retry returns it) or refused (including the platform's own sign-in, e.g. a rotated client secret: the host's connection is left alone). A join link Google returns that isn't `https://meet.google.com/…` is refused (`failed`). Two creates for the same key at once make one meeting; the other waits for it. Only bad input throws (`BadRequestException`: `source`/`key` like Calendar's, `title` ≤ 200 characters, an unknown `access`).
- **Access types** (who joins without knocking): `TRUSTED` (the host's organization and invited guests), `OPEN` (anyone with the link), `RESTRICTED` (invited guests only). Omit `access` to use the tenant's default joining rule.
- **`status`**: `ACTIVE`; `CANCELLED` (cancelled, or replaced); `ORPHANED` (the host disconnected, switched Google accounts or left: the link no longer belongs to anyone the app manages). Create again for a new one. A different host creating for the same key replaces the meeting: the old one is cancelled and locked.
- **`cancel`** returns `{ status: 'cancelled' | 'not-found', locked }` within 10 s; `locked: false` means Google couldn't be reached yet, or was slower than that (the app finishes the lock later). A create in progress for the same key finishes first, so its meeting is the one cancelled. Cancelling twice is harmless. `get` and `cancel` work even after the platform's Google credentials are removed (the lock then waits until they are back).
- **Events** (`SystemEvents`, payload `MeetingEvent { tenantSlug, source, key, hostUserId, reason?, replaced? }`): `INTEGRATION_MEETING_CREATED`, `INTEGRATION_MEETING_CANCELLED` (with a reason; `replaced: true` when another host's create replaced it, so the item still has an active meeting, else `false`), `INTEGRATION_MEETING_ORPHANED` (with the reason). Listen with `@OnPluginEvent` to update your item.
- **One Google connection for both features.** The page and connect flow are Calendar's; each user's connection records the scopes Google granted, and the connect asks only for the features the tenant has on (`include_granted_scopes`), so a Calendar-only user sees **Allow Google Meet** once Meet is switched on. A Meet-only connection makes no calendar. Each feature reads `ready`, `needs-permission`, `off` (switched off for the tenant) or `not-connected` (the connection needs reconnecting or was disconnected). The account card lists what the connection is used for (`features[].key`: `calendar`, `meetings`) and says disconnecting locks meetings when the user hosts open ones (`activeMeetings`). When access stops working, the user's notification names what stopped: calendar sync, meetings, or both (`CalendarConnectionEvent.features`).
- **The lock rule**: the app can't delete a Meet space, so whenever it stops managing one (cancel, replaced, the host disconnects, switches accounts, is deactivated or deleted, or the tenant is deleted) it sets the space to `RESTRICTED` and ends any call in progress. Guests then knock and the host can still admit them. When the host's token is about to go away (disconnect, offboarding, account switch), a busy Google is retried for about 5 s, all of the host's meetings at once. `lockState` on each meeting: `OPEN`, `LOCKED`, `PENDING` (Google was unreachable; retried by the 10-minute `MeetingLockJob` and when the host reconnects) or `FAILED` (the host's connection is gone, so nobody can lock it). A departed user's token is never kept to lock later.
- **What people see**: on **Integration → Google**, the manage permission adds *Create Google Meet meetings* (off by default) and *Who joins without knocking* (the default access) to the organization settings, a Meet column to *Connected users*, and a *Meetings* list with lock states and **Cancel**. Rows are `MeetingItem` (one per source/key) and `MeetingSpace` (one per Google space) in the tenant schema.

**Setup**, on the Google Cloud project used for Calendar:

1. Enable the **Google Meet REST API**.
2. **Data Access**: add the scope `https://www.googleapis.com/auth/meetings.space.created` (*create and manage the meetings the app creates*).
3. On **Integration → Google**, switch on *Create Google Meet meetings*. Users connected before Meet was switched on click **Allow Google Meet**.

- **Production**: `meetings.space.created` is a **Sensitive** scope: publishing the app needs Google's verification, as in Calendar's production checklist.

---

## 10. RBAC

### Permission format

`{plugin-slug}.{resource}.{action}` — lowercase, dot-separated. Examples:

- `sample-plugin.item.read`
- `sample-plugin.item.write`
- `integration.webhook.write`
- `integration.google-calendar.manage`

### Declaration

```ts
// plugins/{slug}/src/permissions.ts
export const XPluginPermissions = [
  { name: 'x.thing.read',  description: 'View things' },
  { name: 'x.thing.write', description: 'Create/update/delete things' },
];
```

The registry picks these up; every tenant provisions them automatically. **Do not** insert into `Permission` directly.

### Enforcement

| Layer | How |
|-------|-----|
| Controller | `@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)` + `@Permissions('x.thing.read')` (per-method) |
| UI elements | `<Protect permissions={['x.thing.write']}>{children}</Protect>` |
| UI page | `useRBAC().authorize({ permissions: ['x.thing.read'] })` → `<Forbidden />` if false |

### Roles

- `SYSADMIN` — global bypass; the role is created in every tenant. Platform operators are the SYSADMIN users of the **System workspace** (slug `system`, created by `pnpm db:seed`; `SYSTEM_TENANT_SLUG` in `@saas/backend`). They sign in as `username@system` (the seed creates `admin@system`, password `DEFAULT_ADMIN_PASSWORD`) and run the sysadmin pages (tenants, plugins and apps, billing, Platform Email Log, jobs)
- `ADMIN` — default tenant admin
- Custom roles — managed in the tenant's Role/Permission tables

`RbacGuard` checks the user's role+permission set (re-read from the tenant DB on every request). If `@Roles('ADMIN')` is declared at the class level and a method has `@Permissions(...)`, the default mode is **OR**: the request passes if the user has **any** listed role **or any** listed permission — so an ADMIN passes every method, and a custom role passes when it holds the permission. Add `@RbacMode('AND')` to require both. Method-level `@Roles` replaces (not merges with) the class-level one. See [packages/backend/src/auth/rbac.guard.ts](../packages/backend/src/auth/rbac.guard.ts) and its spec.

The seeded `USER` role starts with **no permissions**, and enabling a plugin grants its permissions to `ADMIN` only — tenant admins decide what `USER` (or any custom role) gets in the Roles screen.

---

## 11. Internationalization (i18n)

- Two locales: `en` and `id` — both are mandatory
- Top-level namespace in each plugin's `dictionaries.ts` should match the plugin's camelCase name
- Use `useLanguage()` → `t('namespace.key', params?)`
- Parameters use `{name}` interpolation: `t('items.deleteCount', { count: 5 })`
- Dictionaries merge at runtime via `mergeDictionaries()` — plugin dictionaries are combined with web-app dictionaries

Reference: [plugins/sample-plugin/src/dictionaries.ts](../plugins/sample-plugin/src/dictionaries.ts).

---

## 12. Events and realtime

### In-process events (backend)

```ts
constructor(private readonly events: PluginEventService) {}            // from @saas/backend
this.events.emit('my-plugin.order.shipped', { tenantSlug, orderId, timestamp: new Date() }); // emitAsync to wait for listeners

@OnPluginEvent(SystemEvents.INTEGRATION_CALENDAR_CONNECTED, 'my-plugin')  // like @OnEvent, but only while my-plugin is enabled
async onConnected(event: CalendarConnectionEvent) { … }                  // for the tenant in the payload
```

Event names and payload types are in [packages/backend/src/events/system-events.ts](../packages/backend/src/events/system-events.ts); every payload has `tenantSlug` and `timestamp`. A class using `@OnPluginEvent` must inject `prisma: PrismaService` and `cache: CacheService` as properties (the enabled check reads them).

### Realtime (backend → browser)

```ts
constructor(private readonly realtime: WebSocketBridgeService) {}       // from @saas/backend
this.realtime.broadcastToTenant(tenantSlug, 'plugin-slug.resource.created', { id });
this.realtime.broadcastToUser(tenantSlug, userId, 'plugin-slug.export.ready', { id });
```

Sockets join `tenant:{slug}` and `user:{slug}:{userId}` rooms. The WebSocket gateway handles auth on connection via a short-lived token from `/auth/ws-token`. **Everything you broadcast reaches every signed-in browser in that room, whatever their permissions**: send ids and let the page refetch through the API, which checks RBAC.

In-process events are **never** forwarded to browsers: only what a service broadcasts goes out. Core broadcasts `notification:new` (no payload but a timestamp) when a notification is written.

### Consuming (frontend)

```tsx
useRealtimeUpdates('plugin-slug.resource.created', (payload) => {
  refetch();
});
```

Event names must match exactly between backend emitter and frontend subscriber.

---

## 13. Background jobs (BullMQ)

Queues (names, job names and retry policies in [packages/backend/src/queue/queue.constants.ts](../packages/backend/src/queue/queue.constants.ts), registered by `QueueModule`):

- `email` — outbound email (queued by `EmailService`; 3 attempts; see § 9 Email)
- `webhook` — outbound webhook delivery with retry/backoff (5 attempts)
- `export` — long-running CSV/XLSX export
- `import` — CSV/XLSX import
- `calendar` — applies calendar events (`sync-calendar-event`; see § 9 Google Calendar)

Scheduled jobs (`@Cron`, in the API process):

| Job | When | What |
|-----|------|------|
| `BillingJob` ([apps/api/src/billing/](../apps/api/src/billing/)) | hourly, and once at startup | renewal and trial-conversion invoices, past due → paused, scheduled ends, settles invoices credit fully covers, expires stale payment links |
| `EmailRetentionJob` ([apps/api/src/email/](../apps/api/src/email/)) | 03:00 daily / every 10 min | deletes logs older than `EMAIL_LOG_RETENTION_DAYS`; marks emails with no result after an hour `FAILED` |
| `CalendarReplayJob` ([apps/api/src/calendar/](../apps/api/src/calendar/)) | every 10 min | re-queues pending calendar events once syncing can resume |
| `MeetingLockJob` ([apps/api/src/meetings/](../apps/api/src/meetings/)) | every 10 min | retries Meet locks that Google couldn't take |
| `AuditRetentionCron` ([packages/backend/src/audit/](../packages/backend/src/audit/)) | 02:00 daily | per-tenant audit retention |

There is no notifications queue: in-app notifications are written synchronously by `NotificationListenerService` (apps/api/src/notifications) in response to plugin events.

Rules:
- Never block a request path with an external HTTP call — enqueue
- Enqueue **after** a transaction commits, not inside
- Management UI: **System → Job Queue** (`/jobs` in the web app, SYSADMIN), and BullBoard at `http://localhost:3001/admin/queues` (needs a SYSADMIN session — log in to the web app first)

---

## 14. Audit logging

- Writes happen automatically via Prisma middleware in [packages/backend/src/prisma/prisma.service.ts](../packages/backend/src/prisma/prisma.service.ts) for every `create` / `update` / `delete` (and `createMany` / `updateMany` / `deleteMany`), on tenant clients and on the main (public schema) client alike
- **`upsert` is never audited.** Where a write must appear in the audit log (settings, templates, anything an admin edits), use `findUnique` and then `update` or `create`; on a race, retry the `create` as an `update` (P2002). See `EmailTemplatesService.save` in document-templates
- Each entry includes before/after snapshots and is hash-chained for tamper-detection
- Retention is per-tenant, driven by `AuditConfig` and the retention cron in [packages/backend/src/audit/](../packages/backend/src/audit)
- Sensitive fields (passwords, tokens) are redacted per tenant config

**Do not** write `AuditLog` rows manually. If you need a custom audit entry for a non-Prisma domain event (e.g. "user invited"), use `AuditService.log(...)` from `@saas/backend` — it updates the hash chain correctly.

---

## 15. Validation

- **Runtime validation**: Zod. DTO files live next to controllers under `dto/*.dto.ts` and export both a schema and the inferred type.
- **API wiring**: `@Body(new ZodValidationPipe(schema))` on the parameter — never `@UsePipes(...)` at the method level.
- **Form wiring**: `zodResolver(schema)` with `react-hook-form` on the web, with a form schema that mirrors the DTO (see § 7 Forms). Change both together.
- **Env vars**: validated at API boot ([apps/api/src/config/](../apps/api/src/config) — crash-fast if missing/malformed).

---

## 16. Testing

- Backend (apps/api, packages/backend, every plugin): **Jest** via NestJS test utilities. Runs via `pnpm test`, `pnpm test:api`, or `pnpm --filter <package> test` (e.g. `@saas/plugin-integration`).
- UI (`@saas/ui`): **Vitest**. Runs via `pnpm test:ui` or `pnpm --filter @saas/ui test`. apps/web has no test runner, so put testable logic (hooks, helpers) in `@saas/ui`.
- Scripts (`scripts/`): **node --test** over `scripts/__tests__/*.test.js`, via `pnpm test:scripts`.
- Mock `PrismaService.getTenantClient` for service tests — never hit a real DB in unit tests.
- Single file: `pnpm --filter api exec jest -- src/path/to/file.spec.ts`

Tests live alongside the source they test (`*.spec.ts` / `*.test.ts`). Don't create a top-level `tests/` folder.

---

## 17. Verification before marking a task done

Before claiming a task is complete, run the matching checklist:

### For any code change
- [ ] Type errors: none in the `pnpm dev` watcher output, or `pnpm exec tsc --noEmit -p .` in each package you changed. That rewrites the tracked `apps/web/tsconfig.tsbuildinfo` and `packages/ui/tsconfig.tsbuildinfo`: `git checkout` them afterwards
- [ ] `pnpm lint` — no errors. Each package has its own `eslint.config.mjs`: apps/web uses Next's config, and apps/api and `@saas/ui` use typescript-eslint's recommended rules. In all three, `any` is a warning in source and allowed in tests, and unused names are errors unless prefixed `_` or dropped with `...rest`. `pnpm --filter api lint:fix` applies fixes. packages/backend and the plugins aren't linted yet
- [ ] `pnpm build` — succeeds (or `pnpm --filter api build && pnpm --filter web build`)
- [ ] `pnpm test` — passes (add tests if you added code that can be tested)

### For plugin changes
- [ ] `pnpm plugins:register` ran; both registries list the plugin
- [ ] If schema changed: `pnpm plugins:merge-prisma` succeeded; migrations created; `pnpm db:migrate:tenants` ran cleanly
- [ ] If new plugin: `transpilePackages` in [apps/web/next.config.js](../apps/web/next.config.js) includes the package (written by `pnpm plugins:register`)

### For API changes
- [ ] Swagger (served at `SWAGGER_PATH`, default `/` → `http://localhost:3001/`) lists the new endpoints under the correct `@ApiTags(...)`
- [ ] Request with missing `x-tenant-id` header is rejected
- [ ] Request with a user lacking the permission returns 403

### For UI changes
- [ ] Page renders with loading / empty / error / forbidden states
- [ ] RBAC gating hides elements for users without permission (not just disables)
- [ ] Every user-visible string has `en` + `id` translations in the plugin dictionary
- [ ] Browser console is free of errors on the golden path

### For database changes
- [ ] Migration up succeeds on public schema AND every tenant schema
- [ ] Indexes exist for fields used in WHERE/JOIN/ORDER BY
- [ ] No `tenantId` column was added to a tenant-scoped model
- [ ] `schema.prisma` is the merged version (don't commit a hand-edited copy)

---

## 18. Common pitfalls — explicit DON'Ts

| Don't | Why |
|-------|-----|
| Don't call `this.prisma.{model}` directly in a plugin service | Binds to public schema — wrong/empty data or cross-tenant writes |
| Don't add `tenantId` to a tenant-scoped Prisma model | Schema-per-tenant already enforces it; duplication breaks queries |
| Don't reorder controller guards | `JwtAuthGuard` first is required — it populates `req.user` |
| Don't use `@UsePipes(...)` at the method level | It applies to `@Param()` too and rejects path params |
| Don't hand-edit the generated registries (`apps/api/src/plugin-registry.ts`, `apps/web/lib/plugin-{menus,dictionaries,routes}.ts`, `tsconfig.dev.json`) | Regenerated on `pnpm plugins:register` — changes will be wiped |
| Don't hand-edit `packages/database/prisma/schema.prisma` | Regenerated from `header.prisma` + fragments by `pnpm plugins:merge-prisma` |
| Don't hardcode English strings in UI | Must be in the plugin dictionary with both `en` and `id` |
| Don't insert directly into `Permission` or `Role` tables | Plugin registry provisions them; seeding happens via lifecycle hooks |
| Don't write `AuditLog` rows manually | Prisma middleware handles it + hash chain |
| Don't use `upsert` for a write that must be audited | The audit middleware skips `upsert`: use `findUnique` + `update` / `create` |
| Don't put anything in a realtime broadcast that not every user of the tenant may see | Everyone signed in to the tenant receives it, whatever their permissions |
| Don't add a second `sonner` version to a plugin | Declare `^2.0.7`; the app aliases it to its own copy so the toast reaches the app's `<Toaster>` |
| Don't call external APIs synchronously from a request handler | Enqueue via BullMQ queue instead |
| Don't run `prisma migrate reset` | Drops every `tenant_*` schema |
| Don't introduce a new Zustand store for screen-scoped state | Use `useState` / `useReducer` |
| Don't mix two tenants in one `$transaction` | Schema binding is per-client |
| Don't hand-edit `transpilePackages` for plugins | `pnpm plugins:register` regenerates the array from the plugin list and will overwrite manual entries |
| Don't skip `pnpm plugins:register` after any plugin change | Registries + Tailwind `@source` directives stay stale |

---

## 19. Where to go deeper

| Topic | Reference |
|-------|-----------|
| Root conventions summary | [CLAUDE.md](../CLAUDE.md) |
| Task templates (per-task scaffolds) | [.forge/task_templates/](../.forge/task_templates/) |
| Reference plugin | [plugins/sample-plugin/](../plugins/sample-plugin/) |
| RBAC guard semantics | [packages/backend/src/auth/rbac.guard.ts](../packages/backend/src/auth/rbac.guard.ts) + spec |
| Feature designs and plans (billing, email, Google Calendar, Google Meet, apps, platform emails, dev watcher) | [docs/superpowers/specs/](superpowers/specs/), [docs/superpowers/plans/](superpowers/plans/) |
| Browser test guides | [GOOGLE_CALENDAR_TESTING.md](GOOGLE_CALENDAR_TESTING.md), [APP_BUNDLES_TESTING.md](APP_BUNDLES_TESTING.md), [PLATFORM_EMAILS_TESTING.md](PLATFORM_EMAILS_TESTING.md) |

---

## 20. Agent operating principles

Adapted to this codebase:

1. **Read the reference plugin** ([plugins/sample-plugin/](../plugins/sample-plugin/)) before writing your first line. Nearly every pattern you need is demonstrated there.
2. **Prefer the generator** (`pnpm plugin:new`) over hand-building a plugin tree — it gets the package.json, tsconfig, and index files correct.
3. **Check [apps/api/src/plugin-registry.ts](../apps/api/src/plugin-registry.ts), [apps/web/lib/plugin-routes.ts](../apps/web/lib/plugin-routes.ts) and [tsconfig.dev.json](../tsconfig.dev.json) after every plugin change** to confirm your plugin registered. If missing, you forgot `pnpm plugins:register`.
4. **Follow the task template flow** in [.forge/task_templates/](../.forge/task_templates/) — don't invent your own structure.
5. **Trust upstream enforcement**. Guards verify auth; middleware resolves tenants; Prisma middleware writes audit logs; `GlobalExceptionFilter` maps errors. Don't duplicate these in service/controller code.
6. **When in doubt, copy the reference** — `sample-plugin` is canonical. Deviating from it requires a real reason.
7. **Verify before claiming done** — run the checklist in section 17. "It compiles" is not "it works".
8. **Ask when blocked** — if a required file or pattern is missing, surface the gap instead of inventing a parallel convention.
