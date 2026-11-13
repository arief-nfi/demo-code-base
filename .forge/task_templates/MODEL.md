# Task: Data Model

## Overview

| Field      | Value                          |
| ---------- | ------------------------------ |
| PRD        | {{PRD_CODE}}-{{PRD_NAME}}      |
| Task Type  | Prisma Data Model              |
| Depends On | Plugin setup task (NEW-MODULE) |

## Objective

Define and implement the Prisma model(s) required by PRD-{{PRD_CODE}}-{{PRD_NAME}}, following the schema-per-tenant conventions of this codebase. The ORM is **Prisma** and schema fragments live inside each plugin, then merged into [packages/database/prisma/schema.prisma](packages/database/prisma/schema.prisma) by the build tooling.

## Scope — STRICT

> **Do NOT run `pnpm db:migrate:dev` or `pnpm db:migrate:tenants` in this task.** The user executes both commands manually after reviewing the proposed schema.
>
> Reason: migration SQL is reviewed by the user before it touches any DB; `migrate:dev` writes a migration folder under [packages/database/prisma/migrations/](packages/database/prisma/migrations/) and `migrate:tenants` applies it to every tenant schema except TERMINATED ones — both are stateful side effects that must not be triggered automatically.

### Allowed commands (non-stateful — safe to run)

- `pnpm plugins:merge-prisma` — merges fragments into `schema.prisma`; pure file rewrite.
- `pnpm plugins:merge-prisma:check` — dry-run / validator form.
- `pnpm db:generate` — regenerates the Prisma client from the merged schema; no DB writes.

### Forbidden commands in this task (user runs manually)

- `pnpm db:migrate:dev` — creates migration SQL and applies it to the dev DB. **User only.**
- `pnpm db:migrate:deploy` — applies pending migrations to the target DB. **User only.**
- `pnpm db:migrate:tenants` — applies migrations to every tenant schema except TERMINATED ones. **User only.**
- Any ad-hoc `prisma migrate …` / `prisma db push …` invocation.

If the schema changes require a migration to be visible, say so in the handoff — do not run it.

## Codebase Context

- Central Prisma schema (merged output — read-only): [packages/database/prisma/schema.prisma](packages/database/prisma/schema.prisma)
- Core models (read-only for plugin tasks — core tenant models like `User` and platform models like `Tenant`, `Invoice`): [packages/database/prisma/header.prisma](packages/database/prisma/header.prisma)
- Tenant client model whitelist (a new tenant-owned model must be added here): [packages/backend/src/prisma/tenant-prisma-client.ts](packages/backend/src/prisma/tenant-prisma-client.ts) `TenantModelKeys`
- Merge tool: [scripts/merge-prisma-schemas.js](scripts/merge-prisma-schemas.js)
- Reference plugin fragment: [plugins/sample-plugin/src/database/prisma/fragment.prisma](plugins/sample-plugin/src/database/prisma/fragment.prisma)
- Reference tenant-schema client usage: [plugins/sample-plugin/src/api/sample-items/sample-items.service.ts](plugins/sample-plugin/src/api/sample-items/sample-items.service.ts) (see `this.prisma.getTenantClient(tenantSlug)`)

## Resource Slug — STRICT

> **This task declares the canonical `resource-slug` (plural kebab-case) for every entity it introduces. Downstream tasks (REPOSITORY, SERVICE, API, UI) inherit the slug verbatim for folder names, route segments, and file names. Never let two tasks derive different slugs for the same entity (e.g. `uom/` for the service and `uoms/` for the controller).**

### Procedure

1. **Scan the existing plugin tree before naming.** Run these before you commit to a Prisma model name:
   ```sh
   ls plugins/{{MODULE_NAME}}/src/api/
   ls plugins/{{MODULE_NAME}}/src/web/pages/
   ```
   If a folder already covers the concept this PRD is about — in any spelling — note its name. Do not introduce a Prisma model whose derived slug would create a parallel sibling (e.g. do not define `Uom` as the model when `src/api/suppliers/` already exists for the same entity; ask the user).
2. **Derive the canonical slug for each new model.** PascalCase model → plural kebab-case folder / route segment:
   - `Uom` → `uoms`
   - `Supplier` → `suppliers`
   - `SampleItem` → `sample-items`
   - `DocumentTemplate` → `document-templates`
3. **Respect existing non-canonical folders.** If a folder `uom/` (singular) already exists for this entity and the user has **not** asked for cleanup, keep `uom` as the slug for this PRD — note it in the handoff so downstream tasks inherit it. Renaming is a separate request.
4. **Emit the slug table.** Fill the table below so the REPOSITORY, SERVICE, API, and UI tasks read the slug from one place instead of re-deriving. This is the single source of truth for folder names across the PRD.

### Canonical slugs declared by this task

| Prisma Model (PascalCase) | Resource Slug (plural kebab-case) | Target API folder                                       | Target Web folder                                              |
| ------------------------- | --------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| {{MODEL_NAME}}            | {{RESOURCE_SLUG}}                 | `plugins/{{MODULE_NAME}}/src/api/{{RESOURCE_SLUG}}/`    | `plugins/{{MODULE_NAME}}/src/web/pages/{{RESOURCE_SLUG}}/`     |

If the plugin will host only a single resource, flag that here — the API/SERVICE tasks may keep files flat at `src/api/` root (see [plugins/audit-log/src/api/](plugins/audit-log/src/api/)).

## Cross-Fragment References — STRICT

> **The Prisma fragment is the unit of isolation. Any reference from a model in *this* plugin's fragment to a model defined elsewhere — whether in [packages/database/prisma/header.prisma](packages/database/prisma/header.prisma) (core tenant models) or in another plugin's [src/database/prisma/fragment.prisma](plugins/) — must be stored as a plain `String?` foreign-key column. Do NOT declare a Prisma `@relation` field across fragment boundaries. Same-fragment relations (this plugin's own models pointing at each other) are encouraged.**

### The rule

1. **Same fragment (this plugin → its own models)**: full Prisma `@relation` is allowed and encouraged. Both sides live in the file you own, so cascade behavior, bi-directional declaration, and `include` ergonomics are all available.
2. **Cross fragment (this plugin → core OR this plugin → another plugin)**: store the related id as `<targetName>Id String?` (or non-nullable `String` if the reference is required). Add `@@index([<targetName>Id])` whenever you'll filter or join on it.
3. **No `@relation` across fragments.** Prisma requires bi-directional declarations, so a `createdBy User? @relation(...)` would force `sampleArticles SampleArticle[]` on the central `User`, and a `template DocumentTemplate? @relation(...)` would force a back-relation in the `document-templates` plugin — both leak this plugin's model names into a fragment you don't own.
4. **Resolve via separate query** when you need the referenced entity's data: see [REPOSITORY.md](REPOSITORY.md) and [SERVICE.md](SERVICE.md) for the pattern (`client.user.findUnique({ where: { id: row.createdById } })`, `client.documentTemplate.findUnique({ where: { id: row.templateId } })`). `include: { createdBy: true }` will not compile because no relation is declared — that's expected.

### Targets that must be referenced by id-only

The set covers everything reachable on the tenant client (`PrismaService.getTenantClient(tenantSlug)`) that lives outside this plugin's fragment — exactly the `TenantModelKeys` whitelist in [packages/backend/src/prisma/tenant-prisma-client.ts](packages/backend/src/prisma/tenant-prisma-client.ts):

- **Core tenant models** (in `header.prisma`): `tenant`, `user`, `role`, `permission`, `tenantConfig`, `auditLog`, `auditConfig`, `plugin`, `tenantSubscription`, `notification`, `notificationPreference`, `file`, `emailMessage`, `workflowProcess`, `workflowStep`, `workflowTransition`, `importJob`.
- **Other plugins' contributed models** (in their own fragments — currently): `documentTemplate`, `documentRender`, `emailTemplate` (document-templates); `integrationPartner`, `integrationWebhookEvent`, `integrationWebhook`, `integrationApiKey`, `integrationWebhookDelivery`, `calendarConnection`, `calendarEventLink`, `meetingItem`, `meetingSpace` (integration); `sampleItem`, `sampleArticle` (sample-plugin). The list grows whenever another plugin contributes a model.

If you're unsure whether a model is "yours" or "someone else's": if it isn't declared in *this* plugin's `fragment.prisma`, treat it as cross-fragment.

### Why this rule exists

- **Fragment isolation.** Neither `header.prisma` nor any other plugin's `fragment.prisma` is edited when this plugin is installed, modified, or removed.
- **Independent installability.** Plugin B can be disabled (or never installed) without breaking plugin A — there are no dangling FK constraints in the merged schema, and missing rows just resolve to `null` in the application.
- **Convention match.** Existing models follow this — `Notification.userId String` (core, no relation), `WorkflowTransition.userId String` (core, no relation), `IntegrationWebhookDelivery.webhookId String` with explicit relation only because both sides live in the *same* `integration` plugin fragment. The single legacy exception is `AuditLog.user User?`, which predates the plugin system; do not propagate that pattern.

### Plugin fragment example — CORRECT (cross-fragment id-only, same-fragment relation)

```prisma
model {{ModelName}} {
  id            String   @id @default(uuid())
  // ... domain fields ...

  // Cross-fragment FK to a core model — id-only
  createdById   String?           // FK to User.id (core), null after the user is deleted

  // Cross-fragment FK to another plugin's model — id-only
  templateId    String?           // FK to DocumentTemplate.id (document-templates plugin)

  // Same-fragment relation — full @relation is fine
  parentId      String?
  parent        {{ModelName}}? @relation("{{ModelName}}Tree", fields: [parentId], references: [id])
  children      {{ModelName}}[] @relation("{{ModelName}}Tree")

  @@index([createdById])
  @@index([templateId])
  @@map("{{TABLE_PREFIX}}_{{snake_case_table}}")
}
```

> The `{{TABLE_PREFIX}}` here is the plugin's 3-letter (max) module abbreviation — declared in the NEW-MODULE task and reused by every model the plugin contributes. See [Table Naming Prefix — STRICT](#table-naming-prefix--strict) below for the full rule.

### Plugin fragment example — FORBIDDEN (cross-fragment relations)

```prisma
model {{ModelName}} {
  // ❌ Cross-fragment to core — would force a back-relation on User in header.prisma
  createdById String?
  createdBy   User? @relation(fields: [createdById], references: [id], onDelete: SetNull)

  // ❌ Cross-fragment to another plugin — would force a back-relation in document-templates' fragment
  templateId  String?
  template    DocumentTemplate? @relation(fields: [templateId], references: [id])
}
```

### When the user explicitly asks for `include` ergonomics

Some PRDs read better with `client.{{modelName}}.findUnique({ include: { createdBy: true, template: true } })`. If you believe this PRD is one of them, **stop and escalate to the user** — confirm they accept editing the foreign fragment (`header.prisma` for core, or another plugin's fragment for plugin↔plugin) to add a back-relation. This is a deliberate cross-fragment-coupling decision and belongs to the user, not the executor. Do not silently edit a fragment you don't own.

### Checklist

- [ ] Every reference from this plugin's models to a model in *another* fragment (core or another plugin) is a `String?` foreign-key column, not a Prisma `@relation`.
- [ ] Every relation declared inside this plugin's fragment has both sides in *this same fragment* — never spans into `header.prisma` or another plugin's fragment.
- [ ] `header.prisma` was NOT modified by this task.
- [ ] No other plugin's `src/database/prisma/fragment.prisma` was modified by this task.
- [ ] An `@@index([<targetName>Id])` exists for every cross-fragment FK that is queried by the service.
- [ ] If the PRD genuinely needs `include`-style ergonomics across fragments, the question was raised with the user before any cross-fragment relation was added.

## Table Naming Prefix — STRICT

> **Every `@@map(...)` value in this plugin's fragment uses a stable 3-letter (max) lowercase prefix that identifies the plugin, followed by an underscore and the snake_case model name. The prefix is declared once in the NEW-MODULE task and reused by every model the plugin contributes. Don't use the full module slug as the prefix, don't skip the prefix, don't vary the prefix between models in the same plugin.**

### Format

```prisma
model {{ModelName}} {
  // ... fields ...
  @@map("{{TABLE_PREFIX}}_{{snake_case_table}}")
}
```

Where:
- `{{TABLE_PREFIX}}` is the plugin's lowercase abbreviation. **Maximum 3 letters**, minimum 1. Identical for every model in this fragment.
- `{{snake_case_table}}` is the model name in snake_case (PascalCase → snake_case): `Uom` → `uom`, `SupplierContact` → `supplier_contact`, `PurchaseOrderLine` → `purchase_order_line`.

### Picking the abbreviation

Derive the prefix from the plugin's module slug. Take the most-recognizable letters — usually consonants or the first three — capped at 3:

| Module slug          | Recommended prefix | Rationale                                  |
| -------------------- | ------------------ | ------------------------------------------ |
| `master-data`        | `mst`              | Consonants of "master"                     |
| `inventory`          | `inv`              | Common abbrev                              |
| `billing`            | `bil`              | Consonants of "billing"                    |
| `procurement`        | `pcr`              | Consonants of "procurement"                |
| `accounting`         | `acc`              | First 3 of "accounting"                    |
| `human-resources`    | `hrm`              | Common HR abbrev                           |
| `customer-relations` | `crm`              | Common CRM abbrev                          |

Rules for picking:
- **≤ 3 lowercase letters**, never digits, never separators (no `-`, `_`).
- **Should suggest the module name** at a glance to a developer reading raw SQL.
- **Must be unique across the project** — check existing fragments before locking a new prefix:
  ```bash
  grep -h '@@map' plugins/*/src/database/prisma/fragment.prisma | sort -u
  ```
- **Must be the same for every model in this plugin**. One plugin → one prefix, full stop. If the prefix you want is taken, pick a different one *for this plugin* — never reuse another plugin's prefix.

### Why this prefix exists

- **Disambiguation in raw SQL.** The merged `schema.prisma` contains every plugin's tables. A glance at `mst_supplier` tells a DBA the table belongs to the `master-data` plugin without a Prisma client lookup.
- **Collision protection.** Two plugins can independently produce a "User", "Settings", or "Item" model — the prefix prevents `mst_user` / `crm_user` from collapsing into one row.
- **Compactness.** Postgres SQL identifiers cap at 63 characters. Long module slugs combined with long table names plus index suffixes (`_pkey`, `_idx`) can hit the cap; 3-letter prefixes leave plenty of room.
- **Readability beats verbosity.** A full module-slug prefix (`master_data_supplier`) is so long it crowds out the actual table name in queries; 3 letters is the sweet spot.

### Plugin fragment example — CORRECT

```prisma
model Uom {
  id        String   @id @default(uuid())
  code      String   @unique
  name      String
  createdAt DateTime @default(now())

  @@index([code])
  @@map("mst_uom")          // <-- 3-letter prefix
}

model Supplier {
  id        String   @id @default(uuid())
  name      String
  email     String?
  createdAt DateTime @default(now())

  @@map("mst_supplier")     // <-- same prefix as every other model in this plugin
}
```

### Plugin fragment example — FORBIDDEN

```prisma
@@map("uom")                 // ❌ no prefix — collides if another plugin defines a "Uom"
@@map("master_data_uom")     // ❌ full slug as prefix — verbose, breaks the rule
@@map("masterUom")           // ❌ camelCase
@@map("MST_UOM")             // ❌ uppercase
@@map("mstr_uom")            // ❌ 4-letter prefix — exceeds the cap
```

### Existing models — do NOT retrofit

This rule applies to **all new plugin models** going forward. Existing models that already shipped without a 3-letter prefix (`sample_item`, `sample_article`, `document_template`, `document_render`, `email_template`, `integration_*`) keep their current `@@map()` values. Renaming them is a breaking schema change that requires a coordinated migration on every active tenant — do **not** retrofit the rule across the codebase as part of an unrelated PRD. If a separate cleanup PRD targets the rename, treat it as a CHANGE-REQUEST with a BREAKING-CHANGES section.

### Checklist

- [ ] The plugin's `{{TABLE_PREFIX}}` is identified — either pulled from the existing models in this fragment (if the plugin already has any) or declared by the NEW-MODULE task.
- [ ] Every new model added in this task uses `@@map("{{TABLE_PREFIX}}_<snake_case>")`.
- [ ] The prefix is identical across every model the plugin contributes — `grep '@@map' plugins/{{MODULE_NAME}}/src/database/prisma/fragment.prisma` shows a consistent prefix.
- [ ] `grep -h '@@map' plugins/*/src/database/prisma/fragment.prisma | sort -u` shows no other plugin using the same prefix.
- [ ] The prefix is ≤ 3 lowercase letters and doesn't include digits, hyphens, or underscores.

## Schema Placement Decision

A plugin declares **every** model it needs in its own fragment. [header.prisma](packages/database/prisma/header.prisma) belongs to core (`Tenant`, `Plugin`, `Invoice`, …) and is never edited by a plugin task (see Cross-Fragment References above).

Every model exists in **every** schema (public and each `tenant_{slug}`); which client reads it decides where its rows live:

| Data nature                                    | Declared in                                                        | Read and written through                                   | Example |
| ---------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------- | ------- |
| Owned by a single tenant (the default)         | `plugins/{{MODULE_NAME}}/src/database/prisma/fragment.prisma`      | `this.prisma.getTenantClient(tenantSlug)`; listed in `TenantModelKeys` | `SampleItem`, `DocumentTemplate`, `IntegrationWebhookEvent` |
| Platform-wide rows the plugin owns (rare)      | the same fragment                                                  | the main client, `this.prisma.{model}` (public schema); **not** in `TenantModelKeys` | integration's `CalendarAccountIndex` (one Google account → every tenant connection that uses it) |
| No persistent storage                          | *no model*                                                         | —                                                          | [plugins/audit-log/](plugins/audit-log/) reads only |

If in doubt, it's tenant-owned. Platform-wide rows need a reason (cross-tenant lookups, no tenant context at all) and a note in the handoff, because every other plugin rule assumes tenant scope.

## Entity Definitions

For each entity required by this PRD, write the full Prisma model block. Keep fragment files datasource-free and generator-free — the merge script rejects either.

{{ENTITY_DEFINITIONS}}

### Required Conventions

Every model declared in this codebase follows these rules unless there is an explicit reason to deviate:

- **Primary key**: `id String @id @default(uuid())`
- **Timestamps**: `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt`
- **Soft delete**: Only if the domain explicitly needs it — add `deletedAt DateTime?` and filter via application code. Do not silently inject soft-delete on every model.
- **Tenant scoping**: Models in a fragment are **already** tenant-scoped by virtue of living in the `tenant_{slug}` schema. Do **not** add a `tenantId` column to fragment models — it would duplicate the schema-per-tenant guarantee and fragment the data.
- **Naming**: Model names in PascalCase, field names in camelCase, relation names in camelCase. The Prisma client exposes each model as a camelCase delegate (`SampleItem` → `client.sampleItem`).
- **Enums**: Declare enums in the same fragment (or header) where they're used. Enum values are SCREAMING_SNAKE_CASE.

### Fields

For each entity, document every field. Use Prisma's native types — do not reintroduce TypeScript primitives here.

| Field Name      | Prisma Type | Required | Default | Notes |
| --------------- | ----------- | -------- | ------- | ----- |
| {{FIELD_TABLE}} |             |          |         |       |

### Relationships

Document every relation (one-to-one, one-to-many, many-to-many). Prisma relations carry both sides — always declare both. Specify:

- Relation direction and cardinality
- `onDelete` / `onUpdate` behavior. Prisma's defaults: `onDelete: Restrict` when the FK is required, `SetNull` when it's optional; `onUpdate: Cascade`. Use `Cascade` on delete only for strict parent-child ownership
- Nullability of the foreign-key field
- Whether the relation is within the same schema (almost always yes inside a tenant)

{{RELATIONSHIPS}}

### Indexes & Constraints

- [ ] Unique constraints via `@@unique([...])` or `@unique` for business keys (e.g. name within a tenant).
- [ ] `@@index([...])` for every field used in `WHERE`, `ORDER BY`, or `JOIN` that isn't already indexed by a relation.
- [ ] Compound indexes for common list-filter + sort pairs (e.g. `@@index([status, createdAt])`).

{{INDEXES}}

### Enums & Constants

Declare domain enums directly in the fragment. Do **not** place enums in a shared `types/` package — the Prisma client is the single source of truth.

{{ENUMS}}

## Validation Rules

Prisma enforces **shape** only (types, nullability, constraints). Business validation is enforced via Zod schemas at the API boundary (see [API.md](API.md) and the Zod DTOs under each plugin's `api/*/dto/`). This section should list the validations that must be reflected **at the schema level** (lengths, allowed enum values, foreign-key integrity) — not the Zod-level rules.

{{VALIDATION_RULES}}

## Seed Data

Prisma seeds in this codebase are **not** the vehicle for per-tenant default data. Use the right channel:

- **Platform-level seed** (public schema, one-time at project bootstrap) → core only: [apps/api/src/seed.ts](apps/api/src/seed.ts), run via `pnpm db:seed`. A plugin task never edits it.
- **Per-tenant defaults** (runs every time a tenant installs the plugin) → implement in the plugin's `lifecycle.onInstall(ctx)` hook. See [plugins/sample-plugin/src/lifecycle.ts](plugins/sample-plugin/src/lifecycle.ts) for the pattern (build a short-lived `PrismaClient` bound to `tenant_{slug}`, seed, disconnect).

{{SEED_DATA}}

## Deliverables

- [ ] Edit this plugin's `fragment.prisma` only — never `header.prisma` or another plugin's fragment.
- [ ] Define every field with correct Prisma types, `@default(...)`, nullability, and constraints.
- [ ] Declare relations on both sides with explicit `onDelete`/`onUpdate` where it matters.
- [ ] Add `@@index` / `@@unique` for access patterns identified in the PRD.
- [ ] Run `pnpm plugins:merge-prisma` — expect zero validation errors.
- [ ] Run `pnpm db:generate` — Prisma client regenerated without errors.
- [ ] Add every new tenant-owned model's camelCase delegate to `TenantModelKeys` in [packages/backend/src/prisma/tenant-prisma-client.ts](packages/backend/src/prisma/tenant-prisma-client.ts). No script does it; without it `getTenantClient(slug).{{modelName}}` is a type error. This is the only file outside the plugin a MODEL task edits.
- [ ] Seed data is implemented in `lifecycle.onInstall` (tenant-scoped). Plugins have no platform-level seed.
- [ ] **Do not** run `pnpm db:migrate:dev` or `pnpm db:migrate:tenants` — instead, include in the handoff the exact commands the user should run manually, e.g. `pnpm db:migrate:dev --name add-{{PRD_NAME}}-models --skip-seed` followed by `pnpm db:migrate:tenants`.
- [ ] Flag any migration risk for currently-active tenants (nullable→required transitions, column drops, index rebuilds) in the handoff so the user can plan the manual rollout.

## Acceptance Criteria

- [ ] Every model is in this plugin's fragment, and any platform-wide model is called out in the handoff (Schema Placement Decision above).
- [ ] Every tenant-owned model is listed in `TenantModelKeys`.
- [ ] `pnpm plugins:merge-prisma` succeeds; merged `schema.prisma` contains the expected model(s).
- [ ] Indexes exist for every field referenced in list/search queries defined by the PRD.
- [ ] Relations' cascade behavior matches the domain ownership (cascade for ownership, nullify for loose reference, restrict for protected data).
- [ ] No model duplicates a model in `header.prisma`: the merge rejects the reserved names (`Tenant`, `User`, `Role`, `Permission`, `TenantConfig`, `AuditLog`, `AuditConfig`, `Plugin`) and Prisma rejects any other duplicate (e.g. `TenantSubscription`).
- [ ] No `tenantId` column on tenant-schema models — tenancy is enforced by the schema itself.
- [ ] No migration was created or applied by this task — `git status packages/database/prisma/migrations/` shows no new folders added by the executor. The user will run `pnpm db:migrate:dev` and `pnpm db:migrate:tenants` manually.
