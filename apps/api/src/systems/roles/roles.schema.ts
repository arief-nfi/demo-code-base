import { z } from 'zod';

export const roleNameSchema = z
  .string()
  .min(3, 'Name must be at least 3 characters long')
  .max(50, 'Name must be at most 50 characters long')
  .regex(/^[a-zA-Z0-9-_]+$/, 'Name must contain only letters, numbers, hyphens, and underscores');

export const roleDescriptionSchema = z
  .string()
  .max(255, 'Description must be at most 255 characters long')
  .optional();

export const rolePermissionIdsSchema = z
  .array(z.string().uuid('Invalid permission ID'))
  .optional();

export const createRoleSchema = z.object({
  name: roleNameSchema,
  description: roleDescriptionSchema,
  permissionIds: rolePermissionIdsSchema,
});

export const updateRoleSchema = createRoleSchema.partial();

export const createRoleSchemaWithUniqueCheck = (checkUnique: (name: string) => Promise<boolean>) => {
  return z.object({
    name: roleNameSchema.refine(async (name) => {
      return await checkUnique(name);
    }, {
      message: "Role with this name already exists",
    }),
    description: roleDescriptionSchema,
    permissionIds: rolePermissionIdsSchema,
  });
};

export const updateRoleSchemaWithUniqueCheck = (checkUnique: (name: string) => Promise<boolean>) => {
  return z.object({
    name: roleNameSchema.optional().refine(async (name) => {
      if (!name) return true;
      return await checkUnique(name);
    }, {
      message: "Role with this name already exists",
    }),
    description: roleDescriptionSchema,
    permissionIds: rolePermissionIdsSchema,
  });
};

export type CreateRoleZodDto = z.infer<typeof createRoleSchema>;
export type UpdateRoleZodDto = z.infer<typeof updateRoleSchema>;
