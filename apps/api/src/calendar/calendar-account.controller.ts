import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  CALENDAR_PROVIDER,
  JwtAuthGuard,
  ZodValidationPipe,
  type AuthenticatedRequest,
  type CalendarConnectionSummary,
  type ICalendarProvider,
} from '@saas/backend';

const disconnectSchema = z.object({ deleteCalendar: z.boolean().default(false) });

/**
 * The signed-in user's own calendar connection, for their account page. Only a session is
 * required (no plugin guard): people can see and leave their connection even while the
 * plugin that made it is switched off or unpaid.
 */
@ApiTags('Calendar')
@ApiBearerAuth()
@Controller('calendar/connection')
@UseGuards(JwtAuthGuard)
export class CalendarAccountController {
  constructor(private readonly moduleRef: ModuleRef) {}

  private tenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) throw new Error('Tenant context is required');
    return req.tenant.slug;
  }

  private provider(): ICalendarProvider | null {
    try {
      const provider = this.moduleRef.get<ICalendarProvider>(CALENDAR_PROVIDER, { strict: false });
      return provider.isConfigured() ? provider : null;
    } catch {
      return null; // no plugin provides a calendar
    }
  }

  @Get()
  @ApiOperation({ summary: "The caller's calendar connection, if any" })
  async mine(@Req() req: AuthenticatedRequest): Promise<{ connection: CalendarConnectionSummary | null }> {
    const provider = this.provider();
    return { connection: provider ? await provider.connectionOf(this.tenantSlug(req), req.user.userId) : null };
  }

  @Post('disconnect')
  @ApiOperation({ summary: "Disconnect the caller's calendar, optionally deleting the app's calendar" })
  async disconnect(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(disconnectSchema)) body: z.infer<typeof disconnectSchema>) {
    await this.provider()?.disconnect(this.tenantSlug(req), req.user.userId, { deleteCalendar: body.deleteCalendar });
    return { status: 'DISCONNECTED' };
  }
}
