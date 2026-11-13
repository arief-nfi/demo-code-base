#!/usr/bin/env node

/**
 * Plugin Generator Script
 * Creates a new plugin with complete structure based on sample-plugin template
 *
 * Usage:
 *   Interactive:     node scripts/generate-plugin.js
 *   Non-interactive: node scripts/generate-plugin.js --name invoice-management --display "Invoice Management" --description "Manage invoices"
 *   With demo:       node scripts/generate-plugin.js --name invoice-management --demo
 *   Multi-resource:  node scripts/generate-plugin.js --name invoice --resources "invoice,payment,customer"
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ── Reserved names that conflict with existing workspace packages ────────
const RESERVED_NAMES = ['ui', 'backend', 'database', 'types'];
const pluginsDir = path.join(__dirname, '..', 'plugins');

// ── Name validation ─────────────────────────────────────────────────────

function validatePluginName(name) {
  const errors = [];

  // Validate kebab-case format
  if (!name || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
    errors.push(`Plugin name must be kebab-case (e.g., 'my-plugin'). Got: '${name}'`);
    return errors; // No point checking further
  }

  // Check reserved names
  if (RESERVED_NAMES.includes(name)) {
    errors.push(`'${name}' is a reserved name (conflicts with @saas/${name})`);
  }

  // Check existing plugin directories
  if (fs.existsSync(pluginsDir)) {
    const existingPlugins = fs.readdirSync(pluginsDir)
      .filter(f => fs.statSync(path.join(pluginsDir, f)).isDirectory());

    if (existingPlugins.includes(name)) {
      errors.push(`Plugin '${name}' already exists in plugins/ directory`);
    }

    // Check package name conflicts
    const candidateNames = [`@saas/${name}`, `@saas/plugin-${name}`];
    for (const existing of existingPlugins) {
      const pkgPath = path.join(pluginsDir, existing, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (candidateNames.includes(pkg.name)) {
          errors.push(`Package name '${pkg.name}' conflicts with existing plugin '${existing}'`);
        }
      }
    }
  }

  return errors;
}

// ── CLI argument parsing ─────────────────────────────────────────────────
function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  const BOOLEAN_FLAGS = ['demo'];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (BOOLEAN_FLAGS.includes(key)) {
        args[key] = true;
      } else if (i + 1 < argv.length) {
        args[key] = argv[i + 1];
        i++;
      }
    }
  }
  return args;
}

// ── String utilities ─────────────────────────────────────────────────────

function toPascalCase(str) {
  return str
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function toCamelCase(str) {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function toKebabCase(str) {
  return str.toLowerCase().replace(/\s+/g, '-');
}

// ── Directory structure ──────────────────────────────────────────────────

function createDirectoryStructure(pluginPath) {
  const dirs = [
    'src',
    'src/api',
    'src/api/dto',
    'src/web',
    'src/web/components',
    'src/web/lib',
    'src/web/pages',
    'src/database',
    'src/database/prisma',
  ];

  dirs.forEach(dir => {
    const dirPath = path.join(pluginPath, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  });
}

// ── File generators ──────────────────────────────────────────────────────

function generatePackageJson(pluginName, displayName, description, author) {
  const packageName = `@saas/plugin-${pluginName}`;

  return {
    name: packageName,
    description: description,
    version: "1.0.0",
    displayName: displayName,
    pluginManifest: {
      key: pluginName,
      displayName: displayName,
      description: description,
      category: "general",
      tags: [],
      sdkVersion: "1",
      coreCompatibility: ">=0.0.0",
      pluginDependencies: {},
      pluginConflicts: []
    },
    author: {
      name: author.name,
      email: author.email,
      url: author.url
    },
    main: "./dist/api/index.js",
    types: "./dist/api/index.d.ts",
    exports: {
      "./api": {
        types: "./dist/api/index.d.ts",
        default: "./dist/api/index.js"
      },
      "./web": {
        types: "./dist/web/index.d.ts",
        default: "./dist/web/index.js"
      },
      "./menus": {
        types: "./dist/web/menus.d.ts",
        default: "./dist/web/menus.js"
      },
      "./permissions": {
        types: "./dist/permissions.d.ts",
        default: "./dist/permissions.js"
      },
      "./dictionaries": {
        types: "./dist/dictionaries.d.ts",
        default: "./dist/dictionaries.js"
      },
      "./lifecycle": {
        types: "./dist/lifecycle.d.ts",
        default: "./dist/lifecycle.js"
      },
      "./config-schema": {
        types: "./dist/config.schema.d.ts",
        default: "./dist/config.schema.js"
      }
    },
    scripts: {
      build: "tsc",
      test: "jest",
      "test:watch": "jest --watch",
      "test:cov": "jest --coverage"
    },
    dependencies: {
      "@saas/backend": "workspace:*",
      "@saas/database": "workspace:*",
      "@hookform/resolvers": "^5.2.2",
      "@nestjs/common": "^10.0.0",
      "@nestjs/core": "^10.0.0",
      "@nestjs/swagger": "^7.0.0",
      "@saas/ui": "workspace:*",
      "clsx": "^2.0.0",
      "lucide-react": "^0.359.0",
      "react-hook-form": "^7.48.0",
      "reflect-metadata": "^0.1.13",
      "sonner": "^2.0.7",
      "tailwind-merge": "^2.0.0",
      "zod": "^4.1.13"
    },
    peerDependencies: {
      "react": "^19.2.0",
      "react-dom": "^19.2.0"
    },
    devDependencies: {
      "@types/jest": "^29.0.0",
      "@types/node": "^25.0.3",
      "@types/react": "^19.2.0",
      "@types/react-dom": "^19.2.0",
      "jest": "^29.0.0",
      "ts-jest": "^29.0.0",
      "typescript": "^5.1.3"
    }
  };
}

function generateTsConfig() {
  return {
    compilerOptions: {
      module: "commonjs",
      declaration: true,
      removeComments: true,
      emitDecoratorMetadata: true,
      experimentalDecorators: true,
      allowSyntheticDefaultImports: true,
      target: "ES2021",
      sourceMap: true,
      outDir: "./dist",
      baseUrl: "./",
      incremental: true,
      skipLibCheck: true,
      jsx: "react-jsx",
      // Composite project: built by the shared dev watcher (`pnpm dev:watch`, tsc -b over
      // tsconfig.dev.json). rootDir keeps the dist layout identical to a plain `tsc` build.
      composite: true,
      rootDir: "./src",
      tsBuildInfoFile: "./dist/tsconfig.tsbuildinfo",
      // Spec files import the @saas/backend/testing helpers. That subpath only exists in
      // @saas/backend's package.json "exports", which this moduleResolution ignores, so
      // point it at the built typings (Jest maps it to the source via moduleNameMapper).
      paths: {
        "@saas/backend/testing": ["node_modules/@saas/backend/dist/testing"]
      }
    },
    include: ["src/**/*"],
    references: [{ path: "../../packages/backend" }]
  };
}

function generateApiIndex(pluginKebab) {
  return `export * from './${pluginKebab}.module';
`;
}

function generateApiModule(pluginPascal, pluginKebab) {
  return `import { Module } from '@nestjs/common';
import { PrismaModule } from '@saas/backend';
import { ${pluginPascal}Controller } from './${pluginKebab}.controller';
import { ${pluginPascal}Service } from './${pluginKebab}.service';

@Module({
  imports: [PrismaModule],
  controllers: [${pluginPascal}Controller],
  providers: [${pluginPascal}Service],
  exports: [${pluginPascal}Service],
})
export class ${pluginPascal}Module {}
`;
}

function generateApiController(pluginPascal, pluginKebab, pluginCamel) {
  return `import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, PluginEnabledGuard, PluginKey, RbacGuard, Permissions, Roles, ZodValidationPipe } from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import { ${pluginPascal}Service } from './${pluginKebab}.service';
import { Create${pluginPascal}Dto, create${pluginPascal}Schema } from './dto/create-${pluginKebab}.dto';
import { Update${pluginPascal}Dto, update${pluginPascal}Schema } from './dto/update-${pluginKebab}.dto';

@ApiTags('${pluginKebab}')
@Controller('plugins/${pluginKebab}')
@PluginKey('${pluginKebab}')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@ApiBearerAuth()
@Roles('ADMIN')
export class ${pluginPascal}Controller {
  constructor(private readonly ${pluginCamel}Service: ${pluginPascal}Service) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Post()
  @Permissions('${pluginKebab}.item.write')
  @ApiOperation({ summary: 'Create a new ${pluginKebab} item' })
  create(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(create${pluginPascal}Schema)) createDto: Create${pluginPascal}Dto) {
    return this.${pluginCamel}Service.create(this.getTenantSlug(req), createDto);
  }

  @Get()
  @Permissions('${pluginKebab}.item.read')
  @ApiOperation({ summary: 'Get all ${pluginKebab} items' })
  findAll(@Req() req: AuthenticatedRequest, @Query() query: any) {
    return this.${pluginCamel}Service.findAll(this.getTenantSlug(req), query);
  }

  @Get(':id')
  @Permissions('${pluginKebab}.item.read')
  @ApiOperation({ summary: 'Get a ${pluginKebab} item by ID' })
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.${pluginCamel}Service.findOne(this.getTenantSlug(req), id);
  }

  @Put(':id')
  @Permissions('${pluginKebab}.item.write')
  @ApiOperation({ summary: 'Update a ${pluginKebab} item' })
  update(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body(new ZodValidationPipe(update${pluginPascal}Schema)) updateDto: Update${pluginPascal}Dto) {
    return this.${pluginCamel}Service.update(this.getTenantSlug(req), id, updateDto);
  }

  @Delete(':id')
  @Permissions('${pluginKebab}.item.write')
  @ApiOperation({ summary: 'Delete a ${pluginKebab} item' })
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.${pluginCamel}Service.remove(this.getTenantSlug(req), id);
  }
}
`;
}

function generateApiService(pluginPascal, pluginKebab) {
  return `import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@saas/backend';
import { Create${pluginPascal}Dto } from './dto/create-${pluginKebab}.dto';
import { Update${pluginPascal}Dto } from './dto/update-${pluginKebab}.dto';

@Injectable()
export class ${pluginPascal}Service {
  constructor(private readonly prisma: PrismaService) {}

  // TODO: Remove the \`any\` return type once 'yourModel' below is replaced with a real model
  // (fragment.prisma → pnpm plugins:merge-prisma → pnpm db:generate) so queries are fully typed
  private getClient(tenantSlug: string): any {
    return this.prisma.getTenantClient(tenantSlug);
  }

  async findAll(tenantSlug: string, params: { page?: number; limit?: number; search?: string; sortBy?: string; sortOrder?: string }) {
    const client = this.getClient(tenantSlug);
    const { page = 1, limit = 10, search, sortBy = 'createdAt', sortOrder = 'desc' } = params;
    const skip = (Number(page) - 1) * Number(limit);

    const where = search
      ? { OR: [{ name: { contains: search, mode: 'insensitive' as const } }] }
      : {};

    // TODO: Replace 'yourModel' with your actual Prisma model name
    const [data, total] = await Promise.all([
      client.yourModel.findMany({
        where: where as any,
        skip,
        take: Number(limit),
        orderBy: { [sortBy]: sortOrder },
      }),
      client.yourModel.count({ where: where as any }),
    ]);

    return {
      data,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    };
  }

  async findOne(tenantSlug: string, id: string) {
    const client = this.getClient(tenantSlug);
    // TODO: Replace 'yourModel' with your actual Prisma model name
    const item = await client.yourModel.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  async create(tenantSlug: string, createDto: Create${pluginPascal}Dto) {
    const client = this.getClient(tenantSlug);
    // TODO: Replace 'yourModel' with your actual Prisma model name
    return client.yourModel.create({ data: createDto });
  }

  async update(tenantSlug: string, id: string, updateDto: Update${pluginPascal}Dto) {
    const client = this.getClient(tenantSlug);
    // TODO: Replace 'yourModel' with your actual Prisma model name
    return client.yourModel.update({ where: { id }, data: updateDto });
  }

  async remove(tenantSlug: string, id: string) {
    const client = this.getClient(tenantSlug);
    // TODO: Replace 'yourModel' with your actual Prisma model name
    return client.yourModel.delete({ where: { id } });
  }
}
`;
}

function generateEvents(pluginPascal, pluginKebab, pluginCamel) {
  return `import { z } from 'zod';

/**
 * ─────────────────────────────────────────────
 * Domain Event Constants
 * ─────────────────────────────────────────────
 * Naming convention: {plugin-key}.{entity}.{past-tense-verb}
 *
 * IMPORTANT: Every business action in your plugin that creates, updates,
 * deletes, or transitions the state of an entity MUST emit a domain event.
 * This enables other plugins to react (notifications, accounting entries,
 * webhooks, audit trails, etc.) without tight coupling.
 *
 * See: docs/DEVELOPMENT_GUIDE.md and PluginEventService in @saas/backend
 * ─────────────────────────────────────────────
 */
export const ${pluginPascal}Events = {
  // ${pluginPascal} entity events
  CREATED: '${pluginKebab}.${pluginCamel}.created',
  UPDATED: '${pluginKebab}.${pluginCamel}.updated',
  DELETED: '${pluginKebab}.${pluginCamel}.deleted',

  // Add more events as your plugin grows:
  // STATUS_CHANGED: '${pluginKebab}.${pluginCamel}.status-changed',
  // APPROVED: '${pluginKebab}.${pluginCamel}.approved',
  // EXPORTED: '${pluginKebab}.${pluginCamel}.exported',
} as const;

export type ${pluginPascal}EventName = (typeof ${pluginPascal}Events)[keyof typeof ${pluginPascal}Events];

/**
 * ─────────────────────────────────────────────
 * Event Payload Schemas (Zod)
 * ─────────────────────────────────────────────
 * Define the payload shape for each event. Include enough data for
 * consumers to act WITHOUT calling back into your service.
 * ─────────────────────────────────────────────
 */
const basePayload = z.object({
  tenantSlug: z.string(),
  userId: z.string(),
  timestamp: z.date(),
});

export const ${pluginPascal}CreatedPayload = basePayload.extend({
  ${pluginCamel}Id: z.string(),
  name: z.string(),
});

export type ${pluginPascal}CreatedEvent = z.infer<typeof ${pluginPascal}CreatedPayload>;

export const ${pluginPascal}UpdatedPayload = basePayload.extend({
  ${pluginCamel}Id: z.string(),
  changes: z.record(z.string(), z.unknown()),
});

export type ${pluginPascal}UpdatedEvent = z.infer<typeof ${pluginPascal}UpdatedPayload>;

export const ${pluginPascal}DeletedPayload = basePayload.extend({
  ${pluginCamel}Id: z.string(),
});

export type ${pluginPascal}DeletedEvent = z.infer<typeof ${pluginPascal}DeletedPayload>;
`;
}

function generateEventListener(pluginPascal, pluginKebab) {
  return `// Example: Subscribe to system events using @OnEvent or @OnPluginEvent
//
// import { Injectable } from '@nestjs/common';
// import { OnEvent } from '@nestjs/event-emitter';
// import { SystemEvents, OnPluginEvent, PrismaService, CacheService } from '@saas/backend';
// import type { UserCreatedEvent, BaseEventPayload } from '@saas/backend';
//
// @Injectable()
// export class ${pluginPascal}EventListener {
//   constructor(
//     private readonly prisma: PrismaService,
//     private readonly cache: CacheService,
//   ) {}
//
//   // Fires for ALL tenants (use when plugin check is not needed)
//   @OnEvent(SystemEvents.USER_CREATED)
//   async handleUserCreated(payload: UserCreatedEvent): Promise<void> {
//     console.log(\`[${pluginKebab}] User created: \${payload.username} in \${payload.tenantSlug}\`);
//   }
//
//   // Fires ONLY if '${pluginKebab}' is enabled for the tenant
//   @OnPluginEvent(SystemEvents.USER_UPDATED, '${pluginKebab}')
//   async handleUserUpdated(payload: BaseEventPayload): Promise<void> {
//     console.log(\`[${pluginKebab}] User updated in \${payload.tenantSlug}\`);
//   }
// }
//
// Don't forget to add ${pluginPascal}EventListener to the providers array in your module.
`;
}

function generateCreateDto(pluginPascal, pluginKebab) {
  return `import { z } from 'zod';

export const create${pluginPascal}Schema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
});

export type Create${pluginPascal}Dto = z.infer<typeof create${pluginPascal}Schema>;
`;
}

function generateUpdateDto(pluginPascal, pluginKebab) {
  return `import { z } from 'zod';
import { create${pluginPascal}Schema } from './create-${pluginKebab}.dto';

export const update${pluginPascal}Schema = create${pluginPascal}Schema.partial();

export type Update${pluginPascal}Dto = z.infer<typeof update${pluginPascal}Schema>;
`;
}

function generateWebIndex(pluginPascal, pluginKebab) {
  return `import { ${pluginPascal}Page } from './pages/${pluginPascal}Page';

export const ${pluginPascal}Routes = {
  '/': ${pluginPascal}Page,
};

export * from './pages/${pluginPascal}Page';
export * from './menus';
`;
}

function generateWebPage(pluginPascal, pluginKebab, pluginCamel, displayName) {
  return `'use client';

import { useState, useEffect } from 'react';
import {
  PageContainer, PageHeader, Card, CardHeader, CardTitle, CardDescription, CardContent,
  Button, Input, Badge, ErrorAlert,
  useLanguage, useRBAC, Forbidden, API_URL, getAuthHeaders, formatDate,
} from '@saas/ui';
import { toast } from 'sonner';
import { Plus, Search, RefreshCw } from 'lucide-react';

interface Item {
  id: string;
  name: string;
  description?: string | null;
  createdAt: string;
}

interface Meta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function ${pluginPascal}Page() {
  const { t } = useLanguage();
  const { authorize, isLoading: isRBACLoading } = useRBAC();

  const [items, setItems] = useState<Item[]>([]);
  const [meta, setMeta] = useState<Meta>({ total: 0, page: 1, limit: 10, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== debouncedSearch) {
        setDebouncedSearch(search);
        setMeta((prev) => ({ ...prev, page: 1 }));
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch]);

  const fetchItems = async () => {
    if (isRBACLoading) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: meta.page.toString(),
        limit: meta.limit.toString(),
      });
      if (debouncedSearch) params.append('search', debouncedSearch);

      const res = await fetch(\`\${API_URL}/plugins/${pluginKebab}?\${params}\`, {
        headers: getAuthHeaders() as Record<string, string>,
      });

      if (res.ok) {
        const data = await res.json();
        setItems(data.data);
        setMeta(data.meta);
      } else {
        setError(t('${pluginCamel}.items.fetchError'));
      }
    } catch (err) {
      console.error('Failed to fetch items', err);
      setError(t('${pluginCamel}.items.fetchError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isRBACLoading) fetchItems();
  }, [meta.page, debouncedSearch, isRBACLoading]);

  if (isRBACLoading) {
    return (
      <PageContainer>
        <div className="flex h-[50vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </PageContainer>
    );
  }

  if (!authorize({ roles: ['ADMIN'], permissions: ['${pluginKebab}.item.read'] })) {
    return <Forbidden />;
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('${pluginCamel}.items.title')}
        description={t('${pluginCamel}.items.description')}
      >
        <Button className="gap-2" onClick={() => toast.info('TODO: Implement create dialog')}>
          <Plus className="h-4 w-4" />
          {t('${pluginCamel}.items.create')}
        </Button>
      </PageHeader>

      {/* Search & Refresh */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('${pluginCamel}.items.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="icon" onClick={fetchItems}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Error state */}
      {error && <ErrorAlert message={error} onRetry={fetchItems} />}

      {/* Loading state */}
      {loading && !error && (
        <Card>
          <CardContent className="py-12">
            <div className="flex items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!loading && !error && items.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">{t('${pluginCamel}.items.noItems')}</p>
          </CardContent>
        </Card>
      )}

      {/* Data list */}
      {!loading && !error && items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle as="h3">{t('${pluginCamel}.items.title')}</CardTitle>
            <CardDescription>{meta.total} {meta.total === 1 ? 'item' : 'items'}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {items.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-3 gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{item.name}</p>
                    {item.description && (
                      <p className="text-sm text-muted-foreground truncate">{item.description}</p>
                    )}
                  </div>
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatDate(item.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
`;
}

function generateWebMenus(pluginPascal, pluginKebab, displayName) {
  return `import { Package } from 'lucide-react';

// Menu structure that matches the web app's NavigationItem shape
export const ${pluginPascal}Menus = [
  {
    name: '${displayName}',
    href: '/plugins/${pluginKebab}',
    icon: Package,
    roles: ['ADMIN'],
    permissions: ['${pluginKebab}.item.read'],
  },
];

export default ${pluginPascal}Menus;
`;
}

function generatePermissions(pluginPascal, pluginKebab, displayName) {
  return `/**
 * Permissions required by the ${displayName}
 * These will be automatically registered when a new tenant is created
 *
 * Format: {pluginKey}.{resource}.{action}
 */
export const ${pluginPascal}Permissions = [
  {
    name: '${pluginKebab}.item.read',
    description: 'Permission to view ${displayName.toLowerCase()} data'
  },
  {
    name: '${pluginKebab}.item.write',
    description: 'Permission to create, update, and delete ${displayName.toLowerCase()} data'
  }
];
`;
}

function generateDictionaries(pluginCamel, displayName) {
  return `import { Dictionaries } from '@saas/ui';

export const ${pluginCamel}Dictionaries: Dictionaries = {
  en: {
    ${pluginCamel}: {
      items: {
        title: '${displayName}',
        description: 'Manage ${displayName.toLowerCase()}',
        create: 'Create',
        search: 'Search...',
        name: 'Name',
        descriptionLabel: 'Description',
        createdAt: 'Created At',
        actions: 'Actions',
        view: 'View',
        edit: 'Edit',
        delete: 'Delete',
        noItems: 'No items found matching your criteria.',
        confirmDelete: 'Delete Item',
        confirmDeleteMessage: 'Are you sure you want to delete this item? This action cannot be undone.',
        deleteSuccess: 'Item deleted successfully',
        deleteError: 'Failed to delete item',
        fetchError: 'Failed to fetch data',
      },
    },
  },
  id: {
    ${pluginCamel}: {
      items: {
        title: '${displayName}',
        description: 'Kelola ${displayName.toLowerCase()}',
        create: 'Buat',
        search: 'Cari...',
        name: 'Nama',
        descriptionLabel: 'Deskripsi',
        createdAt: 'Dibuat Pada',
        actions: 'Aksi',
        view: 'Lihat',
        edit: 'Edit',
        delete: 'Hapus',
        noItems: 'Tidak ada item ditemukan yang sesuai dengan kriteria Anda.',
        confirmDelete: 'Hapus Item',
        confirmDeleteMessage: 'Apakah Anda yakin ingin menghapus item ini? Tindakan ini tidak dapat dibatalkan.',
        deleteSuccess: 'Item berhasil dihapus',
        deleteError: 'Gagal menghapus item',
        fetchError: 'Gagal mengambil data',
      },
    },
  },
};
`;
}

function generateLifecycle(pluginPascal, pluginKebab) {
  return `import { Logger } from '@nestjs/common';
import type { PluginLifecycle, PluginLifecycleContext, UpgradeContext, PluginHealthStatus } from '@saas/backend';

const logger = new Logger('${pluginPascal}Lifecycle');

export const ${pluginPascal}Lifecycle: PluginLifecycle = {
  async onInstall(context: PluginLifecycleContext): Promise<void> {
    logger.log(\`[tenant:\${context.tenantSlug}] Installing ${pluginKebab}\`);
    // TODO: Seed default settings, create plugin-specific resources, etc.
    //
    // Seed workflow (if your plugin has business processes with status transitions):
    //   import { createWorkflowSeeder } from '@saas/backend';
    //   import { PrismaClient } from '@saas/database';
    //   const client = new PrismaClient(/* scoped to tenant schema */);
    //   try {
    //     const seeder = createWorkflowSeeder(client);
    //     await seeder.seedProcess(context.pluginKey, '${pluginKebab}.entity', 'Entity Flow', [
    //       { state: 'CREATE', label: 'Create', sortOrder: 1, isMandatory: true },
    //       { state: 'REVIEW', label: 'Review', sortOrder: 2 },
    //       { state: 'ACTIVE', label: 'Active', sortOrder: 3, isMandatory: true },
    //     ]);
    //   } finally { await client.$disconnect(); }
  },

  async onActivate(context: PluginLifecycleContext): Promise<void> {
    logger.log(\`[tenant:\${context.tenantSlug}] Activating ${pluginKebab}\`);
    // TODO: Re-enable resources (lighter than onInstall)
  },

  async onDeactivate(context: PluginLifecycleContext): Promise<void> {
    logger.log(\`[tenant:\${context.tenantSlug}] Deactivating ${pluginKebab}\`);
    // TODO: Pause cron jobs, disable webhooks, etc.
  },

  async onUpgrade(context: UpgradeContext): Promise<void> {
    logger.log(\`[tenant:\${context.tenantSlug}] Upgrading ${pluginKebab} from \${context.fromVersion} to \${context.toVersion}\`);
    // TODO: Run data migrations between versions
  },

  async healthCheck(_context: PluginLifecycleContext): Promise<PluginHealthStatus> {
    // TODO: Verify plugin dependencies (DB tables exist, config valid, etc.)
    return { status: 'healthy', checkedAt: new Date() };
  },

  getDefaultConfig(): Record<string, unknown> {
    // TODO: Return default configuration values for this plugin
    return {};
  },
};
`;
}

function generateConfigSchema(pluginCamel, pluginKebab, displayName) {
  return `import { z } from 'zod';

/**
 * Configuration schema for ${displayName}.
 * This schema is validated when updating plugin config per tenant.
 * Default values are applied automatically.
 */
export const ${pluginCamel}ConfigSchema = z.object({
  // TODO: Define your plugin's configuration options
  // Example:
  // maxItems: z.number().min(1).default(100),
  // enableNotifications: z.boolean().default(false),
  // retentionDays: z.number().min(1).default(90),
});

export type ${toPascalCase(pluginKebab)}Config = z.infer<typeof ${pluginCamel}ConfigSchema>;
`;
}

function generatePrismaFragment(pluginKebab) {
  return `// Add your Prisma models here
// This fragment will be merged into the main schema.prisma
//
// Example:
// model ${toPascalCase(pluginKebab)}Item {
//   id          String   @id @default(uuid())
//   name        String
//   description String?
//   createdAt   DateTime @default(now())
//   updatedAt   DateTime @updatedAt
//
//   @@map("${pluginKebab}_items")
// }
`;
}

function generateReadme(pluginKebab, displayName, description) {
  return `# ${displayName}

${description}

## Features

- Feature 1 (TODO: describe your features)
- Feature 2
- Feature 3

## Installation

This plugin is automatically installed as part of the monorepo. To enable it for a tenant:

1. Ensure the plugin is built: \`pnpm build\`
2. Register the plugin in the system (admin panel)
3. Enable the plugin for the desired tenant

## Development

### Structure

\`\`\`
src/
├── api/              # Backend NestJS modules
│   ├── index.ts      # Module exports
│   ├── ${pluginKebab}.module.ts
│   ├── ${pluginKebab}.controller.ts
│   ├── ${pluginKebab}.service.ts
│   └── dto/          # Data Transfer Objects
├── web/              # Frontend React components
│   ├── index.ts      # Route exports
│   ├── menus.ts      # Menu definitions
│   ├── components/   # Reusable components
│   ├── lib/          # Utilities
│   └── pages/        # Page components
├── database/
│   └── prisma/
│       └── fragment.prisma  # Prisma schema fragment
├── permissions.ts    # RBAC permissions
└── dictionaries.ts   # i18n translations
\`\`\`

### Commands

- \`pnpm build\`: Build the plugin
- \`pnpm dev\`: Watch mode for development

### Adding Features

1. **Backend**: Add controllers, services, and DTOs in \`src/api/\`
2. **Frontend**: Add pages and components in \`src/web/\`
3. **Database**: Define models in \`src/database/prisma/fragment.prisma\`
4. **Permissions**: Add permissions in \`src/permissions.ts\`
5. **Translations**: Add translations in \`src/dictionaries.ts\`
6. **Menu**: Update menu in \`src/web/menus.ts\`

After making changes, run \`pnpm plugins:register\` from the root to update the registry.

## API Endpoints

- \`POST /plugins/${pluginKebab}\` - Create a new item
- \`GET /plugins/${pluginKebab}\` - Get all items
- \`GET /plugins/${pluginKebab}/:id\` - Get item by ID
- \`PUT /plugins/${pluginKebab}/:id\` - Update item
- \`DELETE /plugins/${pluginKebab}/:id\` - Delete item

## Permissions

- \`${pluginKebab}.item.read\` - View ${displayName.toLowerCase()} data
- \`${pluginKebab}.item.write\` - Create, update, and delete ${displayName.toLowerCase()} data

## License

Private - Part of SaaS Multitenant Monorepo
`;
}

function generateGitignore() {
  return `node_modules/
dist/
.turbo/
*.log
.DS_Store
*.tsbuildinfo
`;
}

// ── Minimal (no-demo) generators ─────────────────────────────────────────

function generateMinimalApiController(pluginPascal, pluginKebab, pluginCamel) {
  return `import {
  Controller,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, PluginEnabledGuard, PluginKey, RbacGuard, Roles } from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import { ${pluginPascal}Service } from './${pluginKebab}.service';

@ApiTags('${pluginKebab}')
@Controller('plugins/${pluginKebab}')
@PluginKey('${pluginKebab}')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@ApiBearerAuth()
@Roles('ADMIN')
export class ${pluginPascal}Controller {
  constructor(private readonly ${pluginCamel}Service: ${pluginPascal}Service) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  // TODO: Add your endpoints here
  // Example:
  // @Get()
  // @Permissions('${pluginKebab}.item.read')
  // @ApiOperation({ summary: 'Get all items' })
  // findAll(@Req() req: AuthenticatedRequest) {
  //   return this.${pluginCamel}Service.findAll(this.getTenantSlug(req));
  // }
}
`;
}

function generateMinimalApiService(pluginPascal) {
  return `import { Injectable } from '@nestjs/common';
import { PrismaService } from '@saas/backend';

@Injectable()
export class ${pluginPascal}Service {
  constructor(private readonly prisma: PrismaService) {}

  private getClient(tenantSlug: string) {
    return this.prisma.getTenantClient(tenantSlug);
  }

  // TODO: Add your service methods here
  // Example:
  // async findAll(tenantSlug: string) {
  //   const client = this.getClient(tenantSlug);
  //   return client.yourModel.findMany();
  // }
}
`;
}

function generateMinimalWebPage(pluginPascal, pluginKebab, pluginCamel) {
  return `'use client';

import {
  PageContainer, PageHeader, Card, CardHeader, CardTitle, CardDescription, CardContent,
  useLanguage, useRBAC, Forbidden,
} from '@saas/ui';

export function ${pluginPascal}Page() {
  const { t } = useLanguage();
  const { authorize, isLoading: isRBACLoading } = useRBAC();

  if (isRBACLoading) {
    return (
      <PageContainer>
        <div className="flex h-[50vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </PageContainer>
    );
  }

  if (!authorize({ roles: ['ADMIN'], permissions: ['${pluginKebab}.item.read'] })) {
    return <Forbidden />;
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('${pluginCamel}.title')}
        description={t('${pluginCamel}.description')}
      />

      <Card>
        <CardHeader>
          <CardTitle as="h3">Getting Started</CardTitle>
          <CardDescription>
            This plugin has been scaffolded. Start building your features here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>1. Define your Prisma model in <code className="bg-muted px-1 rounded">src/database/prisma/fragment.prisma</code></p>
            <p>2. Add service methods in <code className="bg-muted px-1 rounded">src/api/${pluginKebab}.service.ts</code></p>
            <p>3. Add controller endpoints in <code className="bg-muted px-1 rounded">src/api/${pluginKebab}.controller.ts</code></p>
            <p>4. Build your page UI in this file</p>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
`;
}

function generateMinimalDictionaries(pluginCamel, displayName) {
  return `import { Dictionaries } from '@saas/ui';

export const ${pluginCamel}Dictionaries: Dictionaries = {
  en: {
    ${pluginCamel}: {
      title: '${displayName}',
      description: 'Manage ${displayName.toLowerCase()}',
    },
  },
  id: {
    ${pluginCamel}: {
      title: '${displayName}',
      description: 'Kelola ${displayName.toLowerCase()}',
    },
  },
};
`;
}

// ── Test file generators ─────────────────────────────────────────────────

function generateJestConfig() {
  return `import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\\\.spec\\\\.ts$',
  transform: {
    '^.+\\\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    '**/*.controller.ts',
    '**/*.service.ts',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@saas/backend$': '<rootDir>/../../../packages/backend/src',
    '^@saas/backend/(.*)$': '<rootDir>/../../../packages/backend/src/$1',
    '^@saas/database$': '<rootDir>/../../../packages/database/src',
  },
};

export default config;
`;
}

function generateControllerSpec(pluginPascal, pluginKebab) {
  return `import { ${pluginPascal}Controller } from './${pluginKebab}.controller';

describe('${pluginPascal}Controller', () => {
  it('should be defined', () => {
    const controller = new ${pluginPascal}Controller({} as any);
    expect(controller).toBeDefined();
  });
});
`;
}

function generateServiceSpec(pluginPascal, pluginKebab) {
  return `import { ${pluginPascal}Service } from './${pluginKebab}.service';

describe('${pluginPascal}Service', () => {
  it('should be defined', () => {
    const service = new ${pluginPascal}Service({} as any);
    expect(service).toBeDefined();
  });
});
`;
}

// ── Multi-resource generators ────────────────────────────────────────────

function generateResourceModule(resourcePascal, resourceKebab, pluginKebab) {
  return `import { Module } from '@nestjs/common';
import { PrismaModule } from '@saas/backend';
import { ${resourcePascal}Controller } from './${resourceKebab}.controller';
import { ${resourcePascal}Service } from './${resourceKebab}.service';

@Module({
  imports: [PrismaModule],
  controllers: [${resourcePascal}Controller],
  providers: [${resourcePascal}Service],
  exports: [${resourcePascal}Service],
})
export class ${resourcePascal}Module {}
`;
}

function generateResourceController(resourcePascal, resourceKebab, resourceCamel, pluginKebab) {
  return `import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, PluginEnabledGuard, PluginKey, RbacGuard, Permissions, Roles } from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import { ${resourcePascal}Service } from './${resourceKebab}.service';

@ApiTags('${pluginKebab}/${resourceKebab}')
@Controller('plugins/${pluginKebab}/${resourceKebab}')
@PluginKey('${pluginKebab}')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@ApiBearerAuth()
@Roles('ADMIN')
export class ${resourcePascal}Controller {
  constructor(private readonly ${resourceCamel}Service: ${resourcePascal}Service) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Get()
  @Permissions('${pluginKebab}.${resourceKebab}.read')
  @ApiOperation({ summary: 'Get all ${resourceKebab}' })
  findAll(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.${resourceCamel}Service.findAll(this.getTenantSlug(req), query);
  }

  @Get(':id')
  @Permissions('${pluginKebab}.${resourceKebab}.read')
  @ApiOperation({ summary: 'Get a ${resourceKebab} by ID' })
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.${resourceCamel}Service.findOne(this.getTenantSlug(req), id);
  }

  @Post()
  @Permissions('${pluginKebab}.${resourceKebab}.write')
  @ApiOperation({ summary: 'Create a new ${resourceKebab}' })
  create(@Req() req: AuthenticatedRequest, @Body() createDto: Record<string, unknown>) {
    return this.${resourceCamel}Service.create(this.getTenantSlug(req), createDto);
  }

  @Put(':id')
  @Permissions('${pluginKebab}.${resourceKebab}.write')
  @ApiOperation({ summary: 'Update a ${resourceKebab}' })
  update(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() updateDto: Record<string, unknown>) {
    return this.${resourceCamel}Service.update(this.getTenantSlug(req), id, updateDto);
  }

  @Delete(':id')
  @Permissions('${pluginKebab}.${resourceKebab}.write')
  @ApiOperation({ summary: 'Delete a ${resourceKebab}' })
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.${resourceCamel}Service.remove(this.getTenantSlug(req), id);
  }
}
`;
}

function generateResourceService(resourcePascal) {
  return `import { Injectable } from '@nestjs/common';
import { PrismaService } from '@saas/backend';

@Injectable()
export class ${resourcePascal}Service {
  constructor(private readonly prisma: PrismaService) {}

  private getClient(tenantSlug: string) {
    return this.prisma.getTenantClient(tenantSlug);
  }

  // TODO: Replace 'yourModel' with your actual Prisma model name
  async findAll(tenantSlug: string, _query: Record<string, unknown>) {
    const _client = this.getClient(tenantSlug);
    return { data: [], total: 0 };
  }

  async findOne(tenantSlug: string, _id: string) {
    const _client = this.getClient(tenantSlug);
    return null;
  }

  async create(tenantSlug: string, _data: Record<string, unknown>) {
    const _client = this.getClient(tenantSlug);
    return {};
  }

  async update(tenantSlug: string, _id: string, _data: Record<string, unknown>) {
    const _client = this.getClient(tenantSlug);
    return {};
  }

  async remove(tenantSlug: string, _id: string) {
    const _client = this.getClient(tenantSlug);
    return {};
  }
}
`;
}

function generateResourceControllerSpec(resourcePascal, resourceKebab, pluginKebab) {
  return `import { ${resourcePascal}Controller } from './${resourceKebab}.controller';
import { createMockRequest } from '@saas/backend/testing';

describe('${resourcePascal}Controller', () => {
  let controller: ${resourcePascal}Controller;
  let mockService: {
    findAll: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };

  const mockReq = createMockRequest();

  beforeEach(() => {
    jest.clearAllMocks();
    mockService = {
      findAll: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue({}),
    };
    controller = new ${resourcePascal}Controller(mockService as any);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should return data', async () => {
      const result = await controller.findAll(mockReq, {});
      expect(result).toBeDefined();
      expect(mockService.findAll).toHaveBeenCalledWith('test-tenant', {});
    });
  });
});
`;
}

function generateResourceServiceSpec(resourcePascal, resourceKebab) {
  return `import { ${resourcePascal}Service } from './${resourceKebab}.service';
import { createMockPrismaService } from '@saas/backend/testing';
import { PrismaService } from '@saas/backend';

describe('${resourcePascal}Service', () => {
  let service: ${resourcePascal}Service;

  beforeEach(() => {
    const prisma = createMockPrismaService();
    service = new ${resourcePascal}Service(prisma as unknown as PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
`;
}

function generateMultiResourceApiIndex(resources, pluginKebab) {
  // The registry requires every exported *Module class (root + resources) to be re-exported here
  const exports = [
    `export * from './${pluginKebab}.module';`,
    ...resources.map(r => `export * from './${r.kebab}/${r.kebab}.module';`),
  ].join('\n');
  return exports + '\n';
}

// The root module is normally `${pluginPascal}Module`, but a resource named like the plugin
// (e.g. --name invoice --resources "invoice,payment") already owns that class name.
function getMultiResourceRootModuleName(pluginPascal, resources) {
  return resources.some(r => r.pascal === pluginPascal)
    ? `${pluginPascal}PluginModule`
    : `${pluginPascal}Module`;
}

function generateMultiResourceApiModule(pluginPascal, resources, pluginKebab) {
  const imports = resources.map(r =>
    `import { ${r.pascal}Module } from './${r.kebab}/${r.kebab}.module';`
  ).join('\n');
  const moduleList = resources.map(r => `${r.pascal}Module`).join(', ');

  return `import { Module } from '@nestjs/common';
${imports}

@Module({
  imports: [${moduleList}],
})
export class ${getMultiResourceRootModuleName(pluginPascal, resources)} {}
`;
}

function generateMultiResourcePermissions(pluginPascal, pluginKebab, resources, displayName) {
  const perms = resources.flatMap(r => [
    `  {\n    name: '${pluginKebab}.${r.kebab}.read',\n    description: 'Permission to view ${r.kebab} data'\n  }`,
    `  {\n    name: '${pluginKebab}.${r.kebab}.write',\n    description: 'Permission to create, update, and delete ${r.kebab} data'\n  }`,
  ]).join(',\n');

  return `/**
 * Permissions required by the ${displayName}
 * Format: {pluginKey}.{resource}.{action}
 */
export const ${pluginPascal}Permissions = [
${perms}
];
`;
}

function generateMultiResourceMenus(pluginPascal, pluginKebab, resources, displayName) {
  const children = resources.map(r =>
    `    {\n      name: '${r.pascal}',\n      href: '/plugins/${pluginKebab}/${r.kebab}',\n      icon: Package,\n      permissions: ['${pluginKebab}.${r.kebab}.read'],\n    }`
  ).join(',\n');

  return `import { Package } from 'lucide-react';

export const ${pluginPascal}Menus = [
  {
    name: '${displayName}',
    icon: Package,
    permissions: ['${pluginKebab}.${resources[0].kebab}.read'],
    children: [
${children},
    ],
  },
];

export default ${pluginPascal}Menus;
`;
}

function generateMultiResourceWebIndex(resources, pluginKebab, pluginPascal) {
  const imports = resources.map(r =>
    `import { ${r.pascal}Page } from './pages/${r.pascal}Page';`
  ).join('\n');
  const routes = resources.map(r =>
    `  '/${r.kebab}': ${r.pascal}Page,`
  ).join('\n');

  return `${imports}

export const ${pluginPascal}Routes = {
${routes}
};

export * from './menus';
`;
}

function generateMultiResourceWebPage(resourcePascal, resourceKebab, pluginKebab, pluginCamel) {
  return `'use client';

import {
  PageContainer, PageHeader, Card, CardHeader, CardTitle, CardDescription, CardContent,
  useLanguage, useRBAC, Forbidden,
} from '@saas/ui';

export function ${resourcePascal}Page() {
  const { t } = useLanguage();
  const { hasPermission } = useRBAC();

  if (!hasPermission('${pluginKebab}.${resourceKebab}.read')) {
    return <Forbidden />;
  }

  return (
    <PageContainer>
      <PageHeader title="${resourcePascal}" description="Manage ${resourceKebab}" />
      <Card>
        <CardHeader>
          <CardTitle>${resourcePascal}</CardTitle>
          <CardDescription>
            {/* TODO: Add your ${resourceKebab} management UI here */}
            Getting started with ${resourceKebab} management.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p>Start building your ${resourceKebab} interface here.</p>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
`;
}

function generateMultiResourcePrismaFragment(pluginKebab, resources) {
  const models = resources.map(r =>
    `// model ${r.pascal} {\n//   id          String   @id @default(uuid())\n//   name        String\n//   createdAt   DateTime @default(now())\n//   updatedAt   DateTime @updatedAt\n//\n//   @@map("${pluginKebab}_${r.kebab}")\n// }`
  ).join('\n\n');

  return `// Prisma schema fragment for the ${pluginKebab} plugin
// This fragment will be merged into the main schema.prisma
//
// Define your models below. Example models for each resource:

${models}
`;
}

function generateMultiResourceDictionaries(pluginCamel, resources, displayName) {
  const enKeys = resources.map(r =>
    `    ${r.camel}: {\n      title: '${r.pascal}',\n      description: 'Manage ${r.kebab}',\n    }`
  ).join(',\n');
  const idKeys = resources.map(r =>
    `    ${r.camel}: {\n      title: '${r.pascal}',\n      description: 'Kelola ${r.kebab}',\n    }`
  ).join(',\n');

  return `import { Dictionaries } from '@saas/ui';

export const ${pluginCamel}Dictionaries: Dictionaries = {
  en: {
    ${pluginCamel}: {
${enKeys},
    },
  },
  id: {
    ${pluginCamel}: {
${idKeys},
    },
  },
};
`;
}

function parseResourceList(resourcesStr) {
  if (!resourcesStr) return null;
  return resourcesStr.split(',').map(r => {
    const kebab = r.trim().toLowerCase().replace(/\s+/g, '-');
    return {
      kebab,
      pascal: toPascalCase(kebab),
      camel: toCamelCase(kebab),
    };
  }).filter(r => r.kebab.length > 0);
}

// ── TODO report ─────────────────────────────────────────────────────────

function walkFilesSync(dir, extensions) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFilesSync(fullPath, extensions));
    } else if (extensions.some(ext => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

function reportTodos(pluginDir) {
  const files = walkFilesSync(path.join(pluginDir, 'src'), ['.ts', '.tsx']);
  const todos = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (line.includes('TODO:') || line.includes('FIXME:')) {
        todos.push({
          file: path.relative(pluginDir, file),
          line: i + 1,
          text: line.trim(),
        });
      }
    });
  }

  if (todos.length > 0) {
    console.log('\n⚠  Action items before your plugin is ready:\n');
    for (const todo of todos) {
      console.log(`  ${todo.file}:${todo.line}`);
      console.log(`    ${todo.text}\n`);
    }
  }
}

// ── Interactive prompts ──────────────────────────────────────────────────

async function promptForPluginInfo() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  function ask(prompt) {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  }

  console.log('🚀 Plugin Generator\n');

  let pluginName = await ask('Plugin name (kebab-case, e.g., invoice-management): ');
  pluginName = pluginName.trim();

  const nameErrors = validatePluginName(pluginName);
  if (nameErrors.length > 0) {
    console.error('❌ Invalid plugin name:');
    nameErrors.forEach(e => console.error(`   - ${e}`));
    rl.close();
    process.exit(1);
  }

  let displayName = await ask(`Display name (default: ${toPascalCase(pluginName)}): `);
  displayName = displayName.trim() || toPascalCase(pluginName);

  let description = await ask(`Description (default: ${displayName} for SaaS Application): `);
  description = description.trim() || `${displayName} for SaaS Application`;

  let authorName = await ask('Author name (default: Developer): ');
  authorName = authorName.trim() || 'Developer';

  let authorEmail = await ask('Author email (default: developer@neo-fusion.com): ');
  authorEmail = authorEmail.trim() || 'developer@neo-fusion.com';

  let authorUrl = await ask('Author URL (default: https://git.neo-fusion.com/arief/saas-multitenant): ');
  authorUrl = authorUrl.trim() || 'https://git.neo-fusion.com/arief/saas-multitenant';

  let demoAnswer = await ask('Generate demo entity, controller, service, and page? (y/N): ');
  demoAnswer = demoAnswer.trim().toLowerCase();
  const generateDemo = demoAnswer === 'y' || demoAnswer === 'yes';

  let resourcesStr = await ask('Resources (comma-separated, e.g., "invoice,payment,customer", leave empty for single): ');
  resourcesStr = resourcesStr.trim();
  const resources = parseResourceList(resourcesStr);

  rl.close();

  return {
    pluginName: toKebabCase(pluginName),
    displayName,
    description,
    generateDemo,
    resources,
    author: {
      name: authorName,
      email: authorEmail,
      url: authorUrl
    }
  };
}

function getPluginInfoFromArgs(args) {
  const pluginName = toKebabCase(args.name);

  const nameErrors = validatePluginName(pluginName);
  if (nameErrors.length > 0) {
    console.error('❌ Invalid plugin name:');
    nameErrors.forEach(e => console.error(`   - ${e}`));
    process.exit(1);
  }

  const displayName = args.display || toPascalCase(pluginName);
  const description = args.description || `${displayName} for SaaS Application`;

  return {
    pluginName,
    displayName,
    description,
    generateDemo: args.demo === true,
    resources: parseResourceList(args.resources),
    author: {
      name: args.author || 'Developer',
      email: args.email || 'developer@neo-fusion.com',
      url: args.url || 'https://git.neo-fusion.com/arief/saas-multitenant'
    }
  };
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  try {
    // Get plugin information (interactive or from CLI args)
    const args = parseArgs();
    const { pluginName, displayName, description, generateDemo, resources, author } = args.name
      ? getPluginInfoFromArgs(args)
      : await promptForPluginInfo();

    const pluginPascal = toPascalCase(pluginName);
    const pluginCamel = toCamelCase(pluginName);
    const pluginKebab = pluginName;

    // Create plugin directory
    const pluginPath = path.join(pluginsDir, pluginKebab);

    const isMultiResource = resources && resources.length > 0;
    const modeLabel = isMultiResource
      ? `Multi-resource (${resources.map(r => r.kebab).join(', ')})`
      : generateDemo ? 'With demo (entity, controller, service, page)' : 'Scaffold only (minimal)';

    console.log(`\n📦 Creating plugin: ${pluginKebab}`);
    console.log(`📁 Location: ${pluginPath}`);
    console.log(`🎯 Mode: ${modeLabel}\n`);

    // Create directory structure
    createDirectoryStructure(pluginPath);

    // Generate files based on mode
    let files;

    if (isMultiResource) {
      // ── Multi-resource mode ──
      files = [
        // Root files
        ['package.json', JSON.stringify(generatePackageJson(pluginKebab, displayName, description, author), null, 2)],
        ['tsconfig.json', JSON.stringify(generateTsConfig(), null, 2)],
        ['.gitignore', generateGitignore()],
        ['README.md', generateReadme(pluginKebab, displayName, description)],

        // API files (root module + index)
        ['src/api/index.ts', generateMultiResourceApiIndex(resources, pluginKebab)],
        [`src/api/${pluginKebab}.module.ts`, generateMultiResourceApiModule(pluginPascal, resources, pluginKebab)],

        // Web files
        ['src/web/index.ts', generateMultiResourceWebIndex(resources, pluginKebab, pluginPascal)],
        ['src/web/menus.ts', generateMultiResourceMenus(pluginPascal, pluginKebab, resources, displayName)],

        // Test files
        ['jest.config.ts', generateJestConfig()],

        // Plugin system files
        ['src/events.ts', generateEvents(pluginPascal, pluginKebab, pluginCamel)],
        ['src/permissions.ts', generateMultiResourcePermissions(pluginPascal, pluginKebab, resources, displayName)],
        ['src/lifecycle.ts', generateLifecycle(pluginPascal, pluginKebab)],
        ['src/config.schema.ts', generateConfigSchema(pluginCamel, pluginKebab, displayName)],
        ['src/dictionaries.ts', generateMultiResourceDictionaries(pluginCamel, resources, displayName)],
        ['src/database/prisma/fragment.prisma', generateMultiResourcePrismaFragment(pluginKebab, resources)],

        // Placeholder files
        ['src/web/components/.gitkeep', ''],
        ['src/web/lib/.gitkeep', ''],
      ];

      // Per-resource files
      for (const r of resources) {
        files.push(
          [`src/api/${r.kebab}/${r.kebab}.module.ts`, generateResourceModule(r.pascal, r.kebab, pluginKebab)],
          [`src/api/${r.kebab}/${r.kebab}.controller.ts`, generateResourceController(r.pascal, r.kebab, r.camel, pluginKebab)],
          [`src/api/${r.kebab}/${r.kebab}.service.ts`, generateResourceService(r.pascal)],
          [`src/api/${r.kebab}/${r.kebab}.controller.spec.ts`, generateResourceControllerSpec(r.pascal, r.kebab, pluginKebab)],
          [`src/api/${r.kebab}/${r.kebab}.service.spec.ts`, generateResourceServiceSpec(r.pascal, r.kebab)],
          [`src/web/pages/${r.pascal}Page.tsx`, generateMultiResourceWebPage(r.pascal, r.kebab, pluginKebab, pluginCamel)],
        );
      }
    } else {
      // ── Single-resource mode (demo or scaffold) ──
      const controllerContent = generateDemo
        ? generateApiController(pluginPascal, pluginKebab, pluginCamel)
        : generateMinimalApiController(pluginPascal, pluginKebab, pluginCamel);

      const serviceContent = generateDemo
        ? generateApiService(pluginPascal, pluginKebab)
        : generateMinimalApiService(pluginPascal);

      const pageContent = generateDemo
        ? generateWebPage(pluginPascal, pluginKebab, pluginCamel, displayName)
        : generateMinimalWebPage(pluginPascal, pluginKebab, pluginCamel);

      const dictionariesContent = generateDemo
        ? generateDictionaries(pluginCamel, displayName)
        : generateMinimalDictionaries(pluginCamel, displayName);

      files = [
        // Root files
        ['package.json', JSON.stringify(generatePackageJson(pluginKebab, displayName, description, author), null, 2)],
        ['tsconfig.json', JSON.stringify(generateTsConfig(), null, 2)],
        ['.gitignore', generateGitignore()],
        ['README.md', generateReadme(pluginKebab, displayName, description)],

        // API files
        ['src/api/index.ts', generateApiIndex(pluginKebab)],
        [`src/api/${pluginKebab}.module.ts`, generateApiModule(pluginPascal, pluginKebab)],
        [`src/api/${pluginKebab}.controller.ts`, controllerContent],
        [`src/api/${pluginKebab}.service.ts`, serviceContent],
        ...(generateDemo ? [[`src/api/${pluginKebab}.event-listener.ts`, generateEventListener(pluginPascal, pluginKebab)]] : []),

        // Web files
        ['src/web/index.ts', generateWebIndex(pluginPascal, pluginKebab)],
        [`src/web/pages/${pluginPascal}Page.tsx`, pageContent],
        ['src/web/menus.ts', generateWebMenus(pluginPascal, pluginKebab, displayName)],

        // Test files
        ['jest.config.ts', generateJestConfig()],
        [`src/api/${pluginKebab}.controller.spec.ts`, generateControllerSpec(pluginPascal, pluginKebab)],
        [`src/api/${pluginKebab}.service.spec.ts`, generateServiceSpec(pluginPascal, pluginKebab)],

        // Plugin system files
        ['src/events.ts', generateEvents(pluginPascal, pluginKebab, pluginCamel)],
        ['src/permissions.ts', generatePermissions(pluginPascal, pluginKebab, displayName)],
        ['src/lifecycle.ts', generateLifecycle(pluginPascal, pluginKebab)],
        ['src/config.schema.ts', generateConfigSchema(pluginCamel, pluginKebab, displayName)],
        ['src/dictionaries.ts', dictionariesContent],
        ['src/database/prisma/fragment.prisma', generatePrismaFragment(pluginKebab)],

        // Placeholder files
        ['src/web/components/.gitkeep', ''],
        ['src/web/lib/.gitkeep', ''],
      ];

      // Only generate DTOs when demo mode is enabled
      if (generateDemo) {
        files.push(
          [`src/api/dto/create-${pluginKebab}.dto.ts`, generateCreateDto(pluginPascal, pluginKebab)],
          [`src/api/dto/update-${pluginKebab}.dto.ts`, generateUpdateDto(pluginPascal, pluginKebab)],
        );
      }
    }

    files.forEach(([filePath, content]) => {
      const fullPath = path.join(pluginPath, filePath);
      const dir = path.dirname(fullPath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(fullPath, content);
      console.log(`✅ Created: ${filePath}`);
    });

    // Report TODO placeholders
    reportTodos(pluginPath);

    console.log('\n✨ Plugin created successfully!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📕 READ FIRST: docs/DEVELOPMENT_GUIDE.md');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📋 Next steps:');
    if (isMultiResource) {
      console.log('  1. Define your Prisma models in src/database/prisma/fragment.prisma');
      console.log('  2. Implement service methods for each resource');
      console.log('  3. Add DTOs for request validation');
      console.log('  4. Define your domain events in src/events.ts');
      console.log('  5. Emit events from every create/update/delete/status-change in your services');
      console.log('  6. Customize the frontend pages');
    } else if (generateDemo) {
      console.log('  1. Review and customize the generated files');
      console.log('  2. Add your Prisma model in src/database/prisma/fragment.prisma');
      console.log('  3. Replace "yourModel" in the service with your actual model name');
      console.log('  4. Define your domain events in src/events.ts');
      console.log('  5. Emit events from every create/update/delete/status-change in your services');
      console.log('  6. Customize the frontend page and components');
    } else {
      console.log('  1. Define your Prisma model in src/database/prisma/fragment.prisma');
      console.log('  2. Add service methods in src/api/' + pluginKebab + '.service.ts');
      console.log('  3. Add controller endpoints in src/api/' + pluginKebab + '.controller.ts');
      console.log('  4. Add DTOs in src/api/dto/ for request validation');
      console.log('  5. Define your domain events in src/events.ts');
      console.log('  6. Emit events from every create/update/delete/status-change in your services');
      console.log('  7. Build your page UI in src/web/pages/' + pluginPascal + 'Page.tsx');
    }
    const n = isMultiResource ? 7 : generateDemo ? 7 : 8;
    console.log(`  ${n}. Run: pnpm plugins:register (updates registries, next.config.js, and dependencies)`);
    console.log(`  ${n + 1}. Run: pnpm install`);
    console.log(`  ${n + 2}. If you added database models, run in order:`);
    console.log(`       pnpm plugins:merge-prisma`);
    console.log(`       pnpm db:generate`);
    console.log(`       pnpm db:migrate:dev --name add-${pluginKebab}-models`);
    console.log(`       pnpm db:migrate:tenants`);
    console.log(`  ${n + 3}. Run: pnpm dev\n`);

  } catch (error) {
    console.error('❌ Error generating plugin:', error.message);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { main, generateTsConfig, generatePackageJson, generateLifecycle };
