# Task: New Plugin/Module Setup — {{MODULE_NAME}}

## Overview

| Field     | Value               |
| --------- | ------------------- |
| Module    | {{MODULE_NAME}}     |
| Mode      | New Plugin / Module |
| PRD Scope | {{PRD_SCOPE}}       |

## Objective

Scaffold the complete plugin package for **{{MODULE_NAME}}** so every subsequent PRD task (models, services, APIs, UI screens, menus) can be built on top of it. In this codebase a "module" is a **plugin** — a full-stack package under [plugins/](plugins/) that exports NestJS modules, React pages, permissions, dictionaries, menus, and an optional Prisma fragment.

This is a **plugin-level** task. It covers the shared scaffolding for every PRD in this module, not the implementation of any individual feature.

## Scope — STRICT

> **This task produces a package skeleton plus the four plugin-level concerns.** Every `*.ts` / `*.tsx` / `*.prisma` file must remain as the generator emitted it, **except** for the four files below which this task is allowed (and expected) to fill in:
>
> 1. **Prisma models** — `plugins/{{MODULE_NAME}}/src/database/prisma/fragment.prisma`
> 2. **Lifecycle hook bodies** — `plugins/{{MODULE_NAME}}/src/lifecycle.ts` (`onInstall` / `onActivate` / `onDeactivate`)
> 3. **Permissions** — `plugins/{{MODULE_NAME}}/src/permissions.ts`
> 4. **Dictionaries** — `plugins/{{MODULE_NAME}}/src/dictionaries.ts`
>
> Everything else under `plugins/{{MODULE_NAME}}/src/` (controllers, services, DTOs, React pages, components, menu tree) stays exactly as the generator produced it. If you find yourself editing any file outside the four listed above, **stop** — that work belongs to the follow-up task.

### In scope (do these, in order)

1. Run the non-interactive scaffold command (`pnpm plugin:new …`).
2. Fill in the four plugin-level concerns from the PRD:
   - Add the plugin's Prisma models to `fragment.prisma` (subject to §2's merge rules).
   - Implement `onInstall` / `onActivate` / `onDeactivate` bodies in `lifecycle.ts` (per-tenant seed data only). Enabling the plugin already seeds its permissions in the tenant and grants them to `ADMIN`; tenant admins give them to other roles in **Systems → Roles**. Lifecycle code never binds roles to permissions.
   - Declare the full permission taxonomy in `permissions.ts` (`{{MODULE_NAME}}.{resource}.{action}` with human-readable descriptions).
   - Populate `dictionaries.ts` with `en` + `id` entries for every permission label and any string needed by the lifecycle/permissions work.
3. Run `pnpm plugins:merge-prisma` + `pnpm db:generate` to validate the fragment, then add every new model's camelCase delegate to `TenantModelKeys` in [packages/backend/src/prisma/tenant-prisma-client.ts](packages/backend/src/prisma/tenant-prisma-client.ts). No script does this, and without it `getTenantClient(slug).yourModel` is a type error. It is the one file outside the plugin this task edits.
4. Run `pnpm plugins:register`. It also adds the package to `transpilePackages` in [apps/web/next.config.js](apps/web/next.config.js): check the diff, don't edit that array by hand.
5. Verify `pnpm install`, `pnpm build`, and `pnpm dev` succeed.

### Out of scope (reject / defer to the next task)

- `menus.ts` — the menu tree lives in the MENUS task. When that task fills it in, every entry's `name` will be a dictionary path (e.g. `'{{moduleKey}}.menu.parent'`), never a literal string — see [MENUS.md → Localized Menu Names](MENUS.md#localized-menu-names--strict).
- `src/api/**` — controllers, services, DTOs, Zod schemas live in the API task.
- `src/web/**` — React pages, components, dialogs, forms live in the UI/MENUS tasks.
- Running `pnpm db:migrate:dev`, `pnpm db:migrate:tenants`, or `pnpm db:migrate:deploy` — migrations are run manually by the user after schema review (see MODEL.md scope).
- UI/UX decisions, API shape decisions, and validation schemas for individual endpoints.

Menus, pages, components, and API code stay as placeholders. The next task reads the PRD(s) and fills them in.

## PRD Folders in This Module

{{PRD_FOLDER_LIST}}

## Codebase Context

Read these files first — they are the authoritative references:

- Reference plugin (copy this shape): [plugins/sample-plugin/](plugins/sample-plugin/)
- API registry (auto-regenerated): [apps/api/src/plugin-registry.ts](apps/api/src/plugin-registry.ts)
- Web registry (auto-regenerated): [apps/web/lib/plugin-routes.ts](apps/web/lib/plugin-routes.ts), [plugin-menus.ts](apps/web/lib/plugin-menus.ts), [plugin-dictionaries.ts](apps/web/lib/plugin-dictionaries.ts)
- Next.js transpile list: [apps/web/next.config.js](apps/web/next.config.js)
- Prisma header (public schema): [packages/database/prisma/header.prisma](packages/database/prisma/header.prisma)
- Final merged schema: [packages/database/prisma/schema.prisma](packages/database/prisma/schema.prisma) (do **not** hand-edit — generated)
- Plugin generator: [scripts/generate-plugin.js](scripts/generate-plugin.js)
- Registry generator: [scripts/generate-registry.js](scripts/generate-registry.js)
- Development guide (conventions, platform services, plugin manifest and settings): [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md)

## Cross-Fragment References — STRICT

> **A new plugin must not modify any Prisma fragment it doesn't own — neither [packages/database/prisma/header.prisma](packages/database/prisma/header.prisma) (core tenant models) nor any other plugin's [src/database/prisma/fragment.prisma](plugins/). Any reference from this plugin's models to a model defined elsewhere — core (`User`, `Role`, `Tenant`, `Notification`, `WorkflowProcess`, `File`, `ImportJob`, …) or another plugin (`DocumentTemplate`, `IntegrationPartner`, …) — is stored as a plain `String?` foreign-key column with no Prisma `@relation`. Same-fragment relations (this plugin's models pointing at each other) use full Prisma relations and are encouraged.**

The full rule, rationale, and examples are in [MODEL.md → Cross-Fragment References](MODEL.md#cross-fragment-references--strict). This task only sets up the plugin skeleton — no models are designed here — but the constraint shapes everything the MODEL/REPOSITORY/SERVICE/API tasks will produce inside this plugin:

- **MODEL** task will declare `createdById String?` / `templateId String?` on plugin models, never `createdBy User? @relation(...)` or `template DocumentTemplate? @relation(...)`. Same-fragment relations between this plugin's own models are fine.
- **REPOSITORY** task will fetch cross-fragment entities (core OR other plugins) via separate `findUnique` / batched `findMany` calls — never via `include`. Same-fragment `include` is fine.
- **SERVICE** task will stamp identity FKs from `req.user.userId` on create, validate user-supplied target ids (whether core or other-plugin) before write, and pick an orphan-handling strategy for each cross-fragment FK.
- **API** task's Zod DTOs will reject any client-supplied `createdById` / `ownerId` / `authorId`, type cross-fragment target ids as `z.string().uuid()`, and document decorated cross-fragment fields as `| null`.

If you believe a future PRD inside this module genuinely needs `include` ergonomics that require a back-relation on `User`, on another core model, or on another plugin's model, **escalate to the user before that PRD's MODEL task starts** — the decision to edit a fragment you don't own is platform-level, not plugin-level.

### Acceptance gate for this task

- [ ] The scaffolded plugin's [src/database/prisma/fragment.prisma](plugins/{{MODULE_NAME}}/src/database/prisma/fragment.prisma) is empty of cross-fragment relations (the generator-emitted fragment has none — keep it that way).
- [ ] [packages/database/prisma/header.prisma](packages/database/prisma/header.prisma) is byte-identical to its pre-task state — `git diff` on it shows zero changes.
- [ ] Every other plugin's `plugins/*/src/database/prisma/fragment.prisma` is byte-identical to its pre-task state — `git status plugins/*/src/database/prisma/fragment.prisma` shows no modifications outside this plugin.

## Table Naming Prefix — STRICT

> **This task declares the plugin's `{{TABLE_PREFIX}}` — a stable lowercase abbreviation, ≤ 3 letters, that prefixes every `@@map(...)` value in [src/database/prisma/fragment.prisma](plugins/{{MODULE_NAME}}/src/database/prisma/fragment.prisma). Every model that this plugin's MODEL/CHANGE-REQUEST tasks add later inherits this prefix verbatim. Don't use the full module slug, don't skip the prefix, don't vary it between models.**

The full rule (format, derivation, examples, forbidden patterns) lives in [MODEL.md → Table Naming Prefix](MODEL.md#table-naming-prefix--strict). For the scaffold task, the duties are:

1. **Pick the prefix.** Take the most-recognizable letters of the module slug — usually the first 3 or the consonants — capped at 3. Examples: `master-data` → `mst`, `inventory` → `inv`, `billing` → `bil`, `human-resources` → `hrm`, `customer-relations` → `crm`.
2. **Verify uniqueness across the project.** Run:
   ```bash
   grep -h '@@map' plugins/*/src/database/prisma/fragment.prisma | sort -u
   ```
   Confirm the chosen prefix isn't already in use by another plugin. If it is, pick a different abbreviation **for this plugin** — never share a prefix.
3. **Document the prefix in the handoff** so downstream MODEL tasks reuse it without re-derivation.

### Declared prefix for this module

| Field                       | Value                          |
| --------------------------- | ------------------------------ |
| Module slug                 | `{{MODULE_NAME}}`              |
| Declared `{{TABLE_PREFIX}}` | `{{TABLE_PREFIX}}`             |
| Derivation                  | {{PREFIX_DERIVATION_RATIONALE}}|

The MODEL task will use this prefix on every `@@map(...)` it emits inside this plugin's fragment. The CHANGE-REQUEST task will respect it whenever it adds or renames a model.

## Deliverables

### 1. Scaffold the plugin

Run the generator in **non-interactive mode** — do not hand-build the directory tree, and do not use the interactive prompt (it blocks automation and review).

```bash
pnpm plugin:new --name {{MODULE_NAME}} --display "<Display Name>" --description "<one line from the PRD: what the plugin does>"
```

Tenants see the display name and description on the Plugins pages (they're synced to the `Plugin` row at every API start), so write them from the PRD, not as a placeholder.

Flags (see [scripts/generate-plugin.js](scripts/generate-plugin.js) `getPluginInfoFromArgs`):

- `--name` (required, kebab-case) — plugin slug; becomes the directory name and `@saas/plugin-<name>` package name.
- `--display` — human-readable display name (defaults to PascalCase of `--name`).
- `--description` — one-line description used in `package.json` and the admin UI.
- `--author`, `--email`, `--url` — package author metadata (defaults: `Developer` / `developer@neo-fusion.com` / project git URL).
- `--demo` — scaffold a sample entity + controller + service + page (omit for a minimal scaffold).
- `--resources "a,b,c"` — multi-resource scaffold; generates a module per resource.

Passing `--name` switches the script out of interactive mode, so it runs headlessly and exits non-zero on validation errors. The generator produces `plugins/{{MODULE_NAME}}/` with this structure:

```
plugins/{{MODULE_NAME}}/
├── package.json                      # name: @saas/plugin-{{MODULE_NAME}}; "exports" and "pluginManifest"
├── tsconfig.json                     # composite project (validated by plugins:register)
├── jest.config.ts, README.md, .gitignore
├── src/
│   ├── permissions.ts                # {{MODULE_NAME}}.{resource}.{action}
│   ├── dictionaries.ts               # en + id translations
│   ├── lifecycle.ts                  # onInstall/onActivate/onDeactivate/onUpgrade/healthCheck/getDefaultConfig
│   ├── events.ts                     # domain event names ({{MODULE_NAME}}.{entity}.{past-tense-verb})
│   ├── config.schema.ts              # the plugin's tenant settings (Zod, with defaults)
│   ├── api/
│   │   ├── index.ts                  # export NestJS modules
│   │   └── {{MODULE_NAME}}.module.ts # (+ controller/service/specs per resource with --resources)
│   ├── web/
│   │   ├── index.ts                  # {{ModuleName}}PluginRoutes map + page exports
│   │   ├── menus.ts                  # sidebar menu nodes
│   │   ├── pages/                    # page components
│   │   ├── components/               # plugin-scoped UI
│   │   └── lib/
│   └── database/
│       └── prisma/
│           └── fragment.prisma       # optional — tenant-schema models
```

The generator does not create `src/emails.ts`. If the PRD sends email, the SERVICE task adds it (see [SERVICE.md → Platform services](SERVICE.md#platform-services--use-these-dont-rebuild-them)).

- [ ] Plugin slug is kebab-case and unique across [plugins/](plugins/).
- [ ] Permission names in [plugins/{{MODULE_NAME}}/src/permissions.ts](plugins/{{MODULE_NAME}}/src/permissions.ts) follow `{{MODULE_NAME}}.{resource}.{action}` (see [plugins/sample-plugin/src/permissions.ts](plugins/sample-plugin/src/permissions.ts) for shape — name + description pairs).
- [ ] Dictionaries cover both `en` and `id` locales. Top-level namespace should be the plugin's camelCase name (see [plugins/sample-plugin/src/dictionaries.ts](plugins/sample-plugin/src/dictionaries.ts) for shape).

### 2. Fill in the Prisma fragment with the plugin's models

The generator emits a stub `plugins/{{MODULE_NAME}}/src/database/prisma/fragment.prisma`. Replace the stub with the plugin's actual tenant-scoped models derived from the PRDs in this module.

Fragment rules (see [plugins/sample-plugin/src/database/prisma/fragment.prisma](plugins/sample-plugin/src/database/prisma/fragment.prisma)):

- **Do not** include a `datasource` or `generator` block — the merge script will reject duplicates.
- **Do not** redefine any model from `header.prisma`. The merge validator rejects the reserved names (Tenant, User, Role, Permission, TenantConfig, AuditLog, AuditConfig, Plugin), and Prisma rejects any other duplicate (e.g. `TenantSubscription`) at `pnpm db:generate`.
- Model names use PascalCase; the Prisma delegate becomes camelCase (e.g. `SampleItem` → `client.sampleItem`).
- Every model needs `id String @id @default(uuid())`, `createdAt DateTime @default(now())`, and `updatedAt DateTime @updatedAt` unless there is a documented reason not to.
- Tenant-scoped models must **not** carry a `tenantId` column — schema-per-tenant already provides isolation.

After editing the fragment, validate the toolchain (these two commands are non-stateful — safe to run here):

```bash
pnpm plugins:merge-prisma   # merges plugin fragments into schema.prisma (non-interactive)
pnpm db:generate            # regenerates the Prisma client from the merged schema (non-interactive)
```

Do **not** run `pnpm db:migrate:dev` or `pnpm db:migrate:tenants` in this task. The user runs them manually after schema review (see [MODEL.md](.forge/task_templates/MODEL.md) scope). Include the exact migration commands in the task handoff, e.g.:

```bash
pnpm db:migrate:dev --name init-{{MODULE_NAME}} --skip-seed
pnpm db:migrate:tenants
```

- [ ] Fragment models follow the rules above and reflect the PRDs in this module.
- [ ] `pnpm plugins:merge-prisma` exits 0 and the merged `schema.prisma` contains the new model(s).
- [ ] `pnpm db:generate` exits 0 and the regenerated Prisma client exposes the expected camelCase delegates.
- [ ] Every new model's camelCase delegate is in `TenantModelKeys` in [packages/backend/src/prisma/tenant-prisma-client.ts](packages/backend/src/prisma/tenant-prisma-client.ts) (a model only ever read through the public client, like integration's `CalendarAccountIndex`, is the exception).
- [ ] No migration was created by this task — `git status packages/database/prisma/migrations/` shows no new folders.

### 3. Register the plugin with the application

- [ ] Run `pnpm plugins:register` — this regenerates both registries, the Tailwind `@source` directives, `tsconfig.dev.json` and the `transpilePackages` array.
- [ ] Check that `pnpm plugins:register` added `@saas/plugin-{{MODULE_NAME}}` to `transpilePackages` in [apps/web/next.config.js](apps/web/next.config.js) (Next.js cannot transpile workspace packages otherwise). Never edit that array by hand: the next registry run overwrites it.
- [ ] Verify the plugin appears in [apps/api/src/plugin-registry.ts](apps/api/src/plugin-registry.ts) `PluginModules`, `PluginPermissions`, `PluginLifecycles`, and `PluginList` arrays.
- [ ] Verify the plugin appears in [apps/web/lib/plugin-routes.ts](apps/web/lib/plugin-routes.ts) (`PluginRouteLoaders`), [plugin-menus.ts](apps/web/lib/plugin-menus.ts) (`PluginMenus`), [plugin-dictionaries.ts](apps/web/lib/plugin-dictionaries.ts) (`PluginDictionaries`), and in [tsconfig.dev.json](tsconfig.dev.json) `references`.
- [ ] Verify the `@source` directive for the plugin appears in [apps/web/app/globals.css](apps/web/app/globals.css) (without it Tailwind 4 will strip the plugin's CSS classes at build time).

### 4. Fill in the four plugin-level concerns (lifecycle, permissions, dictionaries)

Prisma models are handled in §2. The remaining three plugin-level files **must** be populated in this task:

| File | This task writes | Notes |
| --- | --- | --- |
| `src/lifecycle.ts` | `onInstall` / `onActivate` / `onDeactivate` bodies | Build a short-lived `PrismaClient` bound to `tenant_{ctx.tenantSlug}`; seed per-tenant defaults in `onInstall`, make `onActivate` idempotent, have `onDeactivate` only reverse reversible state. A throw from any of the three **cancels the switch**. See [plugins/sample-plugin/src/lifecycle.ts](plugins/sample-plugin/src/lifecycle.ts). Do **not** rely on NestJS DI inside lifecycle hooks, and do **not** grant permissions to roles (core gives them to `ADMIN` when the plugin is enabled). Leave the generated `onUpgrade` / `healthCheck` / `getDefaultConfig` stubs as they are unless the PRD needs them: `onUpgrade` runs only when an already-enabled plugin is enabled again after its `version` changed, never on deploy by itself. |
| `src/permissions.ts` | Full permission taxonomy | One entry per operation the plugin will eventually expose, named `{{MODULE_NAME}}.{resource}.{action}` with a human-readable description. Do **not** insert into the Permission table manually — the registry handles that per tenant. |
| `src/dictionaries.ts` | `en` + `id` entries | Top-level namespace = plugin's camelCase name. At minimum, cover every permission label and any string referenced by `lifecycle.ts`. |

### 5. Leave these placeholders untouched (deferred to the follow-up tasks)

The generator already emits stubs for the files below. **This task does not edit them.** Each is filled in by the follow-up task after the PRD is reviewed.

| File (generator-produced) | Status in this task | Filled in by |
| --- | --- | --- |
| `src/web/menus.ts` (placeholder menu tree) | leave as-is | MENUS task (sidebar IA from PRD) |
| `src/api/**` (placeholder module/controller/service/DTO) | leave as-is | API task (real endpoints + Zod schemas) |
| `src/web/**` except `menus.ts` (placeholder pages/components) | leave as-is | UI / MENUS tasks (real UI) |
| `src/config.schema.ts` (plugin settings) | leave as-is | SERVICE task, when the PRD defines tenant settings |
| `src/events.ts` (domain event names) | leave as-is | SERVICE task, when the PRD's operations emit events |

- [ ] Outside the four allowed files (`fragment.prisma`, `lifecycle.ts`, `permissions.ts`, `dictionaries.ts`), `git diff plugins/{{MODULE_NAME}}/src/` is empty relative to the generator's initial commit.

## Dependencies

- No prior tasks. All subsequent backend and frontend tasks depend on this task completing first.

## Acceptance Criteria

Scaffolding + the four plugin-level concerns only. Endpoint behavior, menu wiring, and UI are validated by the follow-up tasks, not here.

- [ ] `pnpm install` succeeds with the new plugin in the workspace.
- [ ] `pnpm build` succeeds.
- [ ] `pnpm dev` starts without the plugin causing import errors in API or Web.
- [ ] Plugin is wired into both registries (`apps/api/src/plugin-registry.ts`, `apps/web/lib/plugin-{routes,menus,dictionaries}.ts`) and appears in the admin Plugins list (`/plugins`).
- [ ] `pnpm plugins:merge-prisma` + `pnpm db:generate` succeed; no migration is created in this task (user runs `db:migrate:dev` / `db:migrate:tenants` manually).
- [ ] `fragment.prisma`, `lifecycle.ts`, `permissions.ts`, and `dictionaries.ts` contain real content driven by the PRD — not just the generator stubs.
- [ ] `git diff plugins/{{MODULE_NAME}}/src/` shows edits **only** to the four allowed files (`database/prisma/fragment.prisma`, `lifecycle.ts`, `permissions.ts`, `dictionaries.ts`); every other file under `src/` is byte-identical to the generator output.
- [ ] Outside the plugin, the only hand edit is the new models' entries in `TenantModelKeys` ([packages/backend/src/prisma/tenant-prisma-client.ts](packages/backend/src/prisma/tenant-prisma-client.ts)); everything else outside `plugins/{{MODULE_NAME}}/` changed only through `pnpm plugins:register` / `pnpm plugins:merge-prisma`.
