import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { JwtAuthGuard, Permissions, RbacGuard, Roles, ZodValidationPipe } from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import { EmailLogService, type EmailLogQuery } from './email-log.service';

const EMAIL = /^[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]+$/;
const blankToNull = (value: string | null | undefined) => (value === undefined ? undefined : value || null);

export const emailSettingsSchema = z.object({
  // Goes into the From header's display name: one line, no quotes or angle brackets
  senderName: z.string().trim().max(100).regex(/^[^\r\n"<>]*$/, 'No line breaks, quotes or angle brackets').nullable().optional().transform(blankToNull),
  replyTo: z.string().trim().max(254).refine((v) => v === '' || EMAIL.test(v), 'Not a valid email address').nullable().optional().transform(blankToNull),
});

export const emailLogQuerySchema = z.object({
  status: z.enum(['QUEUED', 'SENT', 'FAILED', 'SKIPPED']).optional(),
  template: z.string().max(200).optional(),
  /** A workspace log: its own emails, or the ones the platform sent it */
  origin: z.enum(['tenant', 'platform']).optional(),
  /** The platform log: the emails sent for one workspace (slug) */
  tenant: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).default(20).transform((n) => Math.min(n, 100)),
});

const tenantSlugOf = (req: AuthenticatedRequest): string => {
  if (!req.tenant?.slug) throw new BadRequestException('Tenant context is required');
  return req.tenant.slug;
};

/** Settings → Email: sender settings and the tenant's own email log. */
@ApiTags('Email')
@ApiBearerAuth()
@Controller('email')
@UseGuards(JwtAuthGuard, RbacGuard)
@Roles('ADMIN')
export class EmailAdminController {
  constructor(private readonly log: EmailLogService) {}

  @Get('settings')
  @Permissions('system.email.read')
  @ApiOperation({ summary: 'Sender name and reply-to for the tenant’s emails' })
  getSettings(@Req() req: AuthenticatedRequest) {
    return this.log.getSettings(tenantSlugOf(req));
  }

  @Patch('settings')
  @Permissions('system.email.write')
  @ApiOperation({ summary: 'Change the sender name and reply-to' })
  updateSettings(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(emailSettingsSchema)) body: z.infer<typeof emailSettingsSchema>) {
    return this.log.updateSettings(tenantSlugOf(req), body);
  }

  @Get('messages')
  @Permissions('system.email.read')
  @ApiOperation({ summary: 'The tenant’s email log (without message bodies)' })
  list(@Req() req: AuthenticatedRequest, @Query(new ZodValidationPipe(emailLogQuerySchema)) query: EmailLogQuery) {
    return this.log.list(tenantSlugOf(req), query);
  }

  @Get('messages/:id')
  @Permissions('system.email.read')
  @ApiOperation({ summary: 'One logged email, as sent (sensitive links hidden)' })
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.log.get(tenantSlugOf(req), id);
  }

  @Post('messages/:id/retry')
  @Permissions('system.email.write')
  @ApiOperation({ summary: 'Send a failed email again' })
  retry(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.log.retry(tenantSlugOf(req), id);
  }
}

/** The sysadmin's log of platform emails (public schema). */
@ApiTags('Email')
@ApiBearerAuth()
@Controller('email/platform')
@UseGuards(JwtAuthGuard, RbacGuard)
@Roles('SYSADMIN')
export class EmailPlatformController {
  constructor(private readonly log: EmailLogService) {}

  @Get('messages')
  @ApiOperation({ summary: 'Platform email log (tenant welcome, lifecycle, billing, contact sales)' })
  list(@Query(new ZodValidationPipe(emailLogQuerySchema)) query: EmailLogQuery) {
    return this.log.list(null, query);
  }

  @Get('messages/:id')
  @ApiOperation({ summary: 'One logged platform email' })
  get(@Param('id') id: string) {
    return this.log.get(null, id);
  }

  @Post('messages/:id/retry')
  @ApiOperation({ summary: 'Send a failed platform email again' })
  retry(@Param('id') id: string) {
    return this.log.retry(null, id);
  }
}
