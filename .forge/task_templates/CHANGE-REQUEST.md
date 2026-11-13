# Task: Change Request — {{MODULE_NAME}}

## Overview

| Field      | Value                         |
| ---------- | ----------------------------- |
| Module     | {{MODULE_NAME}}               |
| Mode       | Change Request                |
| PRD Scope  | {{PRD_SCOPE}}                 |

## Objective

Analyze the existing **{{MODULE_NAME}}** plugin/module and document every change required to satisfy the PRD. In this codebase a module is a plugin in [plugins/{{MODULE_NAME}}/](plugins/{{MODULE_NAME}}/) (or a core package under [packages/backend/src/](packages/backend/src/) / [packages/ui/src/](packages/ui/src/) for cross-cutting concerns). This task is the master change plan — every downstream model/service/API/UI task references it.

This is a **module-level** task. It must assess impact across every layer, not just a single feature.

## PRD Folders in This Module

{{PRD_FOLDER_LIST}}

## Codebase Context

Read these before writing the analysis:

- Plugin being modified: [plugins/{{MODULE_NAME}}/](plugins/{{MODULE_NAME}}/)
- API registry (will be regenerated on save): [apps/api/src/plugin-registry.ts](apps/api/src/plugin-registry.ts)
- Web registry (will be regenerated on save): [apps/web/lib/plugin-routes.ts](apps/web/lib/plugin-routes.ts), [plugin-menus.ts](apps/web/lib/plugin-menus.ts), [plugin-dictionaries.ts](apps/web/lib/plugin-dictionaries.ts)
- Merged Prisma schema (read-only): [packages/database/prisma/schema.prisma](packages/database/prisma/schema.prisma)
- Reference for plugin patterns: [plugins/sample-plugin/](plugins/sample-plugin/)

## Current State Analysis

Describe the current state of the module as it exists on disk today. This section must be written from reading the code, not from the PRD. Cover:

- Plugin's API modules (controllers, services, DTOs) under `plugins/{{MODULE_NAME}}/src/api/`
- Plugin's web pages and components under `plugins/{{MODULE_NAME}}/src/web/`
- Plugin's Prisma fragment at `plugins/{{MODULE_NAME}}/src/database/prisma/fragment.prisma` (if any)
- Plugin's permissions in `plugins/{{MODULE_NAME}}/src/permissions.ts`
- Plugin's menu entries in `plugins/{{MODULE_NAME}}/src/web/menus.ts`
- Plugin's dictionary keys in `plugins/{{MODULE_NAME}}/src/dictionaries.ts` (both `en` and `id`)
- Plugin's lifecycle hooks in `plugins/{{MODULE_NAME}}/src/lifecycle.ts`
- Any core code this plugin consumes from [@saas/backend](packages/backend/) or [@saas/ui](packages/ui/)

{{CURRENT_STATE}}

## Change Summary

One paragraph: what is changing and why. Tie directly to the PRD requirement(s).

{{CHANGE_SUMMARY}}

## Impact Analysis

### Affected Prisma Models

List every model in this plugin's `fragment.prisma` that needs a new field, renamed field, dropped field, or relation change. (`header.prisma` is core's; a CR that needs it changed is escalated, not planned here.) For each change, note:
- Whether the change is additive (safe) or destructive (requires backfill/data migration)
- Whether a tenant-schema migration is required via `pnpm db:migrate:tenants`
- For a **new** model: its camelCase delegate must be added to `TenantModelKeys` in [packages/backend/src/prisma/tenant-prisma-client.ts](packages/backend/src/prisma/tenant-prisma-client.ts) (unless it's a platform-wide model read through `this.prisma`)

{{AFFECTED_MODELS}}

### Affected Backend Services, Controllers, Modules

List each NestJS class that must change. Include the file path and the reason. Remember that if a controller route, DTO, or method signature changes, the web-side `apiClient` calls also change.

{{AFFECTED_SERVICES}}

### Affected API Endpoints

Enumerate every endpoint that gains, loses, or changes behavior. Call out any change in:
- HTTP method or path
- Required permissions (decorator changes)
- Request body shape (Zod schema changes)
- Response shape
- Error behavior

Breaking API changes must be listed in the **Breaking Changes** section below.

{{AFFECTED_ENDPOINTS}}

### Affected UI Screens & Components

List every page under `plugins/{{MODULE_NAME}}/src/web/pages/` and every shared component under `packages/ui/src/` that needs to change. For each, note whether it affects layout, data contract, or user flow.

{{AFFECTED_UI}}

### Affected Permissions & RBAC

List new, renamed, removed, or re-mapped permissions. Permission format must stay `{{MODULE_NAME}}.{resource}.{action}`. For every change:
- Update `plugins/{{MODULE_NAME}}/src/permissions.ts`
- Update the matching `@Permissions(...)` decorators in controllers
- Update the `permissions` field on menu nodes in `plugins/{{MODULE_NAME}}/src/web/menus.ts`
- Update `<Protect permissions={[...]}>` wrappers and `useRBAC().authorize({...})` calls on web pages

Any permission **removal** is a breaking change for existing role→permission bindings — document the migration in **Migration Plan**.

{{AFFECTED_PERMISSIONS}}

### Affected Menus, Routes, and Navigation

- [ ] `plugins/{{MODULE_NAME}}/src/web/menus.ts` — what items appear/disappear/change position
- [ ] Route paths — if a page moves, document the old-URL → new-URL redirect (if required)
- [ ] Breadcrumb/page title updates via `PageHeader` component calls

{{AFFECTED_MENUS}}

### Affected Dictionaries (i18n)

Every new UI string must have both `en` and `id` translations in `plugins/{{MODULE_NAME}}/src/dictionaries.ts`. List additions, removals, and key renames.

{{AFFECTED_DICTIONARIES}}

### Affected Lifecycle Hooks

If tenant provisioning behavior changes (new default data, changed workflow seeding), document the changes to `plugins/{{MODULE_NAME}}/src/lifecycle.ts` and how existing tenants get them. Lifecycle hooks don't re-run on deploy:

- `onInstall` runs once per tenant, the first time the plugin is enabled.
- `onActivate` runs when a disabled plugin is enabled again.
- `onUpgrade` runs only when an already-enabled plugin is enabled again after its `package.json` `version` changed (e.g. a payment or an app switching it on). A disable → enable runs `onActivate` instead.

So data every existing tenant needs belongs in a migration (`pnpm db:migrate:tenants`) or in idempotent code the plugin runs when it reads the data; not only in a hook. Permissions are not a lifecycle concern: new permissions in `permissions.ts` are seeded and granted to `ADMIN` when the plugin is enabled.

{{AFFECTED_LIFECYCLE}}

### Affected Shared Types / Exports

If the plugin exports TypeScript types consumed by other code, or if it imports from `@saas/backend` / `@saas/ui` and those imports change, list them here.

{{AFFECTED_TYPES}}

### Affected Emails, Settings, and Calendar / Meeting Keys

These are contracts other people's data depends on. Check each one the CR touches:

- [ ] **Emails** (`src/emails.ts`): a template's `key` is what tenants' reworded versions (Templates → Emails) and the email log are stored under. Renaming a key orphans every tenant's edit. Removing a variable can leave edits that mention it rendering nothing or failing the check, and adding one to `required` makes existing edits that lack it fail the check: the default goes out instead. Both languages (`en`, `id`) change together.
- [ ] **Settings** (`src/config.schema.ts`): every new field needs a `.default(…)`, because tenants' stored settings don't have it. A renamed key is a new key: the old value stays stored and is ignored. `PUT /tenant-plugins/{{MODULE_NAME}}/config` merges, so a removed key isn't deleted from stored settings either.
- [ ] **Calendar events** (`calendar.upsert`): `source` + `key` identify an event in each user's Google Calendar. Changing the key format creates new events and leaves the old ones in users' calendars: `remove` them under the old key first.
- [ ] **Meetings** (`meetings.create`): the same for `source` + `key`. A new key makes a new Meet space; `cancel` the old one so it's locked.
- [ ] **Events** (`src/events.ts`): renaming an event name silently disconnects every `@OnPluginEvent` listener on it, including other plugins'.

## Breaking Changes

List every change that breaks an existing consumer — external or internal — with its mitigation. "Breaking" includes:

- Removing or renaming an API endpoint, path param, query param, or response field
- Removing or renaming a permission
- Dropping or renaming a database column (the column disappears from every tenant schema)
- Changing a menu route path (breaks bookmarks)
- Changing a Zod schema in a way that rejects previously-valid payloads
- Renaming an email template key, a settings key, an event name, or the calendar / meeting `key` format (see the section above)

For each, document the mitigation (deprecation window, compatibility shim, data migration, user-facing communication).

{{BREAKING_CHANGES}}

## Cross-Fragment References — STRICT

> **A change request that touches a plugin model must not introduce or remove a Prisma `@relation` that crosses a fragment boundary — neither plugin↔core nor plugin↔another-plugin. Cross-fragment references are id-only `String?` columns. Same-fragment relations (within this plugin's own fragment) are unaffected. The full rule lives in [MODEL.md → Cross-Fragment References](MODEL.md#cross-fragment-references--strict). For a change request, the additional impact-analysis duties are:**

### 1. Adding a new id-only FK from this plugin's model to another fragment

This is the common case — allowed and easy. The target can be either core or another plugin:

- Add a `<targetName>Id String?` column to **this plugin's** fragment (and `@@index([<targetName>Id])` if you'll filter by it).
- Update the SERVICE to stamp the FK from `req.user.userId` (for actor identity referring to the calling user) or to validate user-supplied target ids against the tenant. **Validation is required regardless of whether the target lives in core or another plugin** — Prisma cannot enforce referential integrity for you.
- Update the REPOSITORY to fetch the foreign entity via batched `findMany({ where: { id: { in: [...] } } })` — never via `include`. Pull only the fields you'll actually return; never expose secret fields of core models or internal fields of foreign-plugin models.
- Update the API DTO to **reject** the FK in `create*Schema` / `update*Schema` if it's an actor identity (privilege-escalation guard); accept it as `z.string().uuid()` only if it's a user-chosen target.
- Migration is non-breaking (new nullable column).
- For other-plugin targets, decide on an orphan-handling strategy in case the foreign plugin is disabled — see [SERVICE.md → Cleanup when the referenced row is deleted](SERVICE.md#cross-fragment-references--strict).

Document in the impact analysis above which of MODEL / REPOSITORY / SERVICE / API need to change, and confirm none of them touch [packages/database/prisma/header.prisma](packages/database/prisma/header.prisma) **or** any other plugin's `src/database/prisma/fragment.prisma`.

### 2. Removing a previously-incorrect cross-fragment `@relation`

If the change request is *fixing* a plugin that wrongly declared a cross-fragment `@relation` (e.g. the legacy `AuditLog.user User?` pattern was copied, or an early plugin ran a `template DocumentTemplate? @relation(...)` into the document-templates fragment), the impact is bigger:

- This plugin's fragment loses the relation field.
- The foreign fragment (`header.prisma` for core, or another plugin's `fragment.prisma` for plugin↔plugin) loses its back-relation — this **does** edit a fragment outside this plugin's ownership, so flag it as a breaking schema change here and coordinate with the owner.
- Any code doing `client.{{modelName}}.findUnique({ include: { createdBy: true } })` (or equivalent for the foreign-plugin target) must switch to a separate `findUnique` call.
- Migration is non-breaking at the data level — the underlying column stays, only the Prisma metadata changes. But every tenant schema's Prisma client is regenerated, so a coordinated deploy is required.
- Update the BREAKING CHANGES section above with the deprecation note.

### 3. Adding a new reference from this plugin → another plugin

Same rule as scenario 1: id-only `<targetName>Id String?` column on **this plugin's** model, no `@relation`. Specifically NOT allowed: declaring a `@relation` to a model in another plugin's fragment, since that would force a back-relation in a fragment you don't own and create a hard install-order dependency.

If the target plugin may be disabled at runtime on a given tenant, the response decoration legitimately yields `null` for the foreign field — document this in the API task's Swagger schema.

### 4. Adding a new reference from core → this plugin (i.e. modifying header.prisma to point at this plugin)

This is **never** the right call in a change request. If a core platform feature needs to reference one of this plugin's models, that's a sign the platform feature should live inside the plugin instead, or that the dependency direction is inverted. Stop and escalate to the user.

### 5. Adding a new reference from this plugin → another plugin's model that this plugin already references

If the existing reference is already an id-only `String?` (the only allowed shape), nothing platform-level changes — just add the new column the same way as scenario 1. If the existing reference is a legacy `@relation`, treat it as scenario 2 (fix it first) before adding more references.

### Impact-analysis checklist for this CR

- [ ] No proposed change adds a `@relation` field on this plugin's model that crosses a fragment boundary (neither into `header.prisma` nor into another plugin's fragment).
- [ ] No proposed change adds a back-relation field (e.g. `{{modelName}}s {{ModelName}}[]`) on any core model in `header.prisma` or on any model in another plugin's fragment.
- [ ] If the CR removes a legacy cross-fragment `@relation`, it's listed as a BREAKING CHANGE above with a coordinated-deploy note and the owner of the foreign fragment was informed.
- [ ] If the CR adds a new id-only cross-fragment FK, the migration is non-breaking (new nullable column) and the corresponding REPOSITORY/SERVICE/API tasks are updated accordingly.
- [ ] `header.prisma` and every other plugin's `fragment.prisma` either stay byte-identical (id-only FK case) or their diff is explicitly listed in BREAKING CHANGES.
- [ ] Cross-fragment FKs whose target may go missing (deleted user, disabled foreign plugin) have a documented orphan-handling strategy.

## Table Naming Prefix — STRICT

> **A change request that adds new models to a plugin must use that plugin's already-declared `{{TABLE_PREFIX}}` (the 3-letter lowercase abbreviation in front of every existing `@@map(...)` value in the fragment). Don't invent a new prefix mid-plugin. Don't skip the prefix. Renaming an existing table to add a prefix it didn't previously have is a breaking schema change — surface it in BREAKING CHANGES above and require user sign-off.**

The full rule (format, derivation, examples, forbidden patterns) lives in [MODEL.md → Table Naming Prefix](MODEL.md#table-naming-prefix--strict). For a change request, the additional duties are:

### 1. Adding new models to an existing plugin

Read the plugin's existing prefix from its current models:

```bash
grep '@@map' plugins/{{MODULE_NAME}}/src/database/prisma/fragment.prisma
```

Every existing `@@map(...)` value must share a single prefix (the plugin's). If they don't — i.e. the plugin's existing tables are inconsistent (`sample_item` vs `sample_article` is fine; `mst_uom` vs `master_supplier` is not) — flag it as a pre-existing inconsistency and **stop** until the user confirms which prefix the new models should adopt.

For new models, set `@@map("<prefix>_<snake_case>")` using the plugin's existing prefix. Do not introduce a different abbreviation, even if it would read better in isolation.

### 2. Adding new models to a plugin that has no models yet

Treat the situation like NEW-MODULE: declare the prefix in the plugin's NEW-MODULE-equivalent record, run the uniqueness check across `plugins/*/src/database/prisma/fragment.prisma`, and apply consistently.

### 3. Renaming an existing table to add (or change) a prefix

This is **always a breaking schema change.** Document in BREAKING CHANGES above:

- The old table name, the new table name, and the data-migration shape (`ALTER TABLE old_name RENAME TO new_name`).
- The migration runs on every active tenant via `pnpm db:migrate:tenants` — coordinate timing.
- No application code change is required (Prisma's generated client tracks the model name, not the table name) but a **redeploy** is required so the regenerated Prisma client lines up with the renamed table.
- If the rename is part of a "retrofit prefixes across the codebase" effort, do **not** bundle it with an unrelated PRD — that's its own focused CR.

### 4. Adding tables that legitimately need to be unprefixed

There is no such case for plugin models. The prefix rule applies to every `@@map(...)` a plugin produces. Core tenant models in `header.prisma` are out of scope for this rule (they're owned by the platform and don't share the merged-fragment namespace risk).

### Impact-analysis checklist for this CR

- [ ] Every new `@@map(...)` value introduced by this CR uses the plugin's existing prefix exactly.
- [ ] No existing `@@map(...)` value is changed unless explicitly listed in BREAKING CHANGES above with a coordinated-deploy note.
- [ ] If the plugin had inconsistent prefixes pre-CR, the executor flagged it to the user before adding new models.

## Migration Plan

If there are schema changes, data migrations, or backward-incompatible changes, describe the ordered migration steps. Default sequence:

1. Edit this plugin's `fragment.prisma` (never `header.prisma`). For a new model, add its delegate to `TenantModelKeys`.
2. `pnpm plugins:merge-prisma` — regenerates the merged schema; fails fast on violations.
3. `pnpm db:generate` — regenerates the Prisma client (run before building).
4. `pnpm db:migrate:dev --name {{MIGRATION_NAME}}` — creates the migration on the public schema in dev.
5. `pnpm db:migrate:tenants` — applies pending migrations to every `tenant_{slug}` schema except TERMINATED tenants.
6. Any data-migration script (place under `scripts/` and reference here) — for rename/backfill cases, run **after** step 5.
7. Update code referencing renamed/removed fields.
8. `pnpm plugins:register` — only needed if menus, permissions, lifecycle, or plugin metadata changed.
9. Bump the plugin's `version` in `plugins/{{MODULE_NAME}}/package.json` if the change is externally visible.

Never run `prisma migrate reset` against an environment that has tenant schemas — it will drop every `tenant_*` schema. If a migration is wrong, create a reversing migration.

{{MIGRATION_PLAN}}

## Deliverables

- [ ] Complete impact analysis covering every layer above
- [ ] Every breaking change documented with an explicit mitigation
- [ ] Migration plan is ordered and reversible wherever feasible
- [ ] Permission rename/removal has a backfill or role-remap script
- [ ] Dictionary entries are updated for both `en` and `id`
- [ ] Plugin `version` bumped in `plugins/{{MODULE_NAME}}/package.json` if the change is externally visible

## Dependencies

- Access to the current codebase and the ability to inspect existing tenant schemas if needed
- All subsequent backend and frontend tasks depend on this analysis being complete

## Acceptance Criteria

- [ ] Every layer (Prisma fragment, services, endpoints, UI, permissions, menus, dictionaries, lifecycle) has been assessed
- [ ] Every breaking change has a documented, verified mitigation
- [ ] Migration ordering is correct — schema change → generate → migrate public → migrate tenants → code update → registry refresh
- [ ] No silent removal of existing functionality (deprecations, if any, are called out)
- [ ] `pnpm plugins:merge-prisma`, `pnpm plugins:register`, and `pnpm db:generate` all succeed after the planned changes
