# Task: Build Verification — {{MODULE_NAME}}

## Overview

| Field      | Value                                                                                   |
| ---------- | --------------------------------------------------------------------------------------- |
| Module     | {{MODULE_NAME}}                                                                         |
| Task Type  | Build Verification                                                                      |
| Order      | **Runs LAST** — after every PRD's NEW-MODULE, MODEL, REPOSITORY, SERVICE, API, UI, MENUS tasks |
| Depends On | All prior tasks in every PRD folder for this module                                     |

## Objective

Verify that the whole workspace still installs, type-checks, and builds cleanly after every generated task landed. When a command fails, read the diagnostic, identify the **source file** the compiler is pointing at, and apply the minimum fix there. Re-run the same command. Repeat until every check exits 0.

This task is the final safety net — every prior task was told to run `pnpm build` as part of its acceptance criteria, so any failure here is either (a) an interaction between tasks that each passed in isolation, or (b) a stale generated artifact. It is **not** a license to rewrite the prior tasks' output.

Lint (`pnpm lint`) and tests (`pnpm test`) are **deliberately out of scope** for this task — they're run separately by the developer / CI. This task is only the compile + build gate.

## Scope — STRICT

> **This task fixes compile / type errors in the exact files the compiler points at.** It does not rewrite the pipeline's deliberate output, and it does not paper over errors with suppression pragmas.

### In scope (do these)

- Run the verification command sequence below and capture stdout/stderr/exit code for each.
- When a step fails, open the **file the diagnostic names**, understand the error, and apply the smallest fix that makes the diagnostic go away without masking anything else.
- Re-run the failing command after each fix. Do not move on until it exits 0.
- If a failure is caused by a missing generated artifact (stale registry, unmerged Prisma fragment), re-run the appropriate non-stateful regenerator (`pnpm plugins:register`, `pnpm plugins:merge-prisma`, `pnpm db:generate`) before calling it a code bug.

### Out of scope — HARD STOP if encountered

- **Do not** run `pnpm lint` or `pnpm test` in this task — they are explicitly out of scope. If a prior task left a lint violation or failing test behind, that belongs to a separate follow-up; do not chase it here.
- **Do not** run any `pnpm db:migrate:*` command. Migrations are the user's manual step (see [MODEL.md](.forge/task_templates/MODEL.md) scope). If a type / build failure is downstream of an unapplied migration, stop and surface the exact command text the user must run.
- **Do not** silence errors with `@ts-ignore`, `@ts-expect-error`, `any`, `// prettier-ignore`, `|| true`, `--force`, or `--no-verify`.
- **Do not** relax compiler options (`strict`, `noImplicitAny`, `strictNullChecks`) in any `tsconfig.json` to dodge a type error. If the strictness is wrong, that's a separate, explicit ticket.
- **Do not** modify generated files by hand: [apps/api/src/plugin-registry.ts](apps/api/src/plugin-registry.ts), [apps/web/lib/plugin-routes.ts](apps/web/lib/plugin-routes.ts), [plugin-menus.ts](apps/web/lib/plugin-menus.ts), [plugin-dictionaries.ts](apps/web/lib/plugin-dictionaries.ts), [tsconfig.dev.json](tsconfig.dev.json), [packages/database/prisma/schema.prisma](packages/database/prisma/schema.prisma), [packages/database/generated/](packages/database/generated/), the `@source` directives block in [apps/web/app/globals.css](apps/web/app/globals.css), or the `transpilePackages` array in [apps/web/next.config.js](apps/web/next.config.js). Re-run the generator instead.
- **Do not** delete, rename, or reorganize files outside the ones named by the diagnostic. No "cleanup" refactors hidden in the build fix.
- **Do not** upgrade, downgrade, add, or remove dependencies in any `package.json` to dodge an error — unless the error is literally a missing dependency declaration that a prior task forgot to add. A plugin package missing from `transpilePackages` in `apps/web/next.config.js` is fixed by re-running `pnpm plugins:register`, which writes that array. If in doubt, surface instead of edit.
- **Do not** revert the pipeline's deliberate placeholders. Generator stubs in `src/api/` and `src/web/` (left untouched by NEW-MODULE) compile fine on their own; if they don't, the scaffold itself is broken — report that, don't rewrite the stubs.
- **Do not** run `prisma migrate reset`, `pnpm install --force`, `rm -rf node_modules`, or `git clean -fdx` as a "try the nuclear option" step.

If you find yourself about to touch a file outside the one the diagnostic points at, **stop** — that's a different task.

## Codebase Context

- Workspace config: [pnpm-workspace.yaml](pnpm-workspace.yaml), [turbo.json](turbo.json), root [package.json](package.json)
- Workspace globs: `apps/*`, `packages/*`, `plugins/*` — every package participates in the TurboRepo build graph
- TypeScript configs: [apps/api/tsconfig.json](apps/api/tsconfig.json), [apps/web/tsconfig.json](apps/web/tsconfig.json), [packages/backend/tsconfig.json](packages/backend/tsconfig.json), [packages/ui/tsconfig.json](packages/ui/tsconfig.json), [packages/database/tsconfig.json](packages/database/tsconfig.json), each plugin's `tsconfig.json`
- Registry generator (re-run, do not hand-edit output): [scripts/generate-registry.js](scripts/generate-registry.js)
- Prisma merge script (re-run, do not hand-edit output): [scripts/merge-prisma-schemas.js](scripts/merge-prisma-schemas.js)
- Next.js transpile list (plugin packages must appear here): [apps/web/next.config.js](apps/web/next.config.js)
- Reference of a compiling plugin: [plugins/sample-plugin/](plugins/sample-plugin/)

## Procedure

### Step 0 — Install

```bash
pnpm install --frozen-lockfile
```

Use `--frozen-lockfile` — the pipeline must not silently update the lockfile. If install fails because the lockfile is stale (a new plugin package wasn't registered, a prior task forgot to run `pnpm install` after adding a dep), **surface that** and run a plain `pnpm install` to bring the lockfile in sync, then commit the lockfile as part of the fix.

- [ ] `pnpm install --frozen-lockfile` exits 0.

### Step 1 — Regenerate derived files (non-stateful, always safe)

A stale registry, an unmerged Prisma fragment or a missing Prisma client is the #1 cause of false-positive build failures after a pipeline run. Regenerate before building so the rest of the procedure isn't chasing phantoms. (`pnpm build` also generates the client itself: the `@saas/database` build runs `prisma generate` before `tsc`.)

```bash
pnpm plugins:merge-prisma       # merges plugin fragments into schema.prisma
pnpm db:generate                # regenerates the Prisma client from the merged schema
pnpm plugins:register           # regenerates apps/api + apps/web registries and Tailwind @source directives
```

All three are pure file rewrites — they do not touch the database. If any fails, that **is** the build error — fix the underlying file it complains about before continuing.

- [ ] `pnpm plugins:merge-prisma` exits 0 and the merged [packages/database/prisma/schema.prisma](packages/database/prisma/schema.prisma) contains every plugin fragment's models.
- [ ] `pnpm db:generate` exits 0 and the regenerated Prisma client under [packages/database/generated/](packages/database/generated/) exposes the expected camelCase delegates.
- [ ] `pnpm plugins:register` exits 0; [apps/api/src/plugin-registry.ts](apps/api/src/plugin-registry.ts) and [apps/web/lib/plugin-routes.ts](apps/web/lib/plugin-routes.ts), [plugin-menus.ts](apps/web/lib/plugin-menus.ts), [plugin-dictionaries.ts](apps/web/lib/plugin-dictionaries.ts), [tsconfig.dev.json](tsconfig.dev.json) reference every plugin, and [apps/web/app/globals.css](apps/web/app/globals.css) has an `@source` directive per plugin.

### Step 2 — Build

```bash
pnpm build
```

TurboRepo builds every workspace in dependency order: `@saas/database` → `@saas/backend` → `@saas/ui` → every `@saas/plugin-*` → `apps/api` → `apps/web`. A failure in an upstream package cascades — **fix the upstream error first**, not the downstream symptom.

Common failure modes (in order of frequency after a pipeline run):

| Symptom | Root cause | Fix |
| --- | --- | --- |
| `Cannot find module '@saas/plugin-{{MODULE_NAME}}'` in `apps/web` | Plugin package missing from `transpilePackages` in [apps/web/next.config.js](apps/web/next.config.js) | Re-run `pnpm plugins:register` (it writes the array). |
| `Cannot find module '../generated/client/index'` in `@saas/database` | Prisma client not generated (its build script, `prisma generate && tsc`, was changed or skipped) | Run `pnpm db:generate`, and check `packages/database/package.json`'s `build` script. |
| `Property 'xxx' does not exist on type 'PrismaClient'` | Fragment merged but client not regenerated | Re-run `pnpm db:generate`. |
| `Property 'xxx' does not exist on type 'TenantPrismaClient'` | A new plugin model isn't in `TenantModelKeys` | Add its camelCase delegate to `TenantModelKeys` in [packages/backend/src/prisma/tenant-prisma-client.ts](packages/backend/src/prisma/tenant-prisma-client.ts) — the one fix outside the file the compiler names. MODEL task gap: flag it. |
| `Cannot find module './dto/xxx'` inside a plugin | DTO file expected by the module wasn't created | Open the importing file and decide: missing DTO (API task gap — report), or a wrong import path (fix the path). |
| `Module not found: @saas/backend/xxx` | Barrel export in [packages/backend/src/index.ts](packages/backend/src/index.ts) missing the symbol | Add the missing `export * from './xxx'` line — but only if the symbol is genuinely there. |
| Plugin page 404s / `PluginRouteLoaders[{{MODULE_NAME}}]` is undefined | Stale web registry | Re-run `pnpm plugins:register`. |
| Tailwind classes stripped from a plugin's pages | Missing `@source` in `apps/web/app/globals.css` | Re-run `pnpm plugins:register`; the generator writes the directive. |
| `Type 'X' is not assignable to type 'Y'` between a controller and its Zod DTO | Zod schema drifted from the TypeScript type | Align the Zod schema and the `z.infer<...>` consumer. Do not widen the type to `any`. |

- [ ] `pnpm build` exits 0 with zero errors and no new warnings that were errors in a prior run.

### Step 3 — Scope-escape check (required)

Before declaring success, confirm the fix stayed within scope:

```bash
# No suppressions reintroduced
grep -rn "@ts-ignore\|@ts-expect-error" apps/ packages/ plugins/

# No pipeline placeholders reintroduced
grep -rn "TODO(page-task)\|data-placeholder=" plugins/{{MODULE_NAME}}/src/web/

# Diff is bounded to real source fixes — no generated files, no tsconfig strictness relaxation
git diff --stat
```

- [ ] First `grep` returns no new hits vs. the pre-task baseline.
- [ ] Second `grep` returns no hits.
- [ ] `git diff` does **not** include [apps/api/src/plugin-registry.ts](apps/api/src/plugin-registry.ts), [apps/web/lib/plugin-routes.ts](apps/web/lib/plugin-routes.ts), [plugin-menus.ts](apps/web/lib/plugin-menus.ts), [plugin-dictionaries.ts](apps/web/lib/plugin-dictionaries.ts), [tsconfig.dev.json](tsconfig.dev.json), [packages/database/prisma/schema.prisma](packages/database/prisma/schema.prisma), [packages/database/generated/](packages/database/generated/), or a change to any `tsconfig.json` beyond what a prior task explicitly needed.

### Step 4 — If you've run out of options

If you cannot get a step to exit 0 within a reasonable number of attempts, **stop and report**. Do not hand-patch the symptom. The handoff must include:

- The exact failing command.
- The full error message (stderr tail).
- The file(s) the diagnostic pointed at and what you tried.
- The task in the pipeline (NEW-MODULE / MODEL / REPOSITORY / SERVICE / API / UI / MENUS) that likely produced the offending output, so the right prior task can be re-run.

A clean "this is broken because prior task X didn't do Y" is more useful than a green build produced by silencing the compiler.

## Deliverables

- [ ] `pnpm install --frozen-lockfile` exits 0 — lockfile is in sync with every workspace's dependencies.
- [ ] Step 1 regenerators ran clean: `pnpm plugins:merge-prisma`, `pnpm db:generate`, `pnpm plugins:register` all exit 0.
- [ ] `pnpm build` exits 0 across every workspace in the TurboRepo graph.
- [ ] `pnpm lint` and `pnpm test` were **not** run as part of this task — they are out of scope.
- [ ] Every fix is a minimum-diff change to the file the compiler pointed at. No cross-cutting refactors, no "while I'm here" edits.
- [ ] No `@ts-ignore` / `@ts-expect-error` added anywhere.
- [ ] No `tsconfig.json` strictness relaxation.
- [ ] No `pnpm db:migrate:dev` / `pnpm db:migrate:deploy` / `pnpm db:migrate:tenants` / `prisma migrate reset` / `prisma db push` invoked.
- [ ] No hand-edit to generated files (registries, merged Prisma schema, generated client, `@source` block).

## Acceptance Criteria

- [ ] A fresh clone followed by `pnpm install --frozen-lockfile && pnpm build` exits 0 without further intervention (what CI runs).
- [ ] The pipeline's deliberate placeholders (generator stubs, optional API/web leftovers from NEW-MODULE) are preserved byte-for-byte — `git diff` against the pre-task state shows edits **only** to the files the compiler specifically flagged.
- [ ] Any remaining issue that would require running a migration, changing an `@Permissions(...)` decorator, adding a dictionary key, scaffolding a missing page, or editing a Prisma fragment is surfaced in the handoff with the exact command or prior task that must re-run — never "fixed" silently in this task.
- [ ] If the build was already green before this task started, the task still captured the output of every step as evidence the check was performed.
- [ ] Follows the conventions of the prior task templates: same scope-strict shape, same non-stateful command policy, same treatment of generated files as read-only.
