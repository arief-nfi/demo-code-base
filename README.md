# SaaS Multitenant - Base App

A production-ready monorepo for a SaaS Multitenant platform with schema-per-tenant PostgreSQL isolation, modular plugin architecture, and full RBAC authorization.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Backend** | NestJS + Prisma ORM | 10.x + 5.x |
| **Frontend** | Next.js + React | 16.x + 19.x |
| **Database** | PostgreSQL | 15 |
| **Monorepo** | pnpm + TurboRepo | 9.x |
| **Styling** | Tailwind CSS + Radix UI | 4.x |
| **Validation** | Zod | 4.x |
| **Auth** | JWT (Passport) + RBAC | - |
| **i18n** | English + Indonesian | - |

## Structure

```
apps/
  api/              NestJS backend (port 3001)
  web/              Next.js frontend (port 3000)
packages/
  backend/          Shared NestJS utilities (Auth, Audit, CRUD, Middleware, Pipes)
  database/         Prisma schema, migrations & generated client
  ui/               Shared React component library (40+ components)
plugins/
  sample-plugin/    Reference plugin implementation
  audit-log/        Audit log viewer plugin
scripts/            Generator & automation scripts
docs/               Architecture docs, ADRs & guides
```

## Prerequisites

- Node.js >= 24.15.0 (`.nvmrc`; `nvm use` picks it up)
- pnpm 9+
- Docker (for PostgreSQL)

## Configure Environment

Do this first: every step below reads `.env`.

```bash
cp .env.example .env
```

Key variables in `.env`:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5435/saas_db?schema=public
NEXT_PUBLIC_API_URL=http://localhost:3001
FRONTEND_URL=http://localhost:3000
DEFAULT_ADMIN_PASSWORD=change-this-in-prod
```

See `.env.example` for the full list including rate limiting, SMTP, uploads, and security settings.

This one file configures the web app too: `apps/web` reads its `NEXT_PUBLIC_*` lines (e.g. `NEXT_PUBLIC_API_URL`, where the browser reaches the API; default `http://localhost:3001`). It's built into the web bundle, so restart `pnpm dev` after changing it. A personal `apps/web/.env.local` still overrides it and is git-ignored.

## Getting Started

On a fresh clone, with PostgreSQL running and `.env` configured, one command runs steps 1–4 in order:

```bash
pnpm bootstrap
```

It's safe to run again: migrations only apply what's pending and the seed skips an existing system tenant. Or you can run these steps one by one:

### 1. Install dependencies

```bash
pnpm install
```

### 2. Run database migrations

Apply the committed migrations to the public schema:

```bash
pnpm db:migrate:deploy
```

(`pnpm db:migrate:dev` is for creating a new migration after you change the schema.)

### 3. Seed initial data

```bash
pnpm build
pnpm db:seed
```

This creates the system tenant, its roles and permissions, and the sysadmin `admin@system`, whose password is `DEFAULT_ADMIN_PASSWORD` from `.env` (in production the seed refuses the built-in default). Running it again leaves an existing system tenant, and its admin's password, as they are.

### 4. Migrate tenant schemas

After seeding (which registers tenants in the `public.Tenant` table):

```bash
pnpm db:migrate:tenants
```

### 5. Start development

```bash
pnpm dev
```

This starts both `api` (port 3001) and `web` (port 3000).

## Database Migrations

| Command | Description |
|---------|-------------|
| `pnpm db:generate` | Regenerate the Prisma client from the merged schema |
| `pnpm db:migrate:dev` | Create & apply migrations on public schema (dev) |
| `pnpm db:migrate:deploy` | Apply pending migrations (production) |
| `pnpm db:migrate:tenants` | Apply migrations to all tenant schemas |
| `pnpm db:migrate:status` | Check migration status |
| `pnpm db:studio` | Open Prisma Studio GUI |

To push schema changes to a specific tenant without migrations:

```bash
cd packages/database
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/saas_db?schema=tenant_slug" npx prisma db push --schema prisma/schema.prisma --skip-generate
```

## Multitenancy

The API uses a **schema-per-tenant** isolation strategy with PostgreSQL:

- **Public schema**: `Tenant`, `Plugin` records (system-wide)
- **Tenant schemas**: `tenant_{slug}` containing `User`, `Role`, `Permission`, `TenantConfig`, `AuditLog`
- Tenant is resolved via the `x-tenant-id` request header
- Login format: `username@tenant_slug`

### Database Models

**Core models**: Tenant, User, Role, Permission, Plugin, TenantConfig, AuditLog, AuditConfig

**Enums**: TenantStatus (ACTIVE/INACTIVE), UserStatus, Language (ENGLISH/INDONESIA), Currency (USD/IDR), Theme (LIGHT/DARK)

## Authentication & Authorization

- **JWT** with HttpOnly cookie storage (access + refresh tokens)
- **Refresh token rotation** for session security
- **RBAC** enforcement via `@Roles()` and `@Permissions()` decorators
- **Rate limiting**: 100 req/min global, 5 req/min on auth endpoints
- **Password reset** flow with email tokens

## API Endpoints

The API serves Swagger documentation at `http://localhost:3001/api`.

### Auth (`/auth`)
- `POST /auth/login` - Login with `identifier@tenant_slug`
- `POST /auth/refresh` - Refresh access token
- `POST /auth/logout` - Logout and clear cookies
- `GET /auth/profile` - Get current user profile
- `PATCH /auth/profile` - Update profile
- `POST /auth/change-password` - Change password
- `POST /auth/forgot-password` - Request password reset
- `POST /auth/reset-password` - Reset password with token

### Tenants (`/tenants`)
- `GET /tenants` - List all tenants (SYSADMIN)
- `POST /tenants` - Create tenant (SYSADMIN)
- `DELETE /tenants/:id` - Delete tenant (SYSADMIN)
- `GET /tenants/config` - Get current tenant config
- `PATCH /tenants/config` - Update current tenant config
- `PATCH /tenants/:id/status` - Update tenant status (SYSADMIN)

### System Management (`/system`)
- `/system/users` - User CRUD with bulk delete, CSV export
- `/system/roles` - Role CRUD with bulk delete, CSV export
- `/system/permissions` - Permission CRUD with bulk delete, CSV export

### Other
- `GET /dashboard` - Aggregated tenant dashboard
- `GET /health` - Health check (DB, memory, cache, tenant connections)
- `GET /plugins` - Plugin management (SYSADMIN)

## Security

- Input sanitization via `SanitizePipe` (XSS/injection prevention)
- Security headers via Helmet
- CORS with configurable origins
- Bcrypt password hashing
- Zod validation on all DTOs (backend & frontend)
- Environment variable validation at startup

## Audit Logging

Built-in audit trail with enterprise features:

- **Automatic logging** via `@Audit()` decorator and `AuditInterceptor`
- **Hash chain** integrity verification (SHA-256)
- **Sensitive field redaction** (passwords, tokens, secrets)
- **Per-tenant retention policies** with scheduled cleanup
- **Entity and action filtering** configuration
- **CSV export** for compliance

## Plugin System

### Database-aware Plugins

Plugins ship Prisma model fragments that are merged into the central schema:

- Fragment location: `plugins/<plugin>/src/database/prisma/fragment.prisma`
- Header file: `packages/database/prisma/header.prisma`

To regenerate the merged schema:

```bash
pnpm plugins:merge-prisma
pnpm db:generate
```

### Generate a New Plugin

```bash
pnpm plugin:new
```

The interactive generator creates a complete plugin with:

- NestJS module (controller, service, DTOs with Zod validation)
- React pages and components
- RBAC permissions
- i18n translations (English & Indonesian)
- Prisma schema fragment
- Menu configuration
- TypeScript configuration

After generation:

```bash
pnpm install
pnpm plugins:register
pnpm dev
```

See [Plugin Generator Guide](./docs/plugin-generator.md) for detailed documentation.

### Installed Plugins

| Plugin | Description |
|--------|-------------|
| `sample-plugin` | Reference implementation demonstrating plugin capabilities |
| `audit-log` | Audit log viewer with filtering, export, and hash chain validation |

### Manual Plugin Development

1. Create a directory in `plugins/`
2. Initialize `package.json` and `tsconfig.json`
3. Create your NestJS module and React pages
4. Add as a dependency in `apps/api/package.json`
5. Run `pnpm plugins:register` to auto-register

## Shared UI Components (`@saas/ui`)

The `packages/ui` package provides 40+ reusable React components built with Radix UI and Tailwind CSS.

### Component Categories

**Form Inputs**: Button (11 variants), Input, Textarea, Checkbox, Label, Switch, Select

**Data Display**: Pagination, SortableHeader, StatsCard, EmptyState, ErrorAlert, PageInfo

**Feedback**: Sonner (toasts), Spinner, Skeleton, Progress, Badge, FileUpload

**Overlays**: Dialog, ConfirmDialog, DeleteConfirmDialog, Sheet, DropdownMenu, Tooltip, Command

**Layout**: Tabs, Card, Separator, ScrollArea, Accordion, Avatar, PageContainer, PageHeader

**Auth/RBAC**: RbacProvider, Protect, Forbidden

**Hooks**: `useApi()`, `usePaginatedList()`, `useHotkey()`

### Usage

```tsx
import { Button, Input, PageContainer, PageHeader } from "@saas/ui";

function MyComponent() {
  return (
    <PageContainer>
      <PageHeader title="My Page" description="Page description" />
      <Input placeholder="Enter text" />
      <Button variant="primary">Submit</Button>
    </PageContainer>
  );
}
```

Add to your plugin's `package.json`:

```json
{
  "dependencies": {
    "@saas/ui": "workspace:*"
  }
}
```

## Frontend Routes

### Public
- `/login` - Authentication
- `/forgot-password` - Password recovery
- `/reset-password` - Reset password with token
- `/contact-sales` - Contact form

### Protected (Dashboard)
- `/` - Main dashboard
- `/account/profile` - User profile
- `/systems/users` - User management
- `/systems/roles` - Role management
- `/systems/permissions` - Permission management
- `/systems/preferences` - System preferences
- `/tenants` - Tenant management (SYSADMIN)
- `/plugins` - Plugin management

## Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm bootstrap` | Set up a fresh clone: install, migrate, build, seed, migrate tenant schemas |
| `pnpm dev` | Start API + Web in development mode |
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm lint` | Lint all packages |
| `pnpm format` | Format code with Prettier |
| `pnpm plugin:new` | Generate a new plugin |
| `pnpm plugins:register` | Auto-register plugins |
| `pnpm plugins:merge-prisma` | Merge plugin schema fragments |
| `pnpm db:generate` | Regenerate the Prisma client |
| `pnpm db:seed` | Seed initial data |
| `pnpm db:migrate:dev` | Run dev migrations (public schema) |
| `pnpm db:migrate:deploy` | Run production migrations |
| `pnpm db:migrate:tenants` | Migrate all tenant schemas |
| `pnpm db:studio` | Open Prisma Studio |

