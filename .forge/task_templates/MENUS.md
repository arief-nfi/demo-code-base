# Task: Menu, Routing & Navigation

## Overview

| Field      | Value                                                                         |
| ---------- | ----------------------------------------------------------------------------- |
| PRD        | {{PRD_CODE}}-{{PRD_NAME}}                                                     |
| Task Type  | Menu / Route / Navigation (verification & wiring)                             |
| Order      | Runs after NEW-MODULE, MODEL, API, and every UI screen task                   |
| Depends On | All prior tasks in this PRD (NEW-MODULE, MODEL, API, every UI screen)         |

## Objective

This task runs **last**, after every page, dialog, and backend for PRD-{{PRD_CODE}}-{{PRD_NAME}} already exists in the codebase. Its job is to **verify and wire** — not to create. Specifically:

- Verify that every screen listed in the PRD has been implemented by the prior UI task(s) under `plugins/{{MODULE_NAME}}/src/web/pages/...`.
- Wire those existing pages into `plugins/{{MODULE_NAME}}/src/web/menus.ts` (sidebar tree with per-node `permissions`) and the `{{ModuleName}}PluginRoutes` map in `plugins/{{MODULE_NAME}}/src/web/index.ts` (what the dynamic plugin route resolves against).
- Verify that the permissions referenced by the menu tree exist in `permissions.ts`. Core seeds them and grants them to `ADMIN` when the plugin is enabled; tenant admins give them to other roles (`USER` starts with none).
- Run `pnpm plugins:register` and verify the generated `apps/web/lib/plugin-{routes,menus,dictionaries}.ts` reflects the menu + route set.
- Walk every sidebar entry and deep link in the running app to confirm the correct page renders and RBAC hides/denies it as expected.

If a screen is **missing** or a page is still a placeholder, **stop** and report it — do not fill the gap here. That is the UI task's responsibility.

## Scope — STRICT

> **Verification and wiring only.** This task does not create, rewrite, or edit any page, dialog, component, DTO, service, controller, Zod schema, Prisma model, or permission. Those belong to the earlier tasks in the PRD and should already be in place when this task runs. The one dictionary change it makes is the sidebar labels: the `{{moduleKey}}.menu.*` keys its own tree uses.

### In scope (do these)

- Edit `plugins/{{MODULE_NAME}}/src/web/menus.ts` to declare the finished menu tree: group, icons (`lucide-react`), `href` values, and per-node `permissions`.
- Add the tree's labels to `plugins/{{MODULE_NAME}}/src/dictionaries.ts` under `{{moduleKey}}.menu.*`, in **both** `en` and `id` (see [Localized Menu Names](#localized-menu-names--strict)). Reuse a key that already exists; add nothing outside `menu.*`.
- Edit `plugins/{{MODULE_NAME}}/src/web/index.ts` so `{{ModuleName}}PluginRoutes` maps every sub-path the menu links to (and every deep-link target) to its page, so the dynamic route `app/(dashboard)/plugins/[slug]/[...rest]/page.tsx` can resolve it.
- Verify the screens from the PRD are present under `plugins/{{MODULE_NAME}}/src/web/pages/...` — count, filenames, and export names match the menu entries.
- Verify every permission referenced by a `MenuNode` is declared in `plugins/{{MODULE_NAME}}/src/permissions.ts` (and is not bound to roles in `lifecycle.ts` — core does that for `ADMIN`).
- Verify the URLs read well as breadcrumbs: the header builds the trail from the URL (see Breadcrumbs below).
- Run `pnpm plugins:register` and verify [apps/web/lib/plugin-routes.ts](apps/web/lib/plugin-routes.ts), [plugin-menus.ts](apps/web/lib/plugin-menus.ts), [plugin-dictionaries.ts](apps/web/lib/plugin-dictionaries.ts) picks up the updated menus + routes.
- Manually walk each sidebar entry and deep link in `pnpm dev` to confirm the correct page renders; confirm RBAC hides entries from users without permission and shows `<Forbidden />` for deep-linked URLs when unauthorized.

### Out of scope — HARD STOP if encountered

- **Do not** create any file under `plugins/{{MODULE_NAME}}/src/web/pages/` or `src/web/components/`. If a required screen doesn't exist yet, the UI task is incomplete — report it instead of scaffolding a placeholder.
- **Do not** edit the body of any existing page / dialog / component (no data-fetching changes, no form edits, no styling tweaks).
- **Do not** add, remove, or rename entries in `permissions.ts`. If the menu tree needs a permission that isn't declared, go back to the plugin-setup / earlier tasks — do not silently invent one here.
- **Do not** add or change keys in `dictionaries.ts` outside `{{moduleKey}}.menu.*`. If a page label has no translation, that's a UI-task defect; flag it, don't fix it here.
- **Do not** edit API code, Prisma models, migrations, lifecycle bodies, or any file outside `src/web/menus.ts` and `src/web/index.ts`.
- **Do not** run `pnpm db:migrate:*` — migrations are the user's manual step.

If you find yourself about to write JSX, run a migration, or touch `permissions.ts` / `dictionaries.ts` (beyond `menu.*`) / `lifecycle.ts` / `src/api/**` / `src/web/pages/**` / `src/web/components/**` in this task, **stop** and surface the gap in the handoff.

### Preflight check — the prior tasks must be done

Before editing anything, confirm:

- [ ] Every screen in "Screens in This PRD" exists as a real (non-placeholder) file under `plugins/{{MODULE_NAME}}/src/web/pages/...` with actual UI, data fetching, forms, etc.
- [ ] `grep -rn "TODO(page-task)\|data-placeholder=" plugins/{{MODULE_NAME}}/src/web/` returns no hits (all placeholders replaced by the UI task).
- [ ] `permissions.ts` declares every permission referenced by the planned menu tree.

If any preflight fails, **stop** and report. Do not proceed with wiring on top of an incomplete build.

## Codebase Context

- Plugin route resolver (catch-all): `apps/web/app/(dashboard)/plugins/[slug]/[...rest]/page.tsx`
- Web registry (auto-generated — do not hand-edit): [apps/web/lib/plugin-routes.ts](apps/web/lib/plugin-routes.ts), [plugin-menus.ts](apps/web/lib/plugin-menus.ts), [plugin-dictionaries.ts](apps/web/lib/plugin-dictionaries.ts)
- Reference plugin menus: [plugins/sample-plugin/src/web/menus.ts](plugins/sample-plugin/src/web/menus.ts)
- Registry generator: [scripts/generate-registry.js](scripts/generate-registry.js)
- Admin layout and sidebar: [apps/web/components/admin-layout.tsx](apps/web/components/admin-layout.tsx), [apps/web/components/sidebar.tsx](apps/web/components/sidebar.tsx)
- Breadcrumbs (automatic, from the URL): [apps/web/components/breadcrumbs.tsx](apps/web/components/breadcrumbs.tsx)
- Page header: `PageHeader` from [@saas/ui](packages/ui/src/components/page-header.tsx) (`title`, `description`, `children` for action buttons, `backUrl`)
- Auth-gating: [apps/web/proxy.ts](apps/web/proxy.ts) (no session → `/login`) and [apps/web/components/session-gate.tsx](apps/web/components/session-gate.tsx) (loads `/auth/me` before any dashboard page renders)

## Screens in This PRD

{{SCREEN_LIST}}

## Screen Flow Reference

{{SCREEN_FLOW}}

## Menu Entries

Menus are exported from `plugins/{{MODULE_NAME}}/src/web/menus.ts` as an array of `MenuNode` objects. **Every `name` field MUST be a dictionary path (i18n key), not a literal display string** — see the [Localized menu names](#localized-menu-names--strict) section below for the full rule. Shape:

```ts
// plugins/{{MODULE_NAME}}/src/web/menus.ts
//
// Menu names are i18n keys, not display strings. The sidebar passes each
// `name` through `useLanguage().t(...)` at render time. Keep the keys in
// sync with `{{moduleKey}}.menu.*` in `src/dictionaries.ts`.
import { Box, Settings } from 'lucide-react';

export const {{CamelCaseName}}PluginMenus = [
  {
    name: '{{moduleKey}}.menu.parent',                   // i18n key — defined in dictionaries.ts
    icon: Box,                                           // lucide-react icon
    permissions: ['{{MODULE_NAME}}.{{RESOURCE}}.read'],  // hide whole group if user lacks this
    children: [
      {
        name: '{{moduleKey}}.menu.{{resource}}',         // i18n key
        href: '/plugins/{{MODULE_NAME}}/{{subpath}}',
        icon: Box,
        permissions: ['{{MODULE_NAME}}.{{RESOURCE}}.read'],
      },
      // ...
    ],
  },
];
```

Rules:

- The **group** (top-level entry) uses the broadest read-permission so the group disappears when the user has no access at all.
- Each **child** declares its own `permissions` array — a user sees only the children they're allowed to reach.
- Icons come from `lucide-react` **only** — import what you use.
- Group-level `href` is optional; prefer child entries over a clickable parent.
- **Every `name` is a dictionary path** (`{{moduleKey}}.menu.<key>`) — never a literal label, never a `t(...)` call inside the export. The sidebar resolves the path at render time.

Define your entries here:

{{MENU_ENTRIES}}

### Post-edit step

After editing `menus.ts`, run:

```bash
pnpm plugins:register
```

This regenerates `apps/web/lib/plugin-menus.ts` so `PluginMenus['{{MODULE_NAME}}']` picks up the change. The sidebar picks them up on next reload.

## Route Definitions

Plugin pages **do not** have explicit route files. The dynamic route `app/(dashboard)/plugins/[slug]/[...rest]/page.tsx` loads the plugin's route map lazily via `PluginRouteLoaders[slug]` in `apps/web/lib/plugin-routes.ts` (generated: `import('@saas/plugin-{{MODULE_NAME}}/web').then((m) => m.{{ModuleName}}PluginRoutes)`) and picks the page whose key matches the sub-path. The map lives in `plugins/{{MODULE_NAME}}/src/web/index.ts`; copy [plugins/sample-plugin/src/web/index.ts](plugins/sample-plugin/src/web/index.ts):

```ts
export const {{ModuleName}}PluginRoutes = {
  '/items':           ItemsPage,        // /plugins/{{MODULE_NAME}}/items
  '/items/new':       ItemCreatePage,   // a full page; a small form is usually a Dialog on ItemsPage instead
  '/items/[id]':      ItemDetailPage,   // `[id]` arrives as params.id
  '/items/[id]/edit': ItemEditPage,
};
export * from './pages/items/ItemsPage';   // and the other pages
```

- An exact key wins; otherwise keys with `[param]` segments match and the values arrive in the page's `params` prop (`params.id`).
- The export name **must** be `{{ModuleName}}PluginRoutes` (PascalCase of the plugin, as the generator emits it): that's what the generated loader reads.
- Dialogs are never keys in this map.

| Screen          | Route Path | Registered Component | Required Permissions |
| --------------- | ---------- | -------------------- | -------------------- |
| {{ROUTE_TABLE}} |            |                      |                      |

For **system/core** screens (not plugin-owned), the route lives under `app/(dashboard)/systems/...` — but this is for core code only, not PRDs targeting a plugin.

## Navigation Flow

Describe navigation paths between screens — what triggers navigation (button click, table row, after-save redirect, back button, breadcrumb click). Plugin pages can't import `next/*`: every in-app navigation goes through the `onNavigate(path)` prop the host injects (see [UI.md → Navigation](UI.md#navigation--strict)); use a plain `<a href>` only for external links.

{{NAVIGATION_FLOW}}

## Breadcrumbs

Pages don't render breadcrumbs. The app header ([apps/web/components/breadcrumbs.tsx](apps/web/components/breadcrumbs.tsx)) builds the trail from the URL: one crumb per path segment, linking to that prefix. Each label comes from core's `routeLabels` ([apps/web/config/navigation.ts](apps/web/config/navigation.ts)) or else the capitalized segment (`sample-plugin` → "Sample plugin"), and id-like segments show as "Details". `PageHeader` has no `breadcrumbs` prop.

So the trail is designed through the URL: pick sub-paths that read well (`/plugins/{{MODULE_NAME}}/items/[id]/edit` → Plugins › … › Items › Details › Edit). These labels aren't translated, so don't add dictionary keys for them.

Define the URL trail for each screen here:

{{BREADCRUMBS}}

## Access Control (Route + Menu)

- **Menu visibility** — `permissions` on the `MenuNode` hides the entry. No separate "route guard" is needed for visibility.
- **Route protection** — [apps/web/proxy.ts](apps/web/proxy.ts) sends visitors without a session to `/login`, and `SessionGate` loads `/auth/me` (roles, permissions) before any dashboard page renders, so `useRBAC()` is ready on first render. The API's 401/403 are the second line of defense; the `apiClient` handles them automatically.
- **Per-page permission check** — call `useRBAC().authorize({ permissions: [...] })` at the top of the page. If false, render `<Forbidden />` from `@saas/ui` instead of a redirect (redirects are jarring for permission denials on deep links).
- **Tenant status** — SUSPENDED/TERMINATED tenants get a 403 from the API, and the apiClient redirects to `/tenant-suspended`. No per-page work needed.

Document the gating for each screen:

{{ACCESS_CONTROL}}

## Deep Linking & URL Patterns

Deep links work natively via Next.js dynamic segments. The plugin catch-all receives the tail path under `rest`. When implementing:

- Give each sub-screen its own key in `{{ModuleName}}PluginRoutes` (`'/items/[id]'`) and read the values from the `params` prop
- After a mutation that changes "which sub-screen is current", go to its URL with `onNavigate(path)` so back-button and bookmarking work (plugins have no `router.replace`)
- Do **not** use query-string state for primary navigation (use it for filters/sort only)

{{DEEP_LINKS}}

## Localized Menu Names — STRICT

> **Every `name` field in `menus.ts` is a dictionary path (`{{moduleKey}}.menu.<key>`). Never a literal display string. Never a `t(...)` call. The sidebar component resolves each `name` through `useLanguage().t(...)` at render time, so the menu file stays a static export the registry generator can scan.**

### Why a path, not a literal, not `t(...)`

- **Why not a literal** (`name: 'Sample Items'`): the literal renders verbatim in every locale — no Indonesian, no future locales — and the codebase rule for visible strings (see UI.md → Internationalization — STRICT) forbids hardcoded English in user-facing UI. Menus are user-facing.
- **Why not `t('...')` inside the export**: `menus.ts` is evaluated at **module load** (it's a top-level array literal scanned by `pnpm plugins:register`). At that point the `LanguageProvider` doesn't exist and there is no React component context to call `t` from. Even if it did, the locale switch would not re-evaluate `menus.ts` — the menu would freeze on whichever locale was active at first load.
- **Why a path string works**: the string is just an identifier in the array. The sidebar (a real React component) calls `t(item.name)` per render — locale switches re-render and the label updates. If a key is missing the `t()` implementation returns the path verbatim ([packages/ui/src/components/language-provider.tsx](packages/ui/src/components/language-provider.tsx)), so missing translations are visible but non-fatal.

### Required dictionary keys

Add these under your plugin's namespace in `plugins/{{MODULE_NAME}}/src/dictionaries.ts`, **symmetric in `en` and `id`** (per the existing UI i18n rule):

```ts
{{moduleKey}}: {
  menu: {
    parent: '{{Plugin Display Name}}',     // group label
    {{resource}}: '{{Resource Display}}',  // one entry per child item
    // ...
  },
  // ... other namespaces (items, articles, settings, etc.)
}
```

Mirror the same keys in `id` with the Indonesian translation. Missing-locale entries are caught by the existing i18n checklist in UI.md.

### Reference plugin

[plugins/sample-plugin/src/web/menus.ts](plugins/sample-plugin/src/web/menus.ts) sets every `name` to `samplePlugin.menu.{parent,items,articles,settings}`. The matching dictionary block lives in [plugins/sample-plugin/src/dictionaries.ts](plugins/sample-plugin/src/dictionaries.ts) under `samplePlugin.menu`. Copy the shape.

### Forbidden patterns

```ts
// ❌ Literal display string — never localizable
{ name: 'Sample Items', href: '...', icon: Box }

// ❌ Inline t() call — wrong execution context, breaks locale switching
{ name: t('samplePlugin.menu.items'), href: '...', icon: Box }

// ❌ Helper that returns localized text at module load
{ name: getMenuLabel('items'), href: '...', icon: Box }

// ❌ Object with a label/key split — not the convention; the renderer expects a string
{ name: { key: 'samplePlugin.menu.items' }, href: '...', icon: Box }
```

### Correct pattern

```ts
{ name: 'samplePlugin.menu.items', href: '/plugins/sample-plugin/items', icon: Box,
  permissions: ['sample-plugin.item.read'] }
```

### Other navigation labels

- **Breadcrumbs** — built by the header from the URL (see Breadcrumbs above); nothing to translate in the plugin.
- **Page titles** — `<PageHeader title={t('{{moduleKey}}.{{resource}}.title')} />`. Same React-component context, same rule.
- **Sub-menus rendered by a page itself** (tabs, in-page nav) — call `t(...)` inside the component as usual.

The static-array-evaluated-at-module-load constraint applies **only** to `menus.ts`. Everywhere else, call `t(...)` directly.

### Checklist

- [ ] `grep -nE "name: '[A-Z]" plugins/{{MODULE_NAME}}/src/web/menus.ts` returns **no** matches (no literal English title-case strings).
- [ ] `grep -n "t(" plugins/{{MODULE_NAME}}/src/web/menus.ts` returns **no** matches (no `t(...)` calls in the export).
- [ ] Every `name` in `menus.ts` resolves to an existing key under `{{moduleKey}}.menu.*` in **both** `en` and `id` blocks of `dictionaries.ts`.
- [ ] After the locale toggle in the dashboard switches between English and Indonesian, every menu label updates without a page refresh.

## Deliverables

### Preflight verification (before any edits)

- [ ] Every screen in "Screens in This PRD" is implemented as real (non-placeholder) UI under `plugins/{{MODULE_NAME}}/src/web/pages/...`
- [ ] `grep -rn "TODO(page-task)\|data-placeholder=" plugins/{{MODULE_NAME}}/src/web/` returns no hits
- [ ] Every permission referenced by the planned menu tree already exists in `plugins/{{MODULE_NAME}}/src/permissions.ts`

### Wiring (the only edits this task makes)

- [ ] `plugins/{{MODULE_NAME}}/src/web/menus.ts` declares the full menu tree: top-level group, children, icons (`lucide-react`), `href`s under `/plugins/{{MODULE_NAME}}/...`, and per-node `permissions`
- [ ] `{{ModuleName}}PluginRoutes` in `plugins/{{MODULE_NAME}}/src/web/index.ts` maps every sub-path the menu links to (and every deep-link target) to its page
- [ ] `pnpm plugins:register` executed — [apps/web/lib/plugin-routes.ts](apps/web/lib/plugin-routes.ts), [plugin-menus.ts](apps/web/lib/plugin-menus.ts), [plugin-dictionaries.ts](apps/web/lib/plugin-dictionaries.ts) reflects the updated menu + route set; no stale entries remain

### Verification (after wiring)

- [ ] Every sidebar entry in `pnpm dev` navigates to its intended page (no 404s, no blank screens)
- [ ] Every deep link works on direct entry (no redirect to login for an already-authenticated user)
- [ ] RBAC hides menu entries from users without the listed permission and shows `<Forbidden />` on deep-linked URLs when unauthorized
- [ ] The header's breadcrumb trail for each URL reads sensibly and links back to its parents

### Hard restrictions

- [ ] `git diff` in this task touches **only** `plugins/{{MODULE_NAME}}/src/web/menus.ts`, `plugins/{{MODULE_NAME}}/src/web/index.ts`, the `{{moduleKey}}.menu.*` entries of `plugins/{{MODULE_NAME}}/src/dictionaries.ts`, and files `pnpm plugins:register` regenerates
- [ ] No file under `plugins/{{MODULE_NAME}}/src/web/pages/`, `src/web/components/`, or `src/api/` was created, renamed, or edited by this task
- [ ] No entries added/removed in `permissions.ts`, `lifecycle.ts`, or any Prisma fragment, and none in `dictionaries.ts` outside `{{moduleKey}}.menu.*`
- [ ] No `pnpm db:migrate:*` invoked

## Acceptance Criteria

- [ ] Preflight passed: every screen is real and every referenced permission already exists before this task started editing
- [ ] Every menu label exists under `{{moduleKey}}.menu.*` in both `en` and `id`
- [ ] Menu entries appear in the sidebar for users with the required permissions and are hidden for users without them
- [ ] Clicking each menu item navigates to the correct URL and lands on a real page (not a placeholder, not a 404)
- [ ] Direct URL entry (deep link) loads the correct screen without requiring a full re-auth
- [ ] Unauthorized deep-link access shows `<Forbidden />` (not a blank screen, not a redirect to a generic error)
- [ ] After `pnpm plugins:register`, no stale menu or route entries remain in `apps/web/lib/plugin-{routes,menus,dictionaries}.ts`
- [ ] `grep -rn "TODO(page-task)\|data-placeholder=" plugins/{{MODULE_NAME}}/src/web/` still returns no hits (this task didn't reintroduce placeholders)
- [ ] `git diff` in this task is confined to `menus.ts`, `index.ts`, the `menu.*` dictionary entries, and auto-generated files — no other files changed
- [ ] `pnpm build` + `pnpm lint` pass
- [ ] Follows the conventions of [plugins/sample-plugin/src/web/menus.ts](plugins/sample-plugin/src/web/menus.ts) and `src/web/index.ts`
