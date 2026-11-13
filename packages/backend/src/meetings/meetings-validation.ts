import { BadRequestException } from '@nestjs/common';
import { MEETING_ACCESS_TYPES, type MeetingCreateInput, type MeetingRef } from './meetings.types';

const SOURCE = /^[a-z0-9-]{1,64}$/;
const MAX_KEY = 200;
const MAX_TITLE = 200;

const invalid = (problem: string) => new BadRequestException(`Invalid meeting: ${problem}`);

export function validateMeetingRef(ref: MeetingRef): void {
  if (typeof ref.tenantSlug !== 'string' || !ref.tenantSlug) throw invalid('tenantSlug is required');
  if (typeof ref.source !== 'string' || !SOURCE.test(ref.source)) throw invalid('source must be lowercase letters, digits and "-" (at most 64)');
  if (typeof ref.key !== 'string' || ref.key.length < 1 || ref.key.length > MAX_KEY) throw invalid(`key must be 1–${MAX_KEY} characters`);
}

export function validateMeetingCreate(input: MeetingCreateInput): void {
  validateMeetingRef(input);
  if (typeof input.hostUserId !== 'string' || !input.hostUserId) throw invalid('hostUserId is required');
  if (input.title !== undefined && (typeof input.title !== 'string' || input.title.trim().length > MAX_TITLE)) {
    throw invalid(`title must be at most ${MAX_TITLE} characters`);
  }
  if (input.access !== undefined && !MEETING_ACCESS_TYPES.includes(input.access)) {
    throw invalid(`access must be one of ${MEETING_ACCESS_TYPES.join(', ')}`);
  }
}
