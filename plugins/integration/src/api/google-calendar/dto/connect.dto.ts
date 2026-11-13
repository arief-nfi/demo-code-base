import { z } from 'zod';

export const connectCallbackSchema = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(1).max(256),
});

export type ConnectCallbackDto = z.infer<typeof connectCallbackSchema>;

export const disconnectSchema = z.object({
  deleteCalendar: z.boolean().default(false),
});

export type DisconnectDto = z.infer<typeof disconnectSchema>;

export const calendarSettingsSchema = z
  .object({
    calendarEnabled: z.boolean().optional(),
    meetEnabled: z.boolean().optional(),
    meetDefaultAccess: z.enum(['TRUSTED', 'OPEN', 'RESTRICTED']).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), { message: 'Nothing to change' });

export type CalendarSettingsDto = z.infer<typeof calendarSettingsSchema>;
