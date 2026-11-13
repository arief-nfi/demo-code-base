// plugins/sample-plugin/src/api/sample-articles/sample-article-meetings.controller.ts
import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  JwtAuthGuard,
  PluginEnabledGuard,
  PluginKey,
  RbacGuard,
  Permissions,
  Roles,
  ZodValidationPipe,
} from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import {
  createReviewMeetingSchema,
  CreateReviewMeetingDto,
  scheduleReviewMeetingSchema,
  ScheduleReviewMeetingDto,
} from './dto/review-meeting.dto';
import { SampleArticleMeetingsService } from './sample-article-meetings.service';

@ApiTags('Sample Plugin - Articles')
@ApiBearerAuth()
@Controller('plugins/sample-plugin/articles/:id/review-meeting')
@PluginKey('sample-plugin')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@Roles('ADMIN')
export class SampleArticleMeetingsController {
  constructor(private readonly service: SampleArticleMeetingsService) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Get()
  @Permissions('sample-plugin.article.read')
  @ApiOperation({ summary: "Get an article's review meeting" })
  @ApiResponse({ status: 200, description: 'The meeting and who hosts it, or nulls' })
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.service.get(this.getTenantSlug(req), id, req.user.userId);
  }

  @Post()
  @Permissions('sample-plugin.article.write')
  @ApiOperation({ summary: 'Create the review meeting, hosted by the caller' })
  @ApiResponse({ status: 201, description: 'The meeting result: created, existing, or why there is none' })
  create(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createReviewMeetingSchema)) dto: CreateReviewMeetingDto,
  ) {
    return this.service.create(this.getTenantSlug(req), id, req.user.userId, dto.access);
  }

  @Delete()
  @Permissions('sample-plugin.article.write')
  @ApiOperation({ summary: "Cancel the review meeting and take it off the host's calendar" })
  @ApiResponse({ status: 200, description: 'Whether it was cancelled and locked' })
  cancel(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.service.cancel(this.getTenantSlug(req), id);
  }

  @Post('schedule')
  @Permissions('sample-plugin.article.write')
  @ApiOperation({ summary: "Put the review on the host's calendar, with the join link" })
  @ApiResponse({ status: 201, description: 'The calendar status' })
  @ApiResponse({ status: 409, description: 'There is no active meeting' })
  schedule(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(scheduleReviewMeetingSchema)) dto: ScheduleReviewMeetingDto,
  ) {
    return this.service.schedule(this.getTenantSlug(req), id, req.user.userId, new Date(dto.start));
  }
}
