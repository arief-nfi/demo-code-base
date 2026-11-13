# Task: UI Screen — {{SCREEN_NAME}}

## Overview

| Field          | Value                      |
| -------------- | -------------------------- |
| PRD            | {{PRD_CODE}}-{{PRD_NAME}}  |
| Task Type      | Next.js Page / Screen      |
| Screen         | {{SCREEN_NAME}}            |
| UI Design File | {{UI_FILE}}                |
| Depends On     | 04-TASK-API |

## Objective

Implement the **{{SCREEN_NAME}}** screen for PRD-{{PRD_CODE}}-{{PRD_NAME}} as either a **page** or a **dialog component** in the plugin's `src/web/` tree (see the decision rule directly below). The artifact must match the UI design reference, connect to the backend via `@saas/ui`'s typed API hooks, enforce RBAC, localize via `useLanguage()`, and follow this codebase's component conventions.

## Component Kind — STRICT Decision

> **This is a mechanical decision based on the inputs — do not override it.** Match case-insensitively.
>
> If `{{SCREEN_NAME}}` **or** `{{UI_FILE}}` contains the substring `dialog` (e.g. `CreateItemDialog`, `delete-user-dialog.html`, `Invoice Dialog`) → build a **Dialog component**.
>
> Otherwise → build a **Page**.

Reference for each kind (sample plugin):

- Page: [plugins/sample-plugin/src/web/pages/sample-items/SampleItemPage.tsx](plugins/sample-plugin/src/web/pages/sample-items/SampleItemPage.tsx)
- Dialog: [plugins/sample-plugin/src/web/pages/sample-items/SampleItemDialog.tsx](plugins/sample-plugin/src/web/pages/sample-items/SampleItemDialog.tsx)

### If this is a Page

- File: `plugins/{{MODULE_NAME}}/src/web/pages/{{DIR}}/{{ScreenName}}.tsx`
- Registered: a key in `{{ModuleName}}PluginRoutes` in `plugins/{{MODULE_NAME}}/src/web/index.ts` (`'/{{DIR}}'`, `'/{{DIR}}/[id]'`, …) plus an `export *` of the file, so the dynamic plugin route resolves it.
- Menu: a corresponding entry MUST exist in `plugins/{{MODULE_NAME}}/src/web/menus.ts` (added by the MENUS task). Each menu entry's `name` is a dictionary path (e.g. `'{{moduleKey}}.menu.{{resource}}'`) — the sidebar resolves it through `t(...)` at render time. See [MENUS.md → Localized Menu Names](MENUS.md#localized-menu-names--strict) for the full rule. Do NOT replace those paths with literal strings or `t(...)` calls if you encounter them while doing UI work.
- Shell: wraps content in `<PageContainer>` + `<PageHeader title={…} description={…}>{action buttons}</PageHeader>`. Breadcrumbs are automatic (the app header builds them from the URL); `PageHeader` has no `breadcrumbs` or `actions` prop.
- RBAC: top-of-component `useRBAC().authorize({ permissions: [...] })` with `<Forbidden />` fallback.
- Owns data fetching for the screen (`useApi` / `usePaginatedApi`).

### If this is a Dialog component

- File: `plugins/{{MODULE_NAME}}/src/web/pages/{{DIR}}/{{ScreenName}}.tsx` (same folder as the parent page by convention; see the sample `SampleItemDialog.tsx` co-located with `SampleItemPage.tsx`).
- Registered: **not** exported from `src/web/index.ts` and **not** added to `menus.ts` — dialogs have no route and no sidebar entry. They are imported directly by the parent page.
- Shell: `DialogRoot` + `DialogContent` + `DialogHeader/DialogTitle/DialogDescription/DialogFooter` from `@saas/ui`. **Do not** use `<PageContainer>` / `<PageHeader>` / breadcrumbs.
- Props contract (required): `{ isOpen: boolean; onClose: () => void; onSuccess?: () => void; ...domainProps }`. The parent owns open/close state and list refetch.
- No page-level RBAC gate. The parent page's `<Protect>` around the trigger button is the gate; the backend is the source of truth. If a dialog is reachable only with an elevated permission, wrap the **trigger** in `<Protect permissions={[...]}>`, not the dialog body.
- No data fetching for the parent's list — the dialog performs its own single-entity GET (edit/view) and submit mutations (POST/PUT/PATCH/DELETE), then calls `onSuccess()` so the parent can refetch.
- No breadcrumbs, no `<Forbidden />`, no full-page skeleton. Loading state lives on the submit button (spinner + disabled) and on any internal async field validators.
- Close behavior: call `onClose()` after a successful submit; `DialogRoot`'s `onOpenChange` should also call `onClose()` when the user hits Esc or clicks outside.
- Form reset: reset form state on every open via `useEffect(() => { if (isOpen) reset(defaultValues) }, [isOpen])` to avoid stale values from a prior open.

Every section below (Layout, Components, Data Fetching, RBAC, Loading/Empty/Error, Responsive) should be interpreted through the selected kind. If an instruction makes sense only for a Page (breadcrumbs, `<PageHeader>`, route export) skip it when building a Dialog, and vice versa.

## Design Fidelity — STRICT

> `{{UI_FILE}}` is the **design & layout** reference, not the code reference. Implement what it shows **visually** — element arrangement, hierarchy, grouping, spacing, alignment, section ordering, responsive stacking, which controls belong in each region, and the visual states (loading / empty / error). **Everything else must come from the codebase.**

### Take from `{{UI_FILE}}` (design & layout only)

- Page/dialog structure: header, body, footer, sidebars/split panes, card grouping.
- Content hierarchy: titles, subtitles, sections, field order within a form, column order within a table.
- Which controls appear where (button placement, filter position, pagination location, action column).
- Micro-layout: relative size/proportion of regions, spacing rhythm, empty-state composition.
- Responsive intent: what collapses, stacks, or hides at `md:` and below.
- Copy direction / tone for each label (to be translated via `dictionaries.ts`, see §Internationalization).

### Take from the codebase — NOT from `{{UI_FILE}}`

- **Components**: only `@saas/ui` primitives (`Button`, `Input`, `Select`, `Dialog*`, `Card`, `PageHeader`, `PageContainer`, `EmptyState`, `Pagination`, `FormField`, `Skeleton`, `Spinner`, `ErrorAlert`, etc.). There is no `Table` component: lists use a plain `<table>` styled like [SampleItemPage.tsx](plugins/sample-plugin/src/web/pages/sample-items/SampleItemPage.tsx). If the design shows a novel component, decompose it into existing primitives; do not introduce a lookalike wrapper.
- **Colors**: tenant theme CSS variables via Tailwind utilities — `bg-background`, `bg-card`, `bg-primary`, `text-primary-foreground`, `bg-muted`, `text-muted-foreground`, `border-border`, `ring-ring`, `bg-sidebar`, `bg-destructive`. **Never** pull hex codes, rgb/rgba, or named colors from the design file. If the design uses a color that doesn't map to an existing variable, pick the closest variable — do **not** extend the palette.
- **Typography**: the app's existing type scale (Tailwind `text-sm` / `text-base` / `text-lg` / `text-xl` / `text-2xl`, `font-medium` / `font-semibold`). Ignore custom font families, weights, or sizes present only in the design file.
- **Radius / shadow / borders**: Tailwind tokens (`rounded-md`, `rounded-lg`, `shadow-sm`, `shadow`, `border`). No custom `rounded-[7px]` arbitrary values or per-component shadow hex.
- **Spacing**: Tailwind scale (`gap-2`, `space-y-4`, `p-6`). Do not translate pixel-perfect offsets from the design file into arbitrary values like `mt-[13px]`.
- **Icons**: `lucide-react` only. If the design file uses a different icon set, pick the closest `lucide-react` equivalent.
- **Motion**: `@saas/ui` defaults (Radix transitions on `Dialog` / `DropdownMenu`). Don't hand-roll animations from the design file.
- **Dark mode**: derived automatically from the CSS variables above — do not add a separate dark-mode treatment that only matches the design file's light-mode rendering.

### Forbidden

- `style={{ color: '#...' }}` or any inline color — zero exceptions.
- Hex codes, `rgb(...)`, `hsl(...)`, or named colors **anywhere** in the component (className arbitrary values included: `bg-[#123456]`, `text-[rgb(…)]`).
- Custom CSS files, `.module.css`, `styled-components`, Emotion, or any styling mechanism outside Tailwind utilities.
- Copying assets (SVGs, PNGs) from the design file into the repo. Use `lucide-react` icons and existing shared assets.
- Building a "pixel-perfect" wrapper component that duplicates an existing `@saas/ui` primitive with different styling.

### Checklist

- [ ] Layout, hierarchy, and section ordering match `{{UI_FILE}}`.
- [ ] Every component used is imported from `@saas/ui` (or `lucide-react` for icons); no bespoke visual wrappers created in this task.
- [ ] `grep -nE '#[0-9a-fA-F]{3,8}|rgb\(|rgba\(|hsl\(' plugins/{{MODULE_NAME}}/src/web/pages/{{DIR}}/{{ScreenName}}.tsx` returns no hits.
- [ ] `grep -nE 'style=\{\{' plugins/{{MODULE_NAME}}/src/web/pages/{{DIR}}/{{ScreenName}}.tsx` returns no hits (or only non-color layout props like `gridTemplateColumns` derived from data).
- [ ] No Tailwind arbitrary color values (`bg-[#…]`, `text-[rgb(…)]`, `border-[hsl(…)]`).
- [ ] Dark-mode variants render correctly without any design-file-specific overrides.

## Codebase Context

- Reference page (copy this shape): [plugins/sample-plugin/src/web/pages/sample-items/SampleItemPage.tsx](plugins/sample-plugin/src/web/pages/sample-items/SampleItemPage.tsx)
- Shared UI package (components, hooks, stores): [packages/ui/src/](packages/ui/src/)
- API client (handles `x-tenant-id` + 401 refresh): [packages/ui/src/lib/api-client.ts](packages/ui/src/lib/api-client.ts)
- Data-fetch hooks (`useApi`, `usePaginatedApi`): [packages/ui/src/hooks/use-api.ts](packages/ui/src/hooks/use-api.ts)
- RBAC hook: `useRBAC()` — `.authorize({ permissions, roles, logic })` / `.hasPermission(...)`
- i18n hook: `useLanguage()` — `const { t } = useLanguage(); t('namespace.key', { param })`
- Realtime: [packages/ui/src/hooks/use-realtime-updates.ts](packages/ui/src/hooks/use-realtime-updates.ts)
- App-level Tailwind entry: [apps/web/app/globals.css](apps/web/app/globals.css) (uses `@import "tailwindcss"` — Tailwind 4)
- Plugin route binding: `app/(dashboard)/plugins/[slug]/[...rest]/page.tsx` loads the plugin's routes lazily via `PluginRouteLoaders[slug]` (`apps/web/lib/plugin-routes.ts`) and picks the page from the plugin's `{{ModuleName}}PluginRoutes` map (`[param]` keys become `params`)

## Folder Placement — STRICT

> **Before creating the page or dialog file, inspect the existing plugin tree and reuse the resource folder if one already exists. Never create two folders for the same resource (e.g. both `src/web/pages/uom/` and `src/web/pages/uoms/`). The web folder must match the API folder's slug exactly.**

### Procedure

1. **Scan first.** Before writing anything:
   ```sh
   ls plugins/{{MODULE_NAME}}/src/api/
   ls plugins/{{MODULE_NAME}}/src/web/pages/
   ```
   The API folder's slug is the authoritative source — the web folder **mirrors it**.
2. **Web folder = API folder.** If the backend is under `plugins/{{MODULE_NAME}}/src/api/<slug>/`, the web folder is `plugins/{{MODULE_NAME}}/src/web/pages/<slug>/` with the identical `<slug>`. Do not re-pluralize or re-case the slug.
3. **Match before creating.**
   - If a folder for this resource already exists under `src/web/pages/` in **any** spelling, use it and co-locate new files there. Do **not** create a parallel folder.
   - If no folder exists, create `src/web/pages/<slug>/`. Page (`<Screen>.tsx`) and any sibling dialog (`<Dialog>.tsx`) for the same resource live inside it — see [plugins/sample-plugin/src/web/pages/sample-items/](plugins/sample-plugin/src/web/pages/sample-items/) which contains both `SampleItemPage.tsx` and `SampleItemDialog.tsx`.
4. **Flat `src/web/pages/` is acceptable for a few loose screens spanning different resources.** See [plugins/document-templates/src/web/pages/](plugins/document-templates/src/web/pages/) — `templates-list.tsx`, `template-editor.tsx`, `email-templates-list.tsx`, `email-template-editor.tsx` at the root. Once a plugin has more than two screens for the same resource, migrate them into `src/web/pages/<slug>/`.
5. **`{{DIR}}` placeholder.** The `{{DIR}}` token used below resolves to the slug from step 2 — **not** a free choice. If the backend folder is `src/api/uoms/`, `{{DIR}}` must be `uoms`, producing `src/web/pages/uoms/UomsPage.tsx`.
6. **File naming.** The folder is plural (`uoms/`). The file name follows the screen identity (`UomsPage.tsx` for the list, `UomDialog.tsx` or `UomFormDialog.tsx` for the per-item dialog — singular in the file name when the dialog acts on one entity). Match the naming shown in the sample plugin reference.

### Reference layouts

- Multi-resource plugin (canonical): [plugins/sample-plugin/src/web/pages/sample-items/](plugins/sample-plugin/src/web/pages/sample-items/) — `SampleItemPage.tsx` + `SampleItemDialog.tsx` inside one folder.
- Flat layout (a few loose screens): [plugins/document-templates/src/web/pages/](plugins/document-templates/src/web/pages/).

### Anti-pattern — do NOT produce this

```
src/web/pages/
  uom/
    UomDialog.tsx          # dialog here
  uoms/                    # parallel folder for the SAME resource
    UomsPage.tsx           # page here
```

### Correct

```
src/web/pages/
  uoms/
    UomsPage.tsx
    UomDialog.tsx
```

## Navigation — STRICT

> **Plugin pages MUST NOT import from `next/*` (`next/navigation`, `next/router`, `next/link`, `next/image`, …). Plugin packages do not declare `next` as a dependency, so `tsc` fails with `Cannot find module 'next/navigation'`. The Next host transpiles plugin code at runtime via `transpilePackages`, but the plugin's own `tsc --build` step has no idea what `next/*` is. Use the props injected by `PluginPageWrapper` instead.**

### The mechanism

Every page registered in `{{ModuleName}}PluginRoutes` (and equivalents) is rendered through [apps/web/components/plugin-page-wrapper.tsx](apps/web/components/plugin-page-wrapper.tsx), which injects three optional props:

```ts
{
  onNavigate?: (path: string) => void;     // calls router.push() inside the host app
  params?: Record<string, string>;          // captured by the [param] route resolver
  searchParams?: Record<string, string>;    // forwarded from Next.js
}
```

The host app owns the Next dependency; your plugin doesn't import any of it.

### Page signature — copy this shape

```tsx
'use client';

export const {{ScreenName}} = ({
  params,
  searchParams,
  onNavigate,
}: {
  params?: Record<string, string>;
  searchParams?: Record<string, string>;
  onNavigate?: (path: string) => void;
} = {}) => {
  // ...
};
```

**Inline the prop type** — do NOT declare `interface PageProps {}` and reference it in the export. Because the page component is re-exported through `{{ModuleName}}PluginRoutes` with `tsc --declaration`, a non-exported referenced interface produces TS4023 (`Exported variable '{{ModuleName}}PluginRoutes' has or is using name 'PageProps' but cannot be named`). Inline types avoid this entirely.

### Forbidden imports (every one of these breaks the plugin's tsc)

```tsx
// ❌ Cannot find module 'next/navigation'
import { useRouter, usePathname, useSearchParams, useParams } from 'next/navigation';

// ❌ Cannot find module 'next/router'
import { useRouter } from 'next/router';

// ❌ Cannot find module 'next/link'
import Link from 'next/link';

// ❌ Cannot find module 'next/image'
import Image from 'next/image';
```

### Allowed patterns

```tsx
// ✅ SPA navigation — go through the injected onNavigate
<Button onClick={() => onNavigate?.('/plugins/{{MODULE_NAME}}/{{RESOURCE}}')}>
  Back to list
</Button>

// ✅ Read URL path params — from props, never from useParams()
const id = params?.id;

// ✅ Read query string — from props, never from useSearchParams()
const filter = searchParams?.filter ?? 'all';

// ✅ External or hard-reload navigation — plain anchor
<a href="https://docs.example.com/help" target="_blank" rel="noreferrer">Help</a>

// ✅ Static images — plain <img>, not next/image
<img src="/static/logo.svg" alt="Logo" className="h-8 w-8" />
```

### What `onNavigate` does NOT cover

The current wrapper only exposes `router.push`. The following Next.js router APIs are unavailable from plugin code:

| Router API           | Workaround inside a plugin                                          |
| -------------------- | ------------------------------------------------------------------- |
| `router.replace()`   | Use `onNavigate(path)` (push). Browser back button gains an entry — usually fine. |
| `router.back()`      | Push to a known list URL (`onNavigate('/plugins/{{MODULE_NAME}}/{{RESOURCE}}')`). |
| `router.refresh()`   | Re-fetch your data via `useApi` / `usePaginatedApi` `refetch()`. The page already remounts on `onNavigate` to the same path. |
| `router.prefetch()`  | Not supported. Rare to need from inside a plugin page. |

If a screen genuinely needs one of these, **stop and escalate** — the right fix is widening [PluginPageWrapper](apps/web/components/plugin-page-wrapper.tsx) once for everyone, not back-channeling a `next/*` import.

### Cross-`next/*` substitutions

| If you wanted                  | Use instead                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `next/link`                    | `<a>` for hard nav, or `<Button onClick={() => onNavigate?.(...)}>` for SPA nav         |
| `next/image`                   | Plain `<img>` with explicit `width`/`height`/`alt` and Tailwind sizing classes          |
| `next/router` (`useRouter`)    | The injected `onNavigate` prop                                                          |
| `next/navigation` `useRouter`  | The injected `onNavigate` prop                                                          |
| `next/navigation` `usePathname`| Compose from page identity / `params` — pages already know their own route             |
| `next/navigation` `useSearchParams` | The injected `searchParams` prop                                                  |
| `next/navigation` `useParams`  | The injected `params` prop                                                              |

### Reference page

[plugins/sample-plugin/src/web/pages/sample-articles/SampleArticleListPage.tsx](plugins/sample-plugin/src/web/pages/sample-articles/SampleArticleListPage.tsx) and its sibling Detail/Create/Edit pages are the canonical shape. None of them import from `next/*`; all navigation rides on the `onNavigate` prop.

### Checklist

- [ ] `grep -nE "from ['\"]next/" plugins/{{MODULE_NAME}}/src/web/` returns **zero** matches across this plugin.
- [ ] Every navigation call goes through `onNavigate?.(path)`.
- [ ] `params` and `searchParams` are read from props, not from `useSearchParams()` / `useParams()` / `usePathname()`.
- [ ] The page component prop type is **inlined**, not a named non-exported interface (avoids TS4023).
- [ ] If router methods beyond `push` were needed, this was raised with the user before the page was written.

## Backend Isolation — STRICT

> **Plugin web code MUST NOT import from `src/api/`, `src/database/`, `@saas/database`, or any plugin's `/api` subpath.** Anything the screen needs — Zod schemas, DTO types, enums, ID brand types, response shapes — must be (re)declared inside `src/web/`, either inline with the component that uses it or under `src/web/types/` when shared across screens. This applies to value imports **and** `import type` alike.

### Why

- **Build isolation.** `src/web/` is bundled by Next.js for the browser. A backend file usually imports `@nestjs/*` decorators, `@saas/backend` or `@saas/database`; pulling one into a page drags server-only code (and its Node dependencies) into the web build, where it fails or bloats the bundle. Type-only imports still couple the two sides, so they're forbidden too.
- **Bundle hygiene.** `@saas/database` re-exports the generated Prisma client. Any web reference pulls `@prisma/client` into the browser bundle (megabytes of dead code) and exposes server-only enums.
- **Server is still authoritative.** The API revalidates every request with its own Zod schema and returns 400/409 with field-level errors that `form.setError(...)` surfaces. Drift between the web schema and the backend DTO is caught at the boundary; it does not need to be prevented by sharing types.

### Forbidden imports

```tsx
// ❌ DTO / Zod schema reuse — even type-only
import { createItemSchema, type CreateItemDto } from '../api/items/dto/create-item.dto';
import type { ItemQueryDto } from '@saas/plugin-{{MODULE_NAME}}/api';

// ❌ Prisma model / enum reuse
import { ItemStatus } from '@saas/database';
import type { Item } from '@saas/database';

// ❌ Service / module / controller types
import type { ItemsService } from '../api/items/items.service';
```

### Allowed pattern — redeclare in web

For form schemas, define a Zod schema in the web file (or `src/web/types/`). The reference [SampleItemDialog.tsx](plugins/sample-plugin/src/web/pages/sample-items/SampleItemDialog.tsx) does exactly this — `import * as z from 'zod';` and the schema is built locally.

```ts
// inline in the screen file, or plugins/{{MODULE_NAME}}/src/web/types/item.ts when shared

import { z } from 'zod';

export const createItemSchema = z.object({
  name: z.string().min(1).max(120),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
});
export type CreateItemDto = z.infer<typeof createItemSchema>;

// Response shape used by useApi — describe what the screen consumes, not the full Prisma row
export type Item = {
  id: string;
  name: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  createdAt: string;
};
```

For backend enums, redeclare as a TypeScript union or `as const` array — do not import the Prisma enum.

```ts
export const ITEM_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
```

### Checklist

- [ ] `grep -rnE "from ['\"](\\.\\./)+api/" plugins/{{MODULE_NAME}}/src/web/` returns **zero** matches.
- [ ] `grep -rnE "from ['\"]@saas/database['\"]" plugins/{{MODULE_NAME}}/src/web/` returns **zero** matches.
- [ ] `grep -rnE "from ['\"]@saas/plugin-[^'\"]+/api['\"]?" plugins/{{MODULE_NAME}}/src/web/` returns **zero** matches.
- [ ] Every Zod schema, enum, ID type, and response type used by the screen is declared inside `src/web/` (inline with the component or under `src/web/types/`).
- [ ] `import type` from any forbidden path is also absent — `tsc` still parses the module graph for type-only imports.

## Rendering Mode

- **Server Component** by default — no `'use client'` directive, no browser-only APIs.
- **Client Component** when the screen has interactivity, form state, effects, or consumes a Zustand store. Start the file with `'use client';` as the first non-comment line.
- Plugin pages are **almost always client components** because they subscribe to auth/RBAC state and make API calls on mount. The reference page is a client component.

Do not mix `useState`/`useEffect` with `async` page-level Server Components — split into a Server Component wrapper and a client component if data loading is expected at the server edge.

## Screen Flow Context

Where this screen fits in the navigation flow — what screens link to it, and which screens it links to.

{{SCREEN_FLOW_CONTEXT}}

## Layout & Structure

Wrap the page contents in:

- `<PageContainer>` — the shared outer padding and max-width wrapper from `@saas/ui`
- `<PageHeader title={...} description={...}>{actions}</PageHeader>` — sets the H1 and subtitle; its children are the action buttons (typically a primary "Create" button). Optional `backUrl` adds a back button
- The main content region below the header, typically a `<Card>` containing the list or form

Describe the layout below:

{{LAYOUT}}

## Components

List every UI component on the screen with its source (shared from `@saas/ui` vs plugin-local) and purpose. Reuse `@saas/ui` components unless the design demands something they don't support. Icons come from `lucide-react` only.

Commonly-used shared components:

| Component                                                                                | Use for                                           |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `Button`                                                                               | All buttons (variant: default/outline/ghost/etc.) |
| `Input`, `Textarea`                                                                  | Form inputs                                       |
| `Select`, `ColorPicker`                                                              | Select / color pick                               |
| `Checkbox`, `Switch`                                                                 | Boolean input                                     |
| `Dialog`, `ConfirmDialog`, `DeleteConfirmDialog`                                   | Modal overlays                                    |
| `DropdownMenu`                                                                         | Row actions / overflow menus                      |
| `Pagination`, `PageInfo`, `SortableHeader`                                         | List table scaffolding                            |
| `EmptyState`, `ErrorAlert`, `Skeleton`, `Spinner`                                | Non-happy-path states                             |
| `Protect`, `useRBAC`                                                                 | Permission gating                                 |
| `FormField`                                                                            | Consistent label + input + error layout           |
| `FileUpload`                                                                           | File inputs with drag-drop                        |
| `ExportButton`, `ImportButton`, `ImportWizard`                                     | Export/import wiring                              |
| `WorkflowActions`, `WorkflowStepManager`, `WorkflowTimeline`, `WorkflowProgress` | Workflow UI                                       |

{{COMPONENTS}}

## Data Fetching

Use the typed API hooks from `@saas/ui`. They automatically:

- inject the `x-tenant-id` header from the auth store
- include credentials for HttpOnly JWT cookies
- deduplicate 401 refreshes and retry once
- redirect to `/login` on auth failure
- handle 403 tenant-suspension responses

### List queries

```ts
const { data, meta, loading, error, refetch } = usePaginatedApi<Item>(
  '/plugins/{{MODULE_NAME}}/items',
  { page, limit, search, sortBy, sortOrder },   // options; `meta` = { total, page, limit, totalPages }
);
```

### Detail / custom queries

```ts
const { data, loading, error, refetch } = useApi<Item>(
  `/plugins/{{MODULE_NAME}}/items/${id}`,
  undefined,          // query params (Record<string, string | number | undefined>)
  { skip: !id },      // options: the THIRD argument
);
```

`error` is a `string | null` (the message), not an `Error`. The sample plugin's pages call `apiClient` in effects instead; both are fine.

### Mutations

Call `apiClient.post/put/patch/delete` directly in event handlers; do not wrap in a hook. After a successful mutation, call `refetch()` on the affected list query and `toast.success(...)` from `sonner`.

### API Contract Match — STRICT

> **Every `apiClient.<verb>(<path>, …)` call MUST mirror the backend controller's HTTP decorator and route exactly.** Mismatches — UI sends `PUT` while the controller declares `@Patch(':id')`, UI calls `/items/${id}/archive` while the controller has `@Post(':id/archive')`, UI omits the `/plugins/{{MODULE_NAME}}/` prefix — compile cleanly and fail at runtime as 404 or 405. They are usually only caught in manual QA, well after the PR has shipped.

#### Procedure

Before writing any mutation handler, open the matching controller and read its decorators. The controller is authoritative — the API task was reviewed first.

```sh
ls plugins/{{MODULE_NAME}}/src/api/{{RESOURCE}}/
grep -nE "@(Controller|Get|Post|Put|Patch|Delete)\(" plugins/{{MODULE_NAME}}/src/api/{{RESOURCE}}/*.controller.ts
```

For every action the screen performs, line up the verb **and** the full path against the controller and confirm they agree:

| Backend (controller decorator)        | Frontend call                                                          |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `@Controller('plugins/x/items')`      | every path on this screen begins with `/plugins/x/items`               |
| `@Get()`                              | `apiClient.get('/plugins/x/items', { page, search })`                  |
| `@Get(':id')`                         | `apiClient.get(\`/plugins/x/items/${id}\`)`                            |
| `@Get('check-name')`                  | `apiClient.get('/plugins/x/items/check-name', { name })`               |
| `@Post()`                             | `apiClient.post('/plugins/x/items', body)`                             |
| `@Post('bulk-delete')`                | `apiClient.post('/plugins/x/items/bulk-delete', { ids })`              |
| `@Patch(':id')`                       | `apiClient.patch(\`/plugins/x/items/${id}\`, body)`                    |
| `@Put(':id')`                         | `apiClient.put(\`/plugins/x/items/${id}\`, body)`                      |
| `@Delete(':id')`                      | `apiClient.delete(\`/plugins/x/items/${id}\`)`                         |

If a mismatch is real (the controller is genuinely wrong), **stop and raise it** — the fix is to update the API task and re-review, not to silently change one side.

#### Common mistakes

- **Verb drift on update** — UI uses `apiClient.put(...)` while the controller has `@Patch(':id')` (or vice versa). Edits silently 404/405.
- **Missing plugin prefix** — UI calls `/items/${id}` but the controller is mounted at `plugins/{{MODULE_NAME}}/items`. `apiClient` does not auto-prepend the plugin path; include it in every URL.
- **Singular vs plural slug** — UI calls `/plugins/x/uom/${id}` while the controller is `@Controller('plugins/x/uoms')`. The controller path is authoritative; the web folder slug already mirrors it (see [Folder Placement — STRICT](#folder-placement--strict)).
- **Custom action route shape** — UI invents `/items/${id}/bulk-delete` while the controller declares `@Post('bulk-delete')` (ids in body, no `:id` in path). Read the decorator + handler signature together — do not infer the URL shape from the action name.
- **Query string vs body** — `@Get('check-name')` reads `?name=...`; sending a body to it returns nothing useful. `apiClient.get(url, params)` takes the query object **directly** as its second argument: `apiClient.get(url, { name })`. Wrapping it (`{ params: { name } }`) sends `?params=[object Object]`.

#### Checklist

- [ ] Each `apiClient.<verb>(<path>, …)` call in the new file matches one of the controller's `@(Get|Post|Put|Patch|Delete)` decorators on **both** verb and path.
- [ ] The path prefix on every call equals the controller's `@Controller('…')` value verbatim, including the `/plugins/{{MODULE_NAME}}/` segment and the resource slug.
- [ ] Update mutations use `patch` when the controller is `@Patch(...)` and `put` when it is `@Put(...)` — never the other way around.
- [ ] Custom actions (`/bulk-delete`, `/archive`, `/restore`, …) match the controller's route segment **and** parameter shape (path param vs query string vs request body).
- [ ] Diffed `grep -nE "apiClient\\.(get|post|put|patch|delete)\\(" plugins/{{MODULE_NAME}}/src/web/pages/{{DIR}}/{{ScreenName}}.tsx` against the controller's decorators before submission; every line accounted for.

Describe each API call on the screen:

{{DATA_ON_LOAD}}

### Data Binding

Map each UI element to the field it renders. For forms, pair the binding with the Zod schema below.

{{DATA_BINDING}}

## User Interactions

Enumerate every interaction: clicks, inputs, keyboard shortcuts, drag-drop, realtime-driven updates.

{{INTERACTIONS}}

### Keyboard Shortcuts

Use `useHotkey('mod+k', handler)` from `@saas/ui` for shortcuts. Respect the app-level shortcuts (`mod+k` toggles the command palette, `mod+/` collapses the sidebar, `mod+.` toggles theme).

## Form Handling (if applicable)

Forms in this codebase use **react-hook-form + Zod** with the schema declared **inside `src/web/`** — never imported from `src/api/` or `@saas/database`. See [Backend Isolation — STRICT](#backend-isolation--strict) for the rule and rationale; the backend revalidates every request with its own Zod schema, so a separate web-side schema cannot drift past the API boundary.

```ts
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

const createXSchema = z.object({
  name: z.string().min(1).max(120),
  // mirror the API's accepted shape; do NOT import the backend DTO
});
type CreateXDto = z.infer<typeof createXSchema>;

const form = useForm<CreateXDto>({
  resolver: zodResolver(createXSchema),
  defaultValues: { name: '' },
});
```

### Form Fields

| Field           | Type | Required | Zod Validator | Default |
| --------------- | ---- | -------- | ------------- | ------- |
| {{FORM_FIELDS}} |      |          |               |         |

### Form Submission

- `onSubmit` posts to the API via `apiClient` and awaits the promise
- On success: `toast.success(t('...'))`, close dialog / refetch list / navigate as appropriate
- On 409 (conflict): surface the server message as a field-level error via `form.setError(...)`
- On validation-level errors from the server: the call throws `ApiRequestError` (from `@saas/ui`) with `statusCode`, `message` and `errors` (`Record<field, string[]>`); map `errors` to `form.setError(field, ...)`. A request that got no response throws `ApiNetworkError` instead

{{FORM_SUBMISSION}}

## RBAC

- **Show/hide elements** via `<Protect permissions={['{{MODULE_NAME}}.{{RESOURCE}}.{{ACTION}}']}><Button>...</Button></Protect>` — hides if the current user lacks the permission.
- **Gate the whole page**: call `useRBAC().authorize({ permissions: ['{{MODULE_NAME}}.{{RESOURCE}}.read'] })` at the top of the component; if false, render `<Forbidden />` from `@saas/ui`.
- **Do not re-check permissions inside every handler** — the backend enforces them authoritatively.

Document the gating for this screen:

{{RBAC_GATING}}

## State Management

- **Local state**: `useState` / `useReducer` inside the component
- **Auth / tenant / user**: `useAuthStore` (`persist` middleware, localStorage key `auth-storage`)
- **RBAC**: `useRBACStore` — never call directly; use the `useRBAC()` hook wrapper
- **Preferences (locale, date format, sidebar state)**: `usePreferencesStore`
- Do not introduce a new Zustand store for screen-scoped state — use `useState`

{{STATE_MANAGEMENT}}

## Loading, Empty, Error States

| State        | Component / Behavior                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| Initial load | `<Skeleton />` rows matching the final layout (`loading === true`)                                   |
| Empty data   | `<EmptyState title={t('...')} description={t('...')} action={...} />`                                  |
| API error    | `<ErrorAlert message={error ?? t('...')} onRetry={refetch} />` (`error` from the hooks is already a string) |
| Submitting   | Disable the submit button; render a `<Spinner />` beside it; keep the form enabled but non-interactive |
| Forbidden    | `<Forbidden />` full-page placeholder                                                                  |

## Internationalization — STRICT

> **The only source of translated strings for this screen is `plugins/{{MODULE_NAME}}/src/dictionaries.ts`.** No hardcoded English (or Indonesian) strings in the page/dialog, no inline literals in JSX, no fallback strings in `t('key', 'default')` — if the translation does not yet exist, **update `dictionaries.ts`** (both `en` and `id`) before referencing the key.

### Procedure for every visible string

1. Derive the canonical key: `{{pluginNamespace}}.{section}.{key}` using the plugin's camelCase top-level namespace (see [plugins/sample-plugin/src/dictionaries.ts](plugins/sample-plugin/src/dictionaries.ts) for shape).
2. Open `plugins/{{MODULE_NAME}}/src/dictionaries.ts`.
   - If the key already exists under **both** `en` and `id`, reuse it as-is.
   - If it is missing from either locale, **add it to both** before you wire the component. Do not ship a key that only resolves in one locale.
3. Render via `const { t } = useLanguage(); t('{{pluginNamespace}}.section.key')`.
4. For dynamic values use `{paramName}` placeholders: `t('items.deleteSelected', { count: ids.length })` — never use string concatenation or template literals to splice untranslated fragments.

### Forbidden

- Hardcoded literal text anywhere in the rendered output (buttons, headings, tooltips, placeholders, empty states, error messages, toasts, aria-labels).
- Adding a key to `en` without a matching entry in `id` (or vice versa).
- Pulling strings from any other source (Zod message defaults, inline `??` fallbacks, a per-page constants file, another plugin's dictionary).
- Using `t('...') || 'fallback'` — if `t()` returns the key, the real fix is to add the missing entry to `dictionaries.ts`.

### Checklist

- [ ] Every user-visible string on this screen resolves through `t('{{pluginNamespace}}.…')`.
- [ ] Every key referenced by this task exists under **both** `en` and `id` in `plugins/{{MODULE_NAME}}/src/dictionaries.ts`.
- [ ] `git diff plugins/{{MODULE_NAME}}/src/dictionaries.ts` shows any new keys added symmetrically to both locales.
- [ ] `grep -nE '"[A-Z][a-zA-Z ]+"' plugins/{{MODULE_NAME}}/src/web/pages/{{DIR}}/{{ScreenName}}.tsx` returns **only** i18n keys, icon component imports, or identifier strings — no bare display text.

## Realtime (if applicable)

```ts
useRealtimeUpdates('{{MODULE_NAME}}.{{RESOURCE}}.created', (payload) => {
  refetch();
});
```

The event name must match what the backend service broadcasts via `WebSocketBridgeService.broadcastToTenant(slug, eventName, payload)`. The payload carries ids only (everyone in the tenant receives it): refetch through the API instead of rendering the payload.

## Styling

- **Tailwind CSS 4** — use utility classes directly, no custom CSS files per component
- Dark-mode variants via the `dark:` prefix (the theme provider toggles the `dark` class on `<html>`)
- Tenant-branded colors come from CSS variables set by `useTenantTheme()` — use `bg-primary`, `text-primary-foreground`, `bg-sidebar`, etc. instead of hardcoded hex
- Icons: `lucide-react` only
- The plugin's web folder must be registered as a Tailwind `@source` in [apps/web/app/globals.css](apps/web/app/globals.css) — `pnpm plugins:register` does this; verify after running it

## Responsive Behavior

`md:` breakpoint for tablet, `lg:` for desktop. Data tables typically fall back to a stacked card view below `md:` — the reference page demonstrates the expand/collapse pattern.

{{RESPONSIVE}}

## Deliverables

### Shared (both kinds)

- [ ] File path: `plugins/{{MODULE_NAME}}/src/web/pages/{{DIR}}/{{ScreenName}}.tsx`
- [ ] `'use client'` at the top (dialogs are always interactive; most plugin pages are too)
- [ ] Form handling (if any) with `react-hook-form` + `zodResolver` using a schema declared in `src/web/` that mirrors the API's DTO (never imported from it)
- [ ] i18n: every visible string is resolved via `t('{{pluginNamespace}}.…')` against `plugins/{{MODULE_NAME}}/src/dictionaries.ts`; missing keys were added to **both** `en` and `id` in that file — no hardcoded literals, no inline fallbacks, no external dictionaries
- [ ] Layout & hierarchy mirror `{{UI_FILE}}`; components, colors, typography, spacing, radius/shadow, and icons come from the codebase (`@saas/ui` + Tailwind tenant-theme utilities + `lucide-react`) — not from the design file
- [ ] Tenant-themed colors only: `bg-primary` / `bg-card` / `text-primary-foreground` / `text-muted-foreground` / `border-border` / etc. No hex codes, no `rgb(...)`, no `hsl(...)`, no Tailwind arbitrary color values (`bg-[#…]`)
- [ ] Tailwind utilities only; no inline `style={{ color: ... }}`, no `.module.css`, no styled-components/Emotion, no custom fonts, no SVG/PNG assets copied from the design file
- [ ] No imports from `src/api/`, `src/database/`, `@saas/database`, or any plugin's `/api` subpath (value or type-only) — every Zod schema, enum, and response type the screen needs is declared inside `src/web/`
- [ ] Every `apiClient.<verb>(<path>, …)` call matches a controller `@(Get|Post|Put|Patch|Delete)` decorator on both verb and full path (including the `/plugins/{{MODULE_NAME}}/` prefix) — no `put`-vs-`patch` drift, no missing prefix, no invented custom-action routes
- [ ] Type-check passes: no errors for this plugin in the `pnpm dev` watcher output, or `pnpm exec tsc --noEmit -p plugins/{{MODULE_NAME}}` exits 0; `pnpm build` for the whole app

### Page-only (if `{{SCREEN_NAME}}` / `{{UI_FILE}}` does NOT contain `dialog`)

- [ ] Registered in `{{ModuleName}}PluginRoutes` (and `export *`-ed) in `plugins/{{MODULE_NAME}}/src/web/index.ts` so the dynamic plugin route resolves it
- [ ] Wrapped in `<PageContainer>` + `<PageHeader title description>` with action buttons as its children (no `breadcrumbs` / `actions` props)
- [ ] Data fetching via `useApi` / `usePaginatedApi`; handles loading / empty / error / forbidden states
- [ ] Top-of-component `useRBAC().authorize({ permissions: [...] })` guard with `<Forbidden />` fallback
- [ ] Realtime subscription via `useRealtimeUpdates` if the PRD requires live updates
- [ ] Responsive at `md:` and `lg:` breakpoints; table → stacked-card fallback below `md:` where the design calls for it
- [ ] `pnpm plugins:register` run to refresh registry + Tailwind source directives
- [ ] Corresponding `menus.ts` entry exists (delivered by the MENUS task)

### Dialog-only (if `{{SCREEN_NAME}}` / `{{UI_FILE}}` contains `dialog`)

- [ ] **Not** exported from `src/web/index.ts` and **not** added to `menus.ts` — the dialog has no route and no sidebar entry
- [ ] Uses `DialogRoot` + `DialogContent` + `DialogHeader/DialogTitle/DialogDescription/DialogFooter` from `@saas/ui` (no `<PageContainer>` / `<PageHeader>` / breadcrumbs / `<Forbidden />`)
- [ ] Props interface exactly: `{ isOpen: boolean; onClose: () => void; onSuccess?: () => void; ...domainProps }`
- [ ] `onOpenChange` on `DialogRoot` routes to `onClose()` so Esc / outside-click dismiss works
- [ ] Form state resets every time the dialog opens (`useEffect(() => { if (isOpen) reset(defaults) }, [isOpen])`)
- [ ] Mutations call `onSuccess()` after a 2xx response so the parent page can `refetch()`; `onClose()` fires on success too
- [ ] Submit button disabled + `<Spinner />` while the mutation is in flight; the form itself stays mounted
- [ ] No list-level `useApi` / `usePaginatedApi` in the dialog — list ownership stays on the parent page
- [ ] Permission gating lives on the **trigger** in the parent page (`<Protect>`), not inside the dialog body

## Acceptance Criteria

### Shared (both kinds)

- [ ] Layout & visual hierarchy match `{{UI_FILE}}`; any deviation is limited to swapping bespoke design-file visuals for equivalent `@saas/ui` primitives / tenant-theme utilities
- [ ] Form errors (400/409) surface as inline field errors via `form.setError(...)`, not blocking toasts
- [ ] Every user-visible string is translated in both `en` and `id`
- [ ] Tailwind classes only; no inline color styles, no ad-hoc CSS files, no hex / `rgb()` / `hsl()` anywhere in the implemented file(s); `grep -nE '#[0-9a-fA-F]{3,8}|rgb\(|rgba\(|hsl\(' plugins/{{MODULE_NAME}}/src/web/pages/{{DIR}}/{{ScreenName}}.tsx` is empty

### Page-only

- [ ] Data loads from the correct backend endpoints on screen entry
- [ ] Loading / empty / error / forbidden states are all reachable and correctly styled
- [ ] Permission-gated elements are hidden (not disabled) for users without permission
- [ ] Realtime updates refresh the view within one tick of the backend event (where applicable)
- [ ] Navigation in and out of this screen follows the flow spec
- [ ] Deep-linking to the page route works without full re-auth
- [ ] Follows the conventions of [plugins/sample-plugin/src/web/pages/sample-items/SampleItemPage.tsx](plugins/sample-plugin/src/web/pages/sample-items/SampleItemPage.tsx)

### Dialog-only

- [ ] Opens only when the parent page sets `isOpen` to true; no self-routing
- [ ] Closes on Esc, outside-click, Cancel button, and after successful submit
- [ ] Re-opening the dialog starts from clean form state (no stale values from the prior open)
- [ ] After a successful submit, the parent page re-fetches (confirm `onSuccess` was called)
- [ ] No breadcrumbs, no page header, no `<Forbidden />` inside the dialog body
- [ ] Dialog component is NOT a route key in `{{ModuleName}}PluginRoutes` (what `PluginRouteLoaders['{{MODULE_NAME}}']` loads) after `pnpm plugins:register`
- [ ] Follows the conventions of [plugins/sample-plugin/src/web/pages/sample-items/SampleItemDialog.tsx](plugins/sample-plugin/src/web/pages/sample-items/SampleItemDialog.tsx)
