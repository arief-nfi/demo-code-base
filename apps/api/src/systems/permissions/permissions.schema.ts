import { z } from 'zod';

export const permissionNameSchema = z
  .string()
  .min(3, 'Name must be at least 3 characters long')
  .max(50, 'Name must be at most 50 characters long')
  .regex(/^[a-z0-9]+(\.[a-z0-9]+)*$/, 'Name must be in format "resource.action" (lowercase, dot-separated)');

export const permissionDescriptionSchema = z
  .string()
  .max(255, 'Description must be at most 255 characters long')
  .optional();

export const createPermissionSchema = z.object({
  name: permissionNameSchema,
  description: permissionDescriptionSchema,
});

export const updatePermissionSchema = createPermissionSchema.partial();

export const createPermissionSchemaWithUniqueCheck = (checkUnique: (name: string) => Promise<boolean>) => {
  return z.object({
    name: permissionNameSchema.refine(async (name) => {
      return await checkUnique(name);
    }, {
      message: "Permission with this name already exists",
    }),
    description: permissionDescriptionSchema,
  });
};

export const updatePermissionSchemaWithUniqueCheck = (checkUnique: (name: string) => Promise<boolean>) => {
  return z.object({
    name: permissionNameSchema.optional().refine(async (name) => {
      if (!name) return true;
      return await checkUnique(name);
    }, {
      message: "Permission with this name already exists",
    }),
    description: permissionDescriptionSchema,
  });
};

export type CreatePermissionZodDto = z.infer<typeof createPermissionSchema>;
export type UpdatePermissionZodDto = z.infer<typeof updatePermissionSchema>;
