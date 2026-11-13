import { Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  CALENDAR_SYNC,
  JwtAuthGuard,
  Permissions,
  PluginEnabledGuard,
  PluginKey,
  PrismaService,
  RbacGuard,
  Roles,
  ZodValidationPipe,
  type AuthenticatedRequest,
  type ICalendarSync,
} from '@saas/backend';
import { calendarSettingsSchema, connectCallbackSchema, disconnectSchema } from './dto/connect.dto';
import type { CalendarSettingsDto, ConnectCallbackDto, DisconnectDto } from './dto/connect.dto';
import { ConnectionsService } from './connections.service';
import { GoogleMeetProvider } from './google-meet.provider';

const CONNECT = 'integration.google-calendar.connect';
const MANAGE = 'integration.google-calendar.manage';

const syncLogQuerySchema = z.object({
  status: z.enum(['PENDING', 'SYNCED', 'FAILED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

type SyncLogQuery = z.infer<typeof syncLogQuerySchema>;

const meetingsQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'CANCELLED', 'ORPHANED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

type MeetingsQuery = z.infer<typeof meetingsQuerySchema>;

@ApiTags('Integration - Google Calendar')
@ApiBearerAuth()
@Controller('plugins/integration/google-calendar')
@PluginKey('integration')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@Roles('ADMIN')
export class GoogleCalendarController {
  constructor(
    private readonly connections: ConnectionsService,
    private readonly prisma: PrismaService,
    @Inject(CALENDAR_SYNC) private readonly calendarSync: ICalendarSync,
    private readonly meet: GoogleMeetProvider,
  ) {}

  private tenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) throw new Error('Tenant context is required');
    return req.tenant.slug;
  }

  @Get('me')
  @Permissions(CONNECT)
  @ApiOperation({ summary: "The caller's Google Calendar connection" })
  me(@Req() req: AuthenticatedRequest) {
    return this.connections.myStatus(this.tenantSlug(req), req.user.userId);
  }

  @Post('connect')
  @Permissions(CONNECT)
  @ApiOperation({ summary: "Start connecting: returns Google's consent URL" })
  connect(@Req() req: AuthenticatedRequest) {
    return this.connections.startConnect(this.tenantSlug(req), req.user.userId);
  }

  @Post('callback')
  @Permissions(CONNECT)
  @ApiOperation({ summary: 'Finish connecting with the code Google redirected back with' })
  callback(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(connectCallbackSchema)) body: ConnectCallbackDto) {
    return this.connections.completeConnect(this.tenantSlug(req), req.user.userId, body.code, body.state);
  }

  @Post('disconnect')
  @Permissions(CONNECT)
  @ApiOperation({ summary: 'Disconnect, optionally deleting the calendar from Google' })
  async disconnect(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(disconnectSchema)) body: DisconnectDto) {
    await this.connections.disconnect(this.tenantSlug(req), req.user.userId, { deleteCalendar: body.deleteCalendar });
    return { status: 'DISCONNECTED' };
  }

  @Get('settings')
  @Permissions(MANAGE)
  @ApiOperation({ summary: 'Whether Google is set up on the platform, and the tenant\'s Calendar and Meet settings' })
  async settings(@Req() req: AuthenticatedRequest) {
    const switches = await this.connections.featureSwitches(this.tenantSlug(req));
    return {
      configured: this.connections.configured,
      calendar: { enabled: switches.calendar },
      meet: { enabled: switches.meet, defaultAccess: switches.meetDefaultAccess },
    };
  }

  @Patch('settings')
  @Permissions(MANAGE)
  @ApiOperation({ summary: 'Switch Google Calendar or Meet on or off, or change the default joining rule' })
  async updateSettings(@Req() req: AuthenticatedRequest, @Body(new ZodValidationPipe(calendarSettingsSchema)) body: CalendarSettingsDto) {
    await this.connections.updateSettings(this.tenantSlug(req), body);
    return this.settings(req);
  }

  @Get('meetings')
  @Permissions(MANAGE)
  @ApiOperation({ summary: "The tenant's Meet meetings, newest first" })
  async meetings(@Req() req: AuthenticatedRequest, @Query(new ZodValidationPipe(meetingsQuerySchema)) query: MeetingsQuery) {
    const client = this.prisma.getTenantClient(this.tenantSlug(req));
    const where = query.status ? { status: query.status } : {};
    const [rows, total] = await Promise.all([
      client.meetingSpace.findMany({ where, include: { item: true }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      client.meetingSpace.count({ where }),
    ]);
    const users = await client.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.hostUserId))] } },
      select: { id: true, username: true, name: true, email: true },
    });
    const byId = new Map(users.map((user) => [user.id, user]));
    return {
      data: rows.map((row) => {
        const host = byId.get(row.hostUserId);
        return {
          id: row.id,
          title: row.item?.title ?? null,
          source: row.item?.source ?? null,
          key: row.item?.key ?? null,
          host: host ? { name: host.name || host.username, email: host.email } : null,
          joinUrl: row.joinUrl,
          access: row.access,
          status: row.status,
          lockState: row.lockState,
          lastError: row.lastError,
          // Only an item's current meeting can be cancelled from the list
          current: row.item?.currentSpaceId === row.id,
          createdAt: row.createdAt,
        };
      }),
      meta: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) },
    };
  }

  @Post('meetings/:id/cancel')
  @Permissions(MANAGE)
  @ApiOperation({ summary: 'Cancel a meeting: it is locked so guests have to knock' })
  async cancelMeeting(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const tenantSlug = this.tenantSlug(req);
    const space = await this.prisma.getTenantClient(tenantSlug).meetingSpace.findUnique({ where: { id }, include: { item: true } });
    if (!space?.item) throw new NotFoundException('Meeting not found');
    if (space.item.currentSpaceId !== space.id) throw new ConflictException('Only the current meeting of an item can be cancelled');
    return this.meet.cancel({ tenantSlug, source: space.item.source, key: space.item.key });
  }

  @Get('users')
  @Permissions(MANAGE)
  @ApiOperation({ summary: "Every user's connection status (never tokens)" })
  users(@Req() req: AuthenticatedRequest) {
    return this.connections.listUsers(this.tenantSlug(req));
  }

  @Get('sync-log')
  @Permissions(MANAGE)
  @ApiOperation({ summary: 'Synced events and their status, newest first' })
  async syncLog(@Req() req: AuthenticatedRequest, @Query(new ZodValidationPipe(syncLogQuerySchema)) query: SyncLogQuery) {
    const client = this.prisma.getTenantClient(this.tenantSlug(req));
    const where = query.status ? { status: query.status } : {};
    const [rows, total] = await Promise.all([
      client.calendarEventLink.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      client.calendarEventLink.count({ where }),
    ]);
    const users = await client.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.userId))] } },
      select: { id: true, username: true, name: true, email: true },
    });
    const byId = new Map(users.map((user) => [user.id, user]));

    return {
      // Only the title and start of the event: its description may hold the caller's private text
      data: rows.map((row) => {
        const desired = row.desired as { title?: string; start?: string } | null;
        const user = byId.get(row.userId);
        return {
          id: row.id,
          userId: row.userId,
          user: user ? { name: user.name || user.username, email: user.email } : null,
          source: row.source,
          key: row.key,
          title: desired?.title ?? null,
          start: desired?.start ?? null,
          status: row.status,
          attempts: row.attempts,
          lastError: row.lastError,
          syncedAt: row.syncedAt,
          updatedAt: row.updatedAt,
        };
      }),
      meta: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) },
    };
  }

  @Post('sync-log/:id/retry')
  @Permissions(MANAGE)
  @ApiOperation({ summary: 'Retry a failed sync' })
  async retry(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const tenantSlug = this.tenantSlug(req);
    const links = this.prisma.getTenantClient(tenantSlug).calendarEventLink;
    const row = await links.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Sync record not found');
    if (row.status !== 'FAILED') throw new ConflictException('Only failed syncs can be retried');

    await links.update({ where: { id }, data: { status: 'PENDING', attempts: 0, lastError: null } });
    await this.calendarSync.resync(tenantSlug, row.userId);
    return { status: 'PENDING' };
  }
}
