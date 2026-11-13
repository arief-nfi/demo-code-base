import { Controller, Get, Patch, Delete, Put, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import { NotificationService } from './notification.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) throw new Error('Tenant context required');
    return req.tenant.slug;
  }

  private getUserId(req: AuthenticatedRequest): string {
    return (req.user as any)?.userId;
  }

  @Get()
  @ApiOperation({ summary: 'List notifications for current user' })
  findAll(
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('read') read?: string,
    @Query('category') category?: string,
  ) {
    return this.notificationService.findAll(
      this.getTenantSlug(req),
      this.getUserId(req),
      { limit: limit ? Number(limit) : undefined, offset: offset ? Number(offset) : undefined, read, category },
    );
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  getUnreadCount(@Req() req: AuthenticatedRequest) {
    return this.notificationService.getUnreadCount(this.getTenantSlug(req), this.getUserId(req));
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  markAsRead(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.notificationService.markAsRead(this.getTenantSlug(req), id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllAsRead(@Req() req: AuthenticatedRequest) {
    return this.notificationService.markAllAsRead(this.getTenantSlug(req), this.getUserId(req));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a notification' })
  async deleteNotification(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    await this.notificationService.deleteNotification(this.getTenantSlug(req), id);
    return { message: 'Notification deleted' };
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Get notification preferences' })
  getPreferences(@Req() req: AuthenticatedRequest) {
    return this.notificationService.getPreferences(this.getTenantSlug(req), this.getUserId(req));
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Update notification preferences' })
  updatePreferences(
    @Req() req: AuthenticatedRequest,
    @Body() body: Array<{ category: string; inApp: boolean; email: boolean }>,
  ) {
    return this.notificationService.updatePreferences(this.getTenantSlug(req), this.getUserId(req), body);
  }
}
