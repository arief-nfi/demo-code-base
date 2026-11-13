import { z } from 'zod';

export const createReviewMeetingSchema = z
  .object({
    access: z.enum(['TRUSTED', 'OPEN', 'RESTRICTED']).optional(),
  })
  .default({});

export type CreateReviewMeetingDto = z.infer<typeof createReviewMeetingSchema>;

export const scheduleReviewMeetingSchema = z.object({
  start: z.iso.datetime({ offset: true }),
});

export type ScheduleReviewMeetingDto = z.infer<typeof scheduleReviewMeetingSchema>;
