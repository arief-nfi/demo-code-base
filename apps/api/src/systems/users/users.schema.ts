import { z } from 'zod';

export const userEmailSchema = z
  .string()
  .email('Invalid email address');

export const userUsernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters long')
  .max(30, 'Username must be at most 30 characters long')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens');

export const userPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters long');

export const userNameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(100, 'Name must be at most 100 characters long');

export const userStatusSchema = z
  .enum(['ACTIVE', 'INACTIVE'])
  .optional();

export const userRolesSchema = z
  .array(z.string())
  .optional();

export const createUserSchema = z.object({
  email: userEmailSchema,
  username: userUsernameSchema,
  password: userPasswordSchema,
  name: userNameSchema,
  status: userStatusSchema,
  roleIds: userRolesSchema,
});

export const updateUserSchema = createUserSchema.partial().omit({ password: true }).extend({
  password: userPasswordSchema.optional(),
});

export const createUserSchemaWithUniqueCheck = (
  checkEmailUnique: (email: string) => Promise<boolean>,
  checkUsernameUnique: (username: string) => Promise<boolean>
) => {
  return z.object({
    email: userEmailSchema.refine(async (email) => {
      return await checkEmailUnique(email);
    }, {
      message: "User with this email already exists",
    }),
    username: userUsernameSchema.refine(async (username) => {
      return await checkUsernameUnique(username);
    }, {
      message: "User with this username already exists",
    }),
    password: userPasswordSchema,
    name: userNameSchema,
    status: userStatusSchema,
    roleIds: userRolesSchema,
  });
};

export const updateUserSchemaWithUniqueCheck = (
  checkEmailUnique: (email: string) => Promise<boolean>,
  checkUsernameUnique: (username: string) => Promise<boolean>
) => {
  return z.object({
    email: userEmailSchema.optional().refine(async (email) => {
      if (!email) return true;
      return await checkEmailUnique(email);
    }, {
      message: "User with this email already exists",
    }),
    username: userUsernameSchema.optional().refine(async (username) => {
      if (!username) return true;
      return await checkUsernameUnique(username);
    }, {
      message: "User with this username already exists",
    }),
    password: userPasswordSchema.optional(),
    name: userNameSchema.optional(),
    status: userStatusSchema,
    roleIds: userRolesSchema,
  });
};

export type CreateUserZodDto = z.infer<typeof createUserSchema>;
export type UpdateUserZodDto = z.infer<typeof updateUserSchema>;
