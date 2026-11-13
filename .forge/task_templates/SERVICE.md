# Task: Service / Business Logic

## Overview

| Field       | Value                                  |
| ----------- | -------------------------------------- |
| PRD         | {{PRD_CODE}}-{{PRD_NAME}}              |
| Task Type   | NestJS Service / Business Logic        |
| Depends On  | 02-TASK-REPOSITORY                     |

## Objective

Implement the business-logic layer for PRD-{{PRD_CODE}}-{{PRD_NAME}} as a NestJS service in the appropriate plugin module. This layer sits between the controller (HTTP concerns) and the data-access layer (Prisma / `BaseCrudService`). It enforces domain rules, validates inputs beyond shape, orchestrates multi-entity operations, and emits side-effects (realtime events, background jobs, external integrations).

In this codebase **authorization is enforced upstream at the guard layer** (`JwtAuthGuard` + `RbacGuard` on the controller). Service code trusts upstream — do not re-check permissions unless there is a truly contextual check (e.g. resource ownership) that the guard cannot express.

## Codebase Context

- Reference service: [plugins/sample-plugin/src/api/sample-items/sample-items.service.ts](plugins/sample-plugin/src/api/sample-items/sample-items.service.ts)
- `PrismaService`: [packages/backend/src/prisma/prisma.service.ts](packages/backend/src/prisma/prisma.service.ts)
- `BaseCrudService` (extend for CRUD-shaped services): [packages/backend/src/crud/base-crud.service.ts](packages/backend/src/crud/base-crud.service.ts)
- Realtime: `WebSocketBridgeService` from `@saas/backend` ([packages/backend/src/websocket/](packages/backend/src/websocket/)) — `broadcastToTenant` / `broadcastToUser`
- Platform services (email, calendar, meetings, events, settings): see [Platform Services](#platform-services--use-these-dont-rebuild-them) below and [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md) § 9 and § 12
- `AuthenticatedRequest` type: imported from `@saas/backend` — the `req.tenant.slug` is resolved by `TenancyMiddleware`

## Folder Placement — STRICT

> **Before creating the service file, inspect the existing plugin tree and reuse the resource folder if one already exists. Never create two folders for the same resource (e.g. both `src/api/uom/` and `src/api/uoms/`). The service, its sibling module, its controller, and its DTOs must all live in the same folder.**

### Procedure

1. **Scan first.** Before writing anything:
   ```sh
   ls plugins/{{MODULE_NAME}}/src/api/
   ```
   Note every existing resource subfolder and any flat files at `src/api/` root.
2. **Resource slug = folder name.** The folder name follows **plural kebab-case** and equals the route segment `/plugins/{{MODULE_NAME}}/<resource-slug>`: `items`, `sample-items`, `uoms`, `suppliers`.
3. **Match before creating.**
   - If a folder already exists for this resource — in **any** spelling (singular `uom`, plural `uoms`, camelCase, snake_case) — **use that folder**. Add `<existing-slug>.service.ts` next to the existing files. Do **not** create a parallel sibling folder.
   - If no folder exists, create one using the canonical plural-kebab slug.
4. **Single-resource plugins may stay flat.** See [plugins/audit-log/src/api/](plugins/audit-log/src/api/) — one resource, files at `src/api/` root. Introduce a subfolder only once the plugin has (or is about to have) a second resource.
5. **Agree with the controller.** Whichever slug is chosen here is the slug the API task will use for the controller, module, and DTOs. Pick once in this task and commit — downstream tasks inherit it.

### Reference layouts

- Multi-resource plugin: [plugins/sample-plugin/src/api/sample-items/sample-items.service.ts](plugins/sample-plugin/src/api/sample-items/sample-items.service.ts) (inside the `sample-items/` folder alongside its controller and module).
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

## Business Operations

List each business operation the service must support. Each one corresponds to one public method. Input types must be Zod-validated DTOs from the sibling `dto/` directory — never loose `any` shapes.

{{BUSINESS_OPERATIONS}}

### Method Shape

Every method takes `tenantSlug` as a parameter — the controller extracts it from `req.tenant.slug` and passes it in. The service is stateless with respect to the tenant. Reference signature pattern:

```ts
async create(dto: CreateXDto, tenantSlug: string): Promise<X> { ... }
async update(id: string, dto: UpdateXDto, tenantSlug: string): Promise<X> { ... }
async findOne(id: string, tenantSlug: string): Promise<X> { ... }
```

## Business Rules & Domain Logic

Document each invariant the service must enforce beyond Prisma's schema-level constraints. These are the rules that the database can't check:

- Cross-entity validation (foreign-record state checks)
- Workflow-state transitions (only certain state changes allowed)
- Computed field derivations
- Limits the PRD defines (e.g. "max 10 active projects"). Core has no per-tenant record quotas or plan tiers; keep such limits in the plugin's settings (`src/config.schema.ts`)

{{BUSINESS_RULES}}

## Input Validation

Shape validation is handled by the `ZodValidationPipe` applied at the controller (see [API.md](API.md)). The service receives type-safe DTOs. Still, the service must validate **business-level constraints** that Zod cannot express:

- Referenced IDs exist within the same tenant
- Requested state transitions are legal from the current state
- Uniqueness checks that span relations (use `BaseCrudService.checkAvailability` if the constraint is a single field)
- Limits from the plugin's settings (paid access itself is enforced by `PluginEnabledGuard`, not here)

{{INPUT_VALIDATION}}

## Authorization Inside the Service

Default: **trust the guard**. Only add service-level checks for:

- **Resource ownership** — "user can only edit their own records" — the guard has the role, the service has the record.
- **Conditional permission** — "only if the record is in state X" — state-driven gating.

When service-level auth is needed, throw `ForbiddenException` with a precise reason code. Do not silently return empty results.

{{AUTHORIZATION}}

## Error Scenarios

Every failure path must map to a specific NestJS exception so `GlobalExceptionFilter` returns the right HTTP status. Use the table below to document each case.

| Scenario                             | Exception Class         | HTTP | Message / Behavior                      |
| ------------------------------------ | ----------------------- | ---- | --------------------------------------- |
| Record not found                     | `NotFoundException`     | 404  |                                         |
| Duplicate unique constraint          | `ConflictException`     | 409  |                                         |
| Business rule violated               | `BadRequestException`   | 400  |                                         |
| Resource owned by another user       | `ForbiddenException`    | 403  |                                         |
| Limit from plugin settings exceeded  | `ForbiddenException`    | 403  |                                         |
{{ERROR_SCENARIOS}}

Do not throw raw `Error`. Do not swallow Prisma errors — let them bubble and the global filter handles `P2002` / `P2025` / `P2003`. Only wrap a Prisma error when the generic message would be misleading to the caller.

## Side Effects & Integrations

Enumerate every side-effect triggered by an operation. Side-effects must be **conditional on the primary write succeeding** — never fire before the transaction commits.

### Audit Logging

Audit entries are written **automatically** by the Prisma middleware in [packages/backend/src/prisma/prisma.service.ts](packages/backend/src/prisma/prisma.service.ts) for every `create` / `update` / `delete` (and `*Many`), on tenant and public clients alike. **`upsert` is never audited**: for a write that must be in the audit log, use `findUnique` then `update` or `create`. Do **not** insert into `AuditLog` manually — doing so double-logs and corrupts the hash chain. If you need a custom audit entry for a non-Prisma domain event (e.g. "user invited"), use `AuditService.log(...)` from `@saas/backend`.

### Realtime Events

Broadcast to open browsers after a successful write, only when the PRD needs live updates. Inject `WebSocketBridgeService` from `@saas/backend`:

```ts
this.realtime.broadcastToTenant(tenantSlug, '{{MODULE_NAME}}.x.created', { id: item.id });
this.realtime.broadcastToUser(tenantSlug, userId, '{{MODULE_NAME}}.export.ready', { id });
```

**Everyone signed in to the tenant (or that user) receives it, whatever their permissions**, so send ids and let the page refetch through the API, which checks RBAC. In-process events are never forwarded to browsers: only explicit broadcasts go out. Frontend consumers use `useRealtimeUpdates('{{MODULE_NAME}}.x.created', handler)`.

### Background Jobs

Plugins don't run BullMQ queues of their own. The queues (`email`, `webhook`, `export`, `import`, `calendar`) and their producers belong to core (`apps/api`), which a plugin can't import. For work that mustn't hold up the request:

- use a platform service below — email and calendar sync are queued and retried for you;
- or emit your domain event and do the work in an `@OnPluginEvent` listener, which runs after the request (the integration plugin delivers webhooks this way).

If the PRD needs a durable, retried job type none of these cover, **stop and escalate**: it needs a core queue.

### External API Calls

Never call an external API inside the request handler's path: do it in an event listener, or through a platform service when one exists (Google Calendar and Meet do). Credentials come from env vars, never hardcoded. A plugin can't add to core's env validation, so read them through `ConfigService` / `process.env`, treat a missing value as "not configured" (no crash), and list every new variable in the handoff for `.env.example`.

## Platform Services — Use These, Don't Rebuild Them

Core gives plugins these through `@saas/backend`. A plugin never imports `apps/api`, never opens its own SMTP, Google or Redis connection, and never writes the tables behind these features. Full contracts: [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md) § 9 (Email, Google Calendar, Google Meet, Plugin manifest and settings) and § 12 (Events and realtime).

| Need | Use | Notes |
| ---- | --- | ----- |
| Send an email | Declare it in `src/emails.ts` with `defineEmail({ key: '{{MODULE_NAME}}.<kebab-name>', scope: 'tenant', variables, sample, required, sensitive, defaults: { en, id } })` and add `"./emails"` to `package.json` `exports`; send with `@Inject(EMAIL_SERVICE) email: IEmailService` → `email.send({ template, tenantSlug, to, data })` | Queued, logged, retried; tenants can reword it in Templates → Emails. Run `pnpm plugins:register` after adding the file. Never use nodemailer directly. |
| Put an item on a user's calendar | `@Optional() @Inject(CALENDAR_SYNC) calendar?: ICalendarSync` → `calendar.upsert({ tenantSlug, userId, source: '{{MODULE_NAME}}', key, title, start, url, meetingUrl? })` / `calendar.remove(ref)` | Returns a status at once and never fails your write; wrap in try/catch anyway. A Meet link goes in `meetingUrl`, not `location`. |
| A video meeting for an item | `@Optional() @Inject(MEETINGS) meetings?: IMeetingService` → `meetings.create({ tenantSlug, source: '{{MODULE_NAME}}', key, hostUserId })`, `get(ref)`, `cancel(ref)` | Returns a status (`created` / `existing`, or `not-connected` / `needs-permission` / `disabled` / `not-configured` / `unavailable` / `failed`): show it, don't throw. |
| Tell other code something happened | `PluginEventService.emit('{{MODULE_NAME}}.<entity>.<past-tense-verb>', { tenantSlug, …, timestamp: new Date() })`, names declared in `src/events.ts` | Fire after the write commits. |
| React to core's or another plugin's event | `@OnPluginEvent(event, '{{MODULE_NAME}}')` on a method; the class injects `prisma: PrismaService` and `cache: CacheService` as properties | Runs only while this plugin is enabled for the payload's tenant. Event names: [packages/backend/src/events/system-events.ts](packages/backend/src/events/system-events.ts). |
| Live updates in open browsers | `WebSocketBridgeService` (see Realtime Events above) | Ids only. |
| Settings tenant admins can change | `src/config.schema.ts` (Zod, every field with `.default(…)`); admins save via `PUT /tenant-plugins/{{MODULE_NAME}}/config`, which merges with the stored settings | Read from the tenant's `Plugin` row (`config`). |
| Paid access | Nothing in code: `PluginEnabledGuard` blocks a plugin the tenant hasn't paid for; the sysadmin sets the price | |

{{SIDE_EFFECTS}}

## Transactions

Multi-step writes that must be atomic use the tenant client's `$transaction`:

```ts
const client = this.prisma.getTenantClient(tenantSlug);
return client.$transaction(async (tx) => {
  const parent = await tx.parent.create({ data: ... });
  await tx.child.createMany({ data: ... });
  return parent;
});
```

Rules:
- Never mix two tenants in one transaction.
- Keep transactions short — no external calls, no queue enqueues inside the transaction body (enqueue **after** the transaction returns).
- Idempotent writes outside the transaction don't need wrapping.

{{TRANSACTIONS}}

## Cross-Fragment References — STRICT

> **When this service writes or reads a foreign key into anything *outside* its own plugin's fragment — core tenant models (`User`, `Role`, `Tenant`, `Notification`, `WorkflowProcess`, …) OR another plugin's models (`DocumentTemplate`, `IntegrationPartner`, `SampleArticle` from another plugin, …) — the value lives as a plain `String?` column on this plugin's model with no Prisma `@relation`. Same-fragment FKs (this plugin's own models pointing at each other) use full Prisma relations and don't need any of the precautions below. The schema rule is in [MODEL.md](MODEL.md#cross-fragment-references--strict); the data-access mechanics are in [REPOSITORY.md](REPOSITORY.md#cross-fragment-references--strict). For this layer, the rules are about how the service *uses* those id columns.**

### Stamping the FK on writes (server-side, never client-supplied)

When the FK identifies the actor performing the operation (`createdById`, `ownerId`, `assignedToId` referring to the calling user), the service stamps it from the authenticated user passed by the controller — never from the request body. Public DTOs must not include such fields, and the service signature carries the user id explicitly:

```ts
async create(dto: CreateXDto, userId: string, tenantSlug: string): Promise<X> {
  const client = this.getClient(tenantSlug);
  return client.x.create({ data: { ...dto, createdById: userId } });
}
```

For a user-supplied target FK — whether the target lives in core (`assignedToId` → `User`) or in another plugin (`templateId` → `DocumentTemplate`) — validate that the referenced row exists in this tenant before writing. Prisma cannot enforce referential integrity for you because no `@relation` is declared across fragment boundaries:

```ts
async assign(id: string, assigneeUserId: string, tenantSlug: string) {
  const client = this.getClient(tenantSlug);
  // Cross-fragment validation: target lives in core (header.prisma)
  const exists = await client.user.findUnique({
    where: { id: assigneeUserId },
    select: { id: true },
  });
  if (!exists) throw new BadRequestException('Assignee not found in this tenant');
  return client.x.update({ where: { id }, data: { assignedToId: assigneeUserId } });
}

async applyTemplate(id: string, templateId: string, tenantSlug: string) {
  const client = this.getClient(tenantSlug);
  // Cross-fragment validation: target lives in another plugin
  const exists = await client.documentTemplate.findUnique({
    where: { id: templateId },
    select: { id: true },
  });
  if (!exists) throw new BadRequestException('Template not found in this tenant');
  return client.x.update({ where: { id }, data: { templateId } });
}
```

If the target lives in another plugin that may be disabled at runtime, also handle the **plugin-disabled** case — see "Cleanup" below.

### Reading and enriching responses

Use the batched-fetch pattern from [REPOSITORY.md](REPOSITORY.md#cross-fragment-references--strict) — one `findMany({ where: { id: { in: [...] } } })` per cross-fragment target in a list response, not N+1 `findUnique` calls. **Never** use `include: { ... }` for cross-fragment references — it doesn't compile because no relation exists, and even if it did, plugins must not depend on relations across fragment boundaries.

### Immutability of identity FKs

Audit-style FKs (`createdById`, `originalAuthorId`) are written on **create** and never touched again. The update DTO and service path must omit them. If your business logic genuinely needs to transfer ownership (e.g. `transferTo(newOwnerId)`), expose it as a separate explicit operation — do not let it ride along on a generic `update()`.

### Cleanup when the referenced row is deleted

Because there is no `@relation`, Prisma cannot apply `onDelete: SetNull` automatically. The strategy depends on where the referenced row lives:

1. **Cross-fragment to core (e.g. `createdById` → `User`)** — usually tolerate orphans. When the user asks "who created this?", a missing user lookup yields `null` / "Deleted user". The list / detail patterns in [REPOSITORY.md](REPOSITORY.md#cross-fragment-references--strict) already handle this gracefully.
2. **Cross-fragment to another plugin (e.g. `templateId` → `DocumentTemplate`)** — additionally handle the case where the target plugin is **disabled** on this tenant (there is no uninstall: its rows stay, but its API is closed). Two options:
   - **Tolerate orphans + degrade gracefully.** The list/detail enrichment lookup just returns `null` for the foreign field; UI shows "Unknown template" or hides the dependent feature. Recommended default.
   - **Sweep on the foreign event.** Listen with `@OnPluginEvent('<foreign-plugin>.<entity>.deleted', '{{MODULE_NAME}}')` (only if that plugin emits such an event) and run `updateMany({ where: { templateId: deletedTemplateId }, data: { templateId: null } })`. Core emits `SystemEvents.PLUGIN_DISABLED_TENANT` when a plugin is switched off for a tenant. Use only when orphans would corrupt domain meaning.
3. **Same-fragment FKs** — declare `onDelete` directly in the Prisma `@relation` and let Prisma enforce it.

Pick one strategy per cross-fragment FK and document it in the spec; do not silently rely on Prisma cascades that aren't actually configured.

### Checklist

- [ ] No DTO field accepts `createdById` (or any actor-identifying FK) from the client.
- [ ] Service signature carries the user id explicitly when one is needed (`create(dto, userId, tenantSlug)`).
- [ ] User-supplied target FKs are validated against the tenant via an explicit `findUnique({ select: { id: true } })` before every write — applies to BOTH core targets (assignee user) and other-plugin targets (template, partner, …).
- [ ] Identity FKs are absent from the update path entirely (set once on create, immutable thereafter — or exposed as a deliberate transfer operation).
- [ ] No `include: { ... }` on cross-fragment fields anywhere in this service.
- [ ] List enrichment uses a single batched `findMany` per cross-fragment target, not per-row `findUnique`.
- [ ] Each cross-fragment FK has a documented cleanup/orphan strategy (tolerate vs sweep).

## Module Registration

The service must be declared in the plugin's NestJS module (see [plugins/sample-plugin/src/api/sample-items/sample-items.module.ts](plugins/sample-plugin/src/api/sample-items/sample-items.module.ts)):

- `imports: [PrismaModule, ...]`
- `providers: [MyService, ...]`
- `exports: [MyService]` (only if another plugin/module consumes it directly)

The module must also appear in `plugins/{{MODULE_NAME}}/src/api/index.ts` so the registry picks it up.

## Deliverables

- [ ] Create the service in the correct plugin API sub-directory
- [ ] Inject `PrismaService` (and the platform services the PRD needs: `EMAIL_SERVICE`, `CALENDAR_SYNC`, `MEETINGS`, `PluginEventService`, `WebSocketBridgeService`, `AuditService`)
- [ ] Emails the PRD sends are declared in `src/emails.ts` (en + id) and exported as `./emails`; no direct SMTP
- [ ] Every public method takes `tenantSlug` and uses `this.prisma.getTenantClient(tenantSlug)`
- [ ] Business rules enforced with explicit NestJS exceptions
- [ ] Multi-step writes wrapped in `$transaction` with queue enqueues deferred until after commit
- [ ] Realtime events emitted on successful writes where the PRD requires them
- [ ] Register the service in the plugin's NestJS module (`providers`, optional `exports`)

## Acceptance Criteria

- [ ] Every PRD operation has a matching service method that handles valid inputs and raises the correct NestJS exception on each documented error path
- [ ] Unauthorized access (where the service re-checks) throws `ForbiddenException` before any write
- [ ] Every error scenario returns the correct HTTP status via the global filter
- [ ] Side effects fire **only** after the primary write succeeds; never on rollback
- [ ] Transactions commit atomically — partial-state writes are impossible
- [ ] No manual audit-log writes (Prisma middleware handles it) — except deliberate non-Prisma domain events
- [ ] Follows the conventions of [plugins/sample-plugin/src/api/sample-items/sample-items.service.ts](plugins/sample-plugin/src/api/sample-items/sample-items.service.ts)
