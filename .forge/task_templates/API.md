# Task: API Endpoints — {{PRD_CODE}}-{{PRD_NAME}}

## Overview

| Field       | Value                             |
| ----------- | --------------------------------- |
| PRD         | {{PRD_CODE}}-{{PRD_NAME}}         |
| Task Type   | NestJS Controller / API Endpoints |
| Depends On  | 03-TASK-SERVICE                   |

## Objective

Implement the HTTP layer for PRD-{{PRD_CODE}}-{{PRD_NAME}} as NestJS controllers inside the owning plugin. Controllers are thin — they authenticate, authorize, validate with Zod, delegate to the service, and shape the response. They **never** contain business logic.

## Codebase Context

- Reference controller (copy this shape): [plugins/sample-plugin/src/api/sample-items/sample-items.controller.ts](plugins/sample-plugin/src/api/sample-items/sample-items.controller.ts)
- Reference module: [plugins/sample-plugin/src/api/sample-items/sample-items.module.ts](plugins/sample-plugin/src/api/sample-items/sample-items.module.ts)
- Reference Zod DTO: [plugins/sample-plugin/src/api/sample-items/dto/create-sample-item.dto.ts](plugins/sample-plugin/src/api/sample-items/dto/create-sample-item.dto.ts)
- `ZodValidationPipe`: [packages/backend/src/pipes/zod-validation.pipe.ts](packages/backend/src/pipes/zod-validation.pipe.ts)
- Guards (`JwtAuthGuard`, `RbacGuard`, `PluginEnabledGuard`) and decorators (`@Roles`, `@Permissions`, `@PluginKey`): re-exported from [@saas/backend](packages/backend/src/index.ts)
- Tenancy middleware (sets `req.tenant`): [packages/backend/src/middleware/tenancy.middleware.ts](packages/backend/src/middleware/tenancy.middleware.ts)
- Global error filter (auto-maps Prisma codes): [packages/backend/src/filters/global-exception.filter.ts](packages/backend/src/filters/global-exception.filter.ts)

## Folder Placement — STRICT

> **Before creating any file, inspect the existing plugin tree and reuse the resource folder if one already exists. Never create two folders for the same resource (e.g. both `src/api/uom/` and `src/api/uoms/`). The artifacts produced by this task — controller, module, DTOs — must all land in the same folder as the service created by the REPOSITORY/SERVICE tasks.**

### Procedure

1. **Scan first.** Before writing anything, list the existing layout:
   ```sh
   ls plugins/{{MODULE_NAME}}/src/api/
   ```
   Note every existing resource subfolder and every flat `*.ts` file at the `src/api/` root.
2. **Resource slug = folder name.** The folder name equals the last route segment `/plugins/{{MODULE_NAME}}/<resource-slug>` and follows **plural kebab-case**: `items`, `sample-items`, `uoms`, `suppliers`, `api-keys`.
3. **Match before creating.**
   - If a folder for this resource already exists — in **any** spelling (singular `uom`, plural `uoms`, camelCase, snake_case) — **use that folder**. Add the controller / module / DTOs alongside the existing files. Do **not** create a parallel sibling folder.
   - If the existing folder name is non-canonical, keep it. File names inside must agree: `<existing-slug>.controller.ts`, `<existing-slug>.module.ts`. Do not rename mid-PRD.
   - If no folder exists, create one using the canonical plural-kebab slug.
4. **Single-resource plugins may stay flat.** See [plugins/audit-log/src/api/](plugins/audit-log/src/api/) — one resource, files at `src/api/` root. Introduce a subfolder only once the plugin has (or is about to have) a second resource.
5. **Same slug as the service.** The service file produced in the REPOSITORY/SERVICE task is the anchor. The controller, module, and DTOs MUST go in the same directory. If the service is at `src/api/uom/uom.service.ts` (non-canonical singular) and the PRD hasn't asked for cleanup, this task emits `src/api/uom/uom.controller.ts`, `src/api/uom/uom.module.ts`, `src/api/uom/dto/*.dto.ts` — never a parallel `uoms/` folder.

### Reference layouts

- Multi-resource plugin: [plugins/sample-plugin/src/api/sample-items/](plugins/sample-plugin/src/api/sample-items/) — full `controller + module + service + dto/` inside one folder.
- Single-resource plugin (flat): [plugins/audit-log/src/api/](plugins/audit-log/src/api/).

### Anti-pattern — do NOT produce this

```
src/api/
  uom/
    uom.service.ts         # service landed here
  uoms/                    # parallel folder for the SAME resource
    dto/
    uoms.controller.ts     # controller landed here
```

### Correct

```
src/api/
  uoms/
    dto/
      create-uom.dto.ts
      update-uom.dto.ts
    uoms.controller.ts
    uoms.module.ts
    uoms.service.ts
```

## Endpoints

For each endpoint, define the full HTTP contract below. Follow the URL pattern `/plugins/{{MODULE_NAME}}/{resource}(/{sub})` so the plugin's routes are cleanly namespaced.

{{ENDPOINTS}}

### Endpoint Detail Template

For each endpoint listed above, provide the following specification.

#### `{{HTTP_METHOD}} /plugins/{{MODULE_NAME}}/{{RESOURCE}}{{SUBPATH}}`

**Description:** {{ENDPOINT_DESCRIPTION}}

**Authentication:** JWT (HttpOnly cookie or `Authorization: Bearer`). Tenant resolved from the `x-tenant-id` header — handled by `TenancyMiddleware`, no manual check needed.

**Required Permissions:** `{{MODULE_NAME}}.{{RESOURCE}}.{{ACTION}}` (applied via `@Permissions(...)` — document it here and in the decorator).

**Request:**
- Path params: {{PATH_PARAMS}}
- Query params: {{QUERY_PARAMS}}
- Body (Zod schema name + fields): {{REQUEST_BODY}}

**Success Response:**
- Status: {{SUCCESS_STATUS}}
- Body: {{RESPONSE_BODY}}

**Error Responses:**

| Status | Condition                     | Emitter                          |
| ------ | ----------------------------- | -------------------------------- |
| 400    | Validation failure            | `ZodValidationPipe` (auto)       |
| 401    | Missing/invalid JWT           | `JwtAuthGuard` (auto)            |
| 403    | Missing permission / role     | `RbacGuard` (auto)               |
| 403    | Plugin off, unavailable, or unpaid for the tenant | `PluginEnabledGuard` (auto) |
| 404    | Unknown plugin key (`@PluginKey` typo) | `PluginEnabledGuard` (auto) |
| 403    | Tenant SUSPENDED / TERMINATED | `TenancyMiddleware` (auto)       |
| 404    | Record not found              | Service → `NotFoundException`    |
| 409    | Conflict (unique/relation)    | Service or Prisma (`P2002`)      |
| 500    | Unhandled                     | `GlobalExceptionFilter` (auto)   |
{{ERROR_RESPONSES}}

---

## Controller Structure

Every controller in this codebase follows this shape:

```ts
@ApiTags('{{MODULE_NAME}} - {{RESOURCE}}')
@ApiBearerAuth()
@Controller('plugins/{{MODULE_NAME}}/{{RESOURCE}}')
@PluginKey('{{MODULE_NAME}}')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@Roles('ADMIN')   // or whatever roles gate the whole controller
export class XController {
  constructor(private readonly service: XService) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Get()
  @Permissions('{{MODULE_NAME}}.{{RESOURCE}}.read')
  @ApiOperation({ summary: '...' })
  findAll(@Req() req: AuthenticatedRequest, @Query() query: XQueryDto) {
    return this.service.findAll(this.getTenantSlug(req), query);
  }

  @Post()
  @Permissions('{{MODULE_NAME}}.{{RESOURCE}}.write')
  @ApiOperation({ summary: '...' })
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createXSchema)) dto: CreateXDto,
  ) {
    return this.service.create(dto, this.getTenantSlug(req));
  }
}
```

### Critical Conventions

- **Guard order matters**: `JwtAuthGuard` must come first (it populates `req.user`), then `PluginEnabledGuard` (needs `req.tenant`), then `RbacGuard` (needs both).
- **`@PluginKey('{{MODULE_NAME}}')`**: required on every plugin controller — `PluginEnabledGuard` reads it and answers **403** when the plugin is switched off system-wide or for the tenant, or is a paid plugin without a live subscription, and **404** only when the key matches no plugin.
- **`@Permissions(...)` per method**: even if `@Roles(...)` is applied at the class level, list the precise permission on each method. Roles and permissions are **OR'd** by default: with `@Roles('ADMIN')` on the class, an ADMIN passes every method and any other role passes when it holds that method's permission. Add `@RbacMode('AND')` to require both. SYSADMIN always passes.
- **Zod validation is per-parameter**: apply the pipe on the specific `@Body()` or `@Query()` decorator — `@Body(new ZodValidationPipe(schema))`. **Never** use `@UsePipes(...)` at the method level, because it applies to `@Param()` too and will reject path params that aren't declared in your body schema.
- **`req.tenant.slug`**: always accessed through the `getTenantSlug(req)` helper that throws if missing — the middleware should prevent this but the helper is a defense-in-depth.
- **No manual auth checks**: trust the guards. Do not query users/permissions inside controller methods.
- **No manual audit calls**: Prisma middleware writes the audit log automatically.

## Zod DTOs

Create one file per DTO under `dto/`. The exported symbols are the schema and the inferred type:

```ts
import { z } from 'zod';

export const createXSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  // ...
});

export type CreateXDto = z.infer<typeof createXSchema>;
```

Always import the **schema** into the controller for the pipe and the **type** for the parameter annotation. This codebase is Zod v4 in the API.

## Pagination, Search, Sort

Use the `BaseQueryDto` shape (`page`, `limit`, `search`, `sortBy`, `sortOrder`) for any list endpoint. For services that extend `BaseCrudService`, the query DTO extends `BaseQueryDto` and flows through automatically. See the `SampleItemQueryDto` pattern in [plugins/sample-plugin/src/api/sample-items/dto/sample-item-query.dto.ts](plugins/sample-plugin/src/api/sample-items/dto/sample-item-query.dto.ts).

Response envelope for list endpoints:

```ts
{ data: T[], meta: { total, page, limit, totalPages } }
```

## Swagger Documentation

- `@ApiTags('{{MODULE_NAME}} - {{RESOURCE}}')` at the controller for grouping.
- `@ApiBearerAuth()` at the controller so the Swagger UI sends the cookie/JWT.
- `@ApiOperation({ summary: '...' })` on every method — one-line human description.
- `@ApiResponse({ status: 200, description: '...' })` for the success case; the global filter handles errors so don't over-declare them.
- `x-tenant-id` is documented globally in [apps/api/src/main.ts](apps/api/src/main.ts) — do not redeclare per-endpoint.

## Rate Limiting

`ThrottlerGuard` is installed globally in [apps/api/src/app.module.ts](apps/api/src/app.module.ts). Per-endpoint overrides use `@Throttle({ default: { limit, ttl } })`. Apply only to endpoints that need stricter limits than the global default (auth endpoints, password reset, expensive reports, imports, exports).

{{RATE_LIMITING}}

## Cross-Fragment References — STRICT

> **This plugin's models reference anything *outside* its own fragment — core tenant models (`User`, `Role`, `Tenant`, …) AND other plugins' models (`DocumentTemplate`, `IntegrationPartner`, …) — by id-only `String?` columns, never via Prisma `@relation`. The schema rule is in [MODEL.md](MODEL.md#cross-fragment-references--strict); the service mechanics are in [SERVICE.md](SERVICE.md#cross-fragment-references--strict). For the HTTP layer, the consequences are about Zod DTOs and how the controller passes the authenticated user id through.**

### Rules for Zod DTOs

1. **Never accept actor-identity FKs from the client.** Fields like `createdById`, `authorId`, `ownerId`, `originalAuthorId` — when they identify *the calling user* — are stamped server-side from `req.user.userId`. They must NOT appear in `createXSchema` or `updateXSchema`. Accepting them would let any authenticated user impersonate another as the author — a real privilege-escalation bug.
2. **User-supplied target FKs are allowed**, regardless of which fragment the target lives in. Always typed as `z.string().uuid()` (or `.cuid()` to match your id format), never a free-form string. Examples:
   - **Core targets:** `assignedToId` (User), `roleId` (Role), `recipientId` (User).
   - **Other-plugin targets:** `templateId` (DocumentTemplate), `partnerId` (IntegrationPartner), `articleId` (SampleArticle from another plugin).
   Service-side validation that the target exists in the tenant is required for ALL cross-fragment targets — see [SERVICE.md](SERVICE.md#cross-fragment-references--strict).
3. **Identity FKs are absent from update DTOs.** A user editing an article cannot rewrite `createdById`. The update schema simply omits the field — no need for special masking.

### Rules for the controller

When the service needs the authenticated user id, the controller plucks it from `req.user.userId` and passes it as an explicit argument:

```ts
@Post()
@Permissions('{{MODULE_NAME}}.{{RESOURCE}}.write')
@ApiOperation({ summary: 'Create a new {{RESOURCE}}' })
create(
  @Req() req: AuthenticatedRequest,
  @Body(new ZodValidationPipe(createXSchema)) dto: CreateXDto,
) {
  return this.service.create(dto, req.user.userId, this.getTenantSlug(req));
}
```

`req.user` is populated by `JwtAuthGuard` — already the first guard on every plugin controller.

### Rules for response shapes

When you decorate response rows with cross-fragment data (author name, template name, partner name), the service does the join via a batched `findMany`/`findUnique` (per [REPOSITORY.md](REPOSITORY.md#cross-fragment-references--strict)). The DTO you document via Swagger should only list **non-secret, narrowly-projected** fields:

```ts
{
  id: string,
  // ... domain fields ...
  createdById: string | null,
  templateId:  string | null,
  // Decorated fields from cross-fragment lookups — narrow projections only
  author:   { id: string, name: string | null, username: string } | null,           // from core User
  template: { id: string, name: string, slug: string } | null,                       // from another plugin
  // Never expose: password, refreshTokenHash, resetPasswordToken, internal fields of foreign-plugin models, …
}
```

If a Swagger response example would include a full `User` object, the entire `DocumentTemplate` body, or the secret fields of any other plugin's model, that's a smell — the join projection in the service is too wide. Narrow the `select` in the data-access layer, then reflect the narrower shape here.

### Foreign-plugin disabled

If this plugin's API depends on a target plugin that may be disabled at runtime, the response decoration may legitimately yield `null` for the foreign field. Document this in the Swagger response (`template: { ... } | null`) and ensure the UI handles it (see frontend tasks). Do not 500 when a foreign plugin is missing — that's a tenant-state concern, not an error.

### Forbidden DTO patterns

```ts
// ❌ DO NOT accept the actor id from the client
export const createXSchema = z.object({
  title: z.string(),
  createdById: z.string().uuid(),   // ← privilege escalation risk
});

// ❌ DO NOT accept identity FKs on update
export const updateXSchema = z.object({
  title: z.string().optional(),
  createdById: z.string().uuid().optional(),  // ← lets a user rewrite history
});

// ❌ DO NOT use loose typing for cross-fragment target ids
export const createXSchema = z.object({
  templateId: z.string(),   // ← should be z.string().uuid() (or .cuid())
});
```

### Checklist

- [ ] No `createXSchema` / `updateXSchema` field accepts `createdById`, `authorId`, `ownerId`, or any actor-identity FK.
- [ ] User-supplied target FKs (whether the target lives in core or another plugin) are typed as `z.string().uuid()` (or matching id format).
- [ ] The controller's `create` (and any other write that records the actor) passes `req.user.userId` to the service as an explicit argument.
- [ ] Swagger response examples include only narrow, non-secret projections from cross-fragment models — no full `User`, `DocumentTemplate`, etc. shapes leak through.
- [ ] Decorated response fields whose target may be missing (deleted user, disabled foreign plugin) are documented as `| null` in the Swagger schema.

## Module Wiring

Controllers live inside a NestJS module declared per feature (see [plugins/sample-plugin/src/api/sample-items/sample-items.module.ts](plugins/sample-plugin/src/api/sample-items/sample-items.module.ts)):

- `imports: [PrismaModule]` (and others you inject)
- `controllers: [XController]`
- `providers: [XService]`
- `exports: [XService]` (only if consumed elsewhere)

Then export the module from `plugins/{{MODULE_NAME}}/src/api/index.ts`. The registry generator (`pnpm plugins:register`) wires it into [apps/api/src/plugin-registry.ts](apps/api/src/plugin-registry.ts).

## Deliverables

- [ ] Zod DTOs for every request body / query under `dto/*.dto.ts`
- [ ] Controller with `@Controller('plugins/{{MODULE_NAME}}/{{RESOURCE}}')`, `@PluginKey('{{MODULE_NAME}}')`, `@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)`
- [ ] `@Permissions(...)` on every endpoint method
- [ ] `@Body(new ZodValidationPipe(schema))` — never method-level `@UsePipes`
- [ ] Tenant slug accessed via `getTenantSlug(req)` helper
- [ ] Service called with correct argument order (service decides; controller only passes `tenantSlug`)
- [ ] Swagger annotations: `@ApiTags`, `@ApiBearerAuth`, `@ApiOperation`, `@ApiResponse` on success paths
- [ ] NestJS module declared and exported from `plugins/{{MODULE_NAME}}/src/api/index.ts`
- [ ] `pnpm plugins:register` run — controller appears in `plugin-registry.ts` `PluginModules`
- [ ] Swagger UI (at `SWAGGER_PATH`, default `/` → `http://localhost:3001/`) lists the new endpoints under the correct tag

## Acceptance Criteria

- [ ] Every endpoint is reachable at the documented path and HTTP method
- [ ] Validation errors return 400 with the standard `{ message, errors: { field: string[] } }` envelope
- [ ] Missing/expired JWT returns 401 (handled by `JwtAuthGuard`)
- [ ] Missing required permission returns 403 (handled by `RbacGuard`)
- [ ] Plugin disabled (or unpaid) on the tenant returns 403 (handled by `PluginEnabledGuard`)
- [ ] Suspended/terminated tenant returns 403 with the reason code from `TenancyMiddleware`
- [ ] List endpoints return the `{ data, meta }` envelope with correct pagination math
- [ ] Swagger OpenAPI documents the endpoint and the `x-tenant-id` header is listed as required
- [ ] No business logic in the controller — method bodies are one-liners delegating to the service
- [ ] Follows the shape of [plugins/sample-plugin/src/api/sample-items/sample-items.controller.ts](plugins/sample-plugin/src/api/sample-items/sample-items.controller.ts)
