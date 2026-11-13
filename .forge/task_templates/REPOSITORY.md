# Task: Data Access Layer

## Overview

| Field       | Value                                  |
| ----------- | -------------------------------------- |
| PRD         | {{PRD_CODE}}-{{PRD_NAME}}              |
| Task Type   | Repository / Data Access               |
| Depends On  | 01-TASK-MODEL                          |

## Objective

Implement the data-access layer for the entities defined in the Model task. **This codebase does not use a separate Repository class per entity.** Instead, data access is one of two patterns — both built on `PrismaService.getTenantClient(tenantSlug)`:

1. **`BaseCrudService<TEntity, TQuery>`** (from `@saas/backend`) — extends into a single class that gives you paginated list, findOne, remove, bulk delete, availability check, and CSV/XLSX export for free. Use when the entity is a standard CRUD resource with search + pagination.
2. **Plain NestJS service** — injects `PrismaService` and calls `getTenantClient(tenantSlug).{model}.{method}(...)` directly. Use when the access patterns don't fit CRUD (multi-entity orchestration, aggregations, reporting, workflow transitions).

The "repository" in this task is whichever of those patterns fits — there is no standalone `Repository` class to build.

## Codebase Context

- `BaseCrudService` source: [packages/backend/src/crud/base-crud.service.ts](packages/backend/src/crud/base-crud.service.ts)
- Tenant-scoped Prisma client accessor: [packages/backend/src/prisma/prisma.service.ts](packages/backend/src/prisma/prisma.service.ts) (`getTenantClient(tenantSlug)`)
- Reference direct-Prisma service: [plugins/sample-plugin/src/api/sample-items/sample-items.service.ts](plugins/sample-plugin/src/api/sample-items/sample-items.service.ts)
- Reference `BaseCrudService` consumers: core only — [apps/api/src/systems/users/users.service.ts](apps/api/src/systems/users/users.service.ts), `roles.service.ts`, `permissions.service.ts`. No plugin uses it yet; the sample plugin uses the plain pattern.
- `PaginatedResponse` shape: `{ data: T[], meta: { total, page, limit, totalPages } }` ([packages/backend/src/types](packages/backend/src/types))

## Folder Placement — STRICT

> **Before creating the service (data-access) file, inspect the existing plugin tree and reuse the resource folder if one already exists. Never create two folders for the same resource (e.g. both `src/api/uom/` and `src/api/uoms/`). The service file produced here must land in the same folder where the API task will put its controller, module, and DTOs.**

### Procedure

1. **Scan first.** Before writing anything:
   ```sh
   ls plugins/{{MODULE_NAME}}/src/api/
   ```
   Note every existing resource subfolder and any flat files at `src/api/` root.
2. **Resource slug = folder name.** The folder name follows **plural kebab-case** and mirrors the future API route `/plugins/{{MODULE_NAME}}/<resource-slug>`: `items`, `sample-items`, `uoms`, `suppliers`, `api-keys`.
3. **Match before creating.**
   - If a folder for this resource already exists — in **any** spelling (singular `uom`, plural `uoms`, camelCase, snake_case) — **use that folder**. Place `<existing-slug>.service.ts` there. Do **not** create a parallel sibling folder.
   - If the existing folder's name is non-canonical, keep it and match the file names (`<existing-slug>.service.ts`, etc.). Do not rename mid-PRD.
   - If no folder exists, create one using the canonical plural-kebab slug.
4. **Single-resource plugins may stay flat.** See [plugins/audit-log/src/api/](plugins/audit-log/src/api/) — one resource, files at `src/api/` root. Introduce a subfolder only once the plugin has (or is about to have) a second resource.
5. **This task fixes the slug for downstream tasks.** The API task will place its controller, module, and DTOs in this same folder. The UI task will use the same slug for `src/web/pages/<slug>/`. Pick the slug here and carry it through the PRD.

### Reference layouts

- Multi-resource plugin: [plugins/sample-plugin/src/api/sample-items/](plugins/sample-plugin/src/api/sample-items/) — service, controller, module, and `dto/` all together.
- Single-resource plugin (flat): [plugins/audit-log/src/api/](plugins/audit-log/src/api/).

### Anti-pattern — do NOT produce this

```
src/api/
  uom/
    uom.service.ts         # service here
  uoms/                    # parallel folder for the SAME resource
    dto/
    uoms.controller.ts     # controller here
```

### Correct

```
src/api/
  uoms/
    dto/
    uoms.controller.ts
    uoms.module.ts
    uoms.service.ts
```

## Entities Covered

{{ENTITIES_COVERED}}

## Pattern Selection

Fill in for each entity whether it uses `BaseCrudService` or plain `PrismaService`, and why.

{{PATTERN_SELECTION}}

## CRUD & Query Methods

### If the entity uses `BaseCrudService`

Subclass `BaseCrudService<TEntity, TQuery extends BaseQueryDto>`. Implement:

- `protected readonly config: CrudServiceConfig` — declare `searchFields: string[]`, optional `defaultSortBy`, and optional `includes` / `findAllIncludes` for Prisma relation loading.
- `protected getDelegate(tenantSlug: string): PrismaModelDelegate` — return `this.prisma.getTenantClient(tenantSlug).{modelName}`.
- Optional hooks:
  - `transformResult(entity)` — reshape raw Prisma rows before return (e.g. stringify Date fields).
  - `beforeRemove(tenantSlug, id)` — guard delete (check references, raise `ConflictException` if not removable).
  - `beforeRemoveMany(tenantSlug, ids)` — same for bulk delete.

You get for free:
- `findAll(tenantSlug, query)` — paginated, search-enabled, sortable list
- `findOne(tenantSlug, id)` — single entity with configured includes
- `remove(tenantSlug, id)` — single delete
- `removeMany(tenantSlug, ids)` — bulk delete
- `checkAvailability(tenantSlug, field, value, excludeId?)` — uniqueness probe
- `exportCsv(...)` and `exportData(..., format)` — CSV/JSON/XLSX export via `ExportService`

`create` and `update` are **not** on the base class — implement them in the subclass, as they need entity-specific validation and relation handling.

### If the entity uses plain `PrismaService`

- Inject `PrismaService` in the constructor.
- Add a `private getClient(tenantSlug: string)` helper returning `this.prisma.getTenantClient(tenantSlug)`.
- Every method takes `tenantSlug: string` as an argument — never rely on ambient tenant state inside the service.
- For list queries, return the `PaginatedResponse<T>` shape manually: `Promise.all([findMany(...), count(...)])` → build `{ data, meta }`.

{{CRUD_OPERATIONS}}

### Specialized Query Methods

Methods beyond basic CRUD — reporting, joins, aggregations, non-standard filters. Each method takes `tenantSlug` first, then operation inputs.

{{QUERY_METHODS}}

### Aggregation & Reporting Methods

Use Prisma's `aggregate`, `groupBy`, or `$queryRaw` where necessary. Never hand-write SQL against table names — always go through a tenant Prisma client so the search_path is correct.

{{AGGREGATION_METHODS}}

## Data Access Patterns

List the access patterns the PRD requires, and match each to a method above.

{{ACCESS_PATTERNS}}

## Pagination

Offset-based pagination is the codebase convention: `page` (1-indexed) and `limit`, derived `skip = (page - 1) * limit`. The response envelope is:

```ts
{ data: T[], meta: { total, page, limit, totalPages } }
```

Do not introduce cursor pagination without a documented reason — it complicates the generic `usePaginatedApi` hook consumer on the frontend.

`BaseCrudService.findAll` already produces this shape. Plain services must produce it explicitly.

## Error Handling

The `GlobalExceptionFilter` ([packages/backend/src/filters/global-exception.filter.ts](packages/backend/src/filters/global-exception.filter.ts)) already maps Prisma error codes to HTTP responses (`P2002` → 409, `P2025` → 404, `P2003` → 400 "Related record not found", `P2014` → 400). Rules for service-level error handling:

- **Throw NestJS built-ins** where you have a domain reason: `NotFoundException`, `ConflictException`, `BadRequestException`, `ForbiddenException`.
- **Do not catch-and-rethrow generic Prisma errors** — let them bubble so `GlobalExceptionFilter` maps them consistently.
- **Do catch** when you need to translate a specific code into a domain message (see `remove` in [plugins/sample-plugin/src/api/sample-items/sample-items.service.ts:161-168](plugins/sample-plugin/src/api/sample-items/sample-items.service.ts#L161-L168) for a narrowly-scoped `catch { throw NotFoundException }`).

{{ERROR_HANDLING}}

## Tenant Scoping Rules

- Every query method must take `tenantSlug: string` and route through `this.prisma.getTenantClient(tenantSlug)` — never call methods on `this.prisma.{model}` directly (that binds to the public schema). The only exception is a model the MODEL task declared as platform-wide (see [MODEL.md → Schema Placement Decision](MODEL.md#schema-placement-decision)), which is read through `this.prisma` on purpose.
- `getTenantClient` is pool-backed (LRU, max 50) — calling it repeatedly for the same tenant is cheap. Do not cache the returned client in a field; always re-fetch.
- Audit logging is wired into the client automatically (`create` / `update` / `delete` and their `*Many` forms) — do **not** write to `AuditLog` manually; the Prisma middleware handles it.
- **`upsert` is never audited.** For any write that must be in the audit log (anything a user edits), use `findUnique` then `update` or `create`; on a race, retry the `create` as an `update` (P2002).

## Cross-Fragment References — STRICT

> **The Prisma fragment is the unit of isolation. References from this plugin's models to anything *outside* its own fragment — core tenant models (`User`, `Role`, …) and other plugins' models (`DocumentTemplate`, `IntegrationPartner`, …) — are id-only `String?` columns with no Prisma `@relation`. The data-access layer must NOT use `include: { ... }` for those references; fetch the foreign entity in a separate, explicit call. Same-fragment relations (this plugin's models pointing at each other) are full Prisma relations and `include` is fine.**

The full schema rule lives in [MODEL.md](MODEL.md#cross-fragment-references--strict). For the data-access layer, the consequences are:

### Don't

```ts
// ❌ FORBIDDEN — no `@relation` exists on the plugin model for either of these targets.
const article = await client.{{modelName}}.findUnique({
  where: { id },
  include: {
    createdBy: true,   // ❌ User is in header.prisma — different fragment
    template: true,    // ❌ DocumentTemplate is in another plugin's fragment
  },
});
```

### Do

```ts
const row = await client.{{modelName}}.findUnique({
  where: { id },
  // include is fine here for SAME-FRAGMENT relations only:
  include: { children: true },   // ✓ children lives in this plugin's fragment
});
if (!row) throw new NotFoundException(...);

// Cross-fragment lookups happen explicitly:
const [author, template] = await Promise.all([
  row.createdById
    ? client.user.findUnique({
        where: { id: row.createdById },
        select: { id: true, name: true, username: true, email: true },
      })
    : null,
  row.templateId
    ? client.documentTemplate.findUnique({
        where: { id: row.templateId },
        select: { id: true, name: true, slug: true },
      })
    : null,
]);

return { ...this.toDto(row), author, template };
```

### Rules for the data-access layer

1. **No `include` across fragments.** Cross-fragment `client.user`, `client.role`, `client.documentTemplate`, `client.integrationPartner`, etc. are reachable via the tenant client but only as **separate** `findUnique` / `findMany` queries.
2. **`include` is fine inside the same fragment.** This plugin's own models can be loaded with `include: { children: true, ... }` — full Prisma relation ergonomics apply.
3. **Use `select` to narrow cross-fragment reads.** When pulling a `User` row, restrict the projection (`select: { id, name, username, email }`) — never expose `password`, `refreshTokenHash`, `resetPasswordToken`, or any auth field through a plugin response. Same discipline applies to other plugins' models — pull only the fields you'll actually render or use.
4. **Batch when listing.** For list endpoints that decorate rows with cross-fragment data (author name on every row, template name on every row), do **one** `findMany({ where: { id: { in: [...uniqueIds] } } })` per foreign target after the main list query, not N+1 per-row fetches.
5. **Do not introduce `@relation` across fragments to fix N+1.** Batched `findMany` is the supported answer. If the join cost becomes a real problem, raise the trade-off with the user before editing `header.prisma` or another plugin's fragment.

### Method-shape pattern

A list query that decorates each row with both core data (author) and another-plugin data (template):

```ts
async findAll(tenantSlug: string, params: ListQueryDto) {
  const client = this.getClient(tenantSlug);

  const [rows, total] = await Promise.all([
    client.{{modelName}}.findMany({ /* where/skip/take/orderBy */ }),
    client.{{modelName}}.count({ /* where */ }),
  ]);

  // Two batched fetches — one per cross-fragment target.
  const authorIds   = Array.from(new Set(rows.map(r => r.createdById).filter(Boolean) as string[]));
  const templateIds = Array.from(new Set(rows.map(r => r.templateId).filter(Boolean)  as string[]));

  const [authors, templates] = await Promise.all([
    authorIds.length
      ? client.user.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, name: true, username: true },
        })
      : [],
    templateIds.length
      ? client.documentTemplate.findMany({
          where: { id: { in: templateIds } },
          select: { id: true, name: true, slug: true },
        })
      : [],
  ]);

  const authorById   = new Map(authors.map(u => [u.id, u]));
  const templateById = new Map(templates.map(t => [t.id, t]));

  return {
    data: rows.map(r => ({
      ...this.toDto(r),
      author:   r.createdById ? authorById.get(r.createdById)   ?? null : null,
      template: r.templateId  ? templateById.get(r.templateId)  ?? null : null,
    })),
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}
```

### Checklist

- [ ] No `include: { ... }` references a model that lives in `header.prisma` or in another plugin's fragment.
- [ ] Every cross-fragment read uses an explicit `select` projection that excludes auth/secret fields and pulls only what the response will render.
- [ ] List endpoints that decorate rows with cross-fragment data use one batched `findMany({ where: { id: { in: [...] } } })` per foreign target — no per-row fetches.
- [ ] If `include` is used at all in this layer, both sides of the relation are declared inside this plugin's own fragment.

## Transactions

Multi-step writes that must succeed or fail together use `client.$transaction([...])` (array form for independent writes) or `client.$transaction(async (tx) => {...})` (callback form for logic between writes). The tenant client's `$transaction` stays within the tenant schema — never mix tenants inside one transaction.

## Deliverables

- [ ] Decide `BaseCrudService` vs plain-service pattern per entity and document it above
- [ ] Implement the subclass or service, injecting `PrismaService`
- [ ] Every public method takes `tenantSlug` and routes via `getTenantClient(tenantSlug)`
- [ ] List methods return `PaginatedResponse<T>` with correct `meta`
- [ ] Throw NestJS exceptions for domain errors; let Prisma errors bubble for generic cases
- [ ] Multi-step writes use `$transaction` with correct isolation
- [ ] Export service is registered in its NestJS module (providers/exports)

## Acceptance Criteria

- [ ] All CRUD operations work for valid and invalid inputs; 404s fire on missing records
- [ ] List queries support search via `config.searchFields`, sorting via `sortBy`/`sortOrder`, and pagination
- [ ] Specialized queries behave correctly for edge cases (empty tenant, null relations, large result sets)
- [ ] Database errors surface as the correct HTTP status via `GlobalExceptionFilter`
- [ ] Service is stateless — no per-tenant state held in class fields
- [ ] Transactions commit atomically or fully rollback; no partial writes possible
- [ ] Follows the patterns in [plugins/sample-plugin/src/api/sample-items/sample-items.service.ts](plugins/sample-plugin/src/api/sample-items/sample-items.service.ts) and [packages/backend/src/crud/base-crud.service.ts](packages/backend/src/crud/base-crud.service.ts)
