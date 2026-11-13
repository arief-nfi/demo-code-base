# @saas/backend

Shared backend utilities, services, and modules for the SaaS multitenant application.

## Overview

This package provides common backend functionality that can be used across:
- Main API (`apps/api`)
- All plugins (`plugins/*`)
- Other backend packages

## Features

### Prisma Integration
- **PrismaService**: Multi-tenant aware Prisma service with schema-based isolation
- **PrismaModule**: Global module that provides PrismaService across the application

### Authentication & Authorization
- **JwtAuthGuard**: JWT authentication guard using Passport
- **RbacGuard**: Role-Based Access Control guard for authorization
- **Decorators**: `@Roles()`, `@Permissions()`, `@RbacMode()` for declarative access control

### Validation
- **ZodValidationPipe**: Validation pipe for request validation using Zod schemas

### Usage

#### In NestJS Applications/Plugins

```typescript
import { 
  PrismaService, 
  PrismaModule,
  JwtAuthGuard,
  RbacGuard,
  Roles,
  Permissions,
  ZodValidationPipe
} from '@saas/backend';

// In your module
@Module({
  imports: [PrismaModule],
  // ...
})
export class YourModule {}

// In your controller - Using guards
@Controller('items')
@UseGuards(JwtAuthGuard, RbacGuard)
@Roles('admin', 'manager')
export class ItemsController {
  // ...
}

// In your controller - Using validation pipe
import { z } from 'zod';

const createItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

@Post()
async create(@Body(new ZodValidationPipe(createItemSchema)) body: z.infer<typeof createItemSchema>) {
  // body is validated and typed
}

// In your service - Using PrismaService
@Injectable()
export class YourService {
  constructor(private prisma: PrismaService) {}

  async getData(tenantSlug: string) {
    // Get tenant-specific Prisma client
    const tenantPrisma = this.prisma.getTenantClient(tenantSlug);
    
    // Query tenant-specific data
    return tenantPrisma.yourModel.findMany();
  }

  async getSystemData() {
    // Use public schema for system-wide data
    return this.prisma.tenant.findMany();
  }
}
```

## Multi-tenancy

The `PrismaService` automatically handles schema-based multi-tenancy:

- **Public Schema**: System-wide tables (Tenant, User, Plugin, Role)
- **Tenant Schemas**: Each tenant has `tenant_<slug>` schema

### Key Methods

- `getTenantClient(tenantSlug: string)`: Returns a Prisma client connected to the tenant's schema
- Default instance: Connected to the public schema for system tables

## Authentication & Authorization

### Guards

#### JwtAuthGuard
Validates JWT tokens using Passport strategy. Use this to protect routes that require authentication.

```typescript
@UseGuards(JwtAuthGuard)
@Get('profile')
getProfile(@Request() req) {
  return req.user;
}
```

#### RbacGuard
Enforces role and permission-based access control. Must be used with `JwtAuthGuard`.

```typescript
@UseGuards(JwtAuthGuard, RbacGuard)
@Roles('admin')
@Get('admin-only')
adminRoute() {
  // Only accessible by users with 'admin' role
}
```

### Decorators

#### @Roles(...roles: string[])
Specifies required roles for accessing a route.

```typescript
@Roles('admin', 'manager')
```

#### @Permissions(...permissions: string[])
Specifies required permissions for accessing a route.

```typescript
@Permissions('user.create', 'user.edit')
```

#### @RbacMode(mode: 'AND' | 'OR')
Defines how roles and permissions are evaluated (default: 'OR').

```typescript
// User must have BOTH role AND permission
@Roles('admin')
@Permissions('user.delete')
@RbacMode('AND')

// User needs EITHER role OR permission
@Roles('admin')
@Permissions('user.view')
@RbacMode('OR')
```

## Validation

### ZodValidationPipe
Validates request data using Zod schemas. Automatically parses and validates incoming data, throwing `BadRequestException` if validation fails.

```typescript
import { ZodValidationPipe } from '@saas/backend';
import { z } from 'zod';

// Define your schema
const updateUserSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email').optional(),
  age: z.number().min(18).optional(),
});

type UpdateUserDto = z.infer<typeof updateUserSchema>;

// Use in controller — apply pipe to @Body() parameter, not @UsePipes() at method level
@Patch(':id')
async updateUser(
  @Param('id') id: string,
  @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserDto
) {
  // body is validated and properly typed
  return this.userService.update(id, body);
}
```

**Benefits:**
- Type-safe validation with TypeScript inference
- Detailed error messages
- Works with any Zod schema (objects, arrays, unions, etc.)
- Consistent validation across your application

## Development

```bash
# Build the package
pnpm build

# Watch mode for development
pnpm dev
```

## Adding New Utilities

1. Create your utility/service in `src/`
2. Export it from the appropriate index file
3. Update `src/index.ts` to include your exports
4. Build the package

Example structure:
```
src/
  auth/
    jwt-auth.guard.ts
    rbac.guard.ts
    rbac.decorator.ts
    index.ts
  prisma/
    prisma.service.ts
    prisma.module.ts
    index.ts
  pipes/
    zod-validation.pipe.ts
    index.ts
  utils/
    your-utility.ts
    index.ts
  index.ts
```

## Exports

The package exports the following:

### Prisma
- `PrismaService` - Multi-tenant database service
- `PrismaModule` - Global module for Prisma

### Authentication & Authorization
- `JwtAuthGuard` - JWT authentication guard
- `RbacGuard` - Role-based access control guard
- `Roles` - Decorator for required roles
- `Permissions` - Decorator for required permissions
- `RbacMode` - Decorator for AND/OR mode
- `ROLES_KEY`, `PERMISSIONS_KEY`, `RBAC_MODE_KEY` - Metadata keys

### Validation
- `ZodValidationPipe` - Zod schema validation pipe

## License

Private workspace package
