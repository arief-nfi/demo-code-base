import { Controller, Get, Put, Post, Query, Body, UseGuards, Req, Res } from '@nestjs/common';
import { JwtAuthGuard, PluginEnabledGuard, PluginKey, RbacGuard, Permissions, AuditService, AuditRetentionCron, AuditConfigService, Roles, ZodValidationPipe } from '@saas/backend';
import type { AuthenticatedRequest } from '@saas/backend';
import type { Response } from 'express';
import { AuditQueryDto } from './dto/audit-query.dto';
import { auditExportSchema, AuditExportDto } from './dto/audit-export.dto';
import { auditRetentionSchema, AuditRetentionDto } from './dto/audit-retention.dto';
import { auditReplaySchema, AuditReplayDto } from './dto/audit-replay.dto';
import { auditVerifySchema, AuditVerifyDto } from './dto/audit-verify.dto';
import { auditConfigSchema, AuditConfigDto } from './dto/audit-config.dto';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@Controller('plugins/audit-log')
@PluginKey('audit-log')
@UseGuards(JwtAuthGuard, PluginEnabledGuard, RbacGuard)
@Roles('ADMIN')
export class AuditLogController {
  constructor(
    private readonly auditService: AuditService,
    private readonly retentionCron: AuditRetentionCron,
    private readonly auditConfigService: AuditConfigService,
  ) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) {
      throw new Error('Tenant context is required');
    }
    return req.tenant.slug;
  }

  @Get()
  @Permissions('audit-log.log.view')
  @ApiOperation({ summary: 'Get all audit logs' })
  @ApiResponse({ status: 200, description: 'Return all audit logs' })
  async getAuditLogs(
    @Req() req: AuthenticatedRequest,
    @Query() query: AuditQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.auditService.query(this.getTenantSlug(req), {
      entity: query.entity,
      entityId: query.entityId,
      userId: query.userId,
      action: query.action,
      search: query.search,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      page: query.page ? parseInt(query.page.toString()) : undefined,
      limit: query.limit ? parseInt(query.limit.toString()) : undefined,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });
  }

  @Get('export')
  @Permissions('audit-log.log.export')
  @ApiOperation({ summary: 'Export audit logs as CSV or JSON' })
  @ApiResponse({ status: 200, description: 'File download' })
  async exportAuditLogs(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(auditExportSchema)) query: AuditExportDto,
    @Res() res: Response,
  ) {
    const { format, ...filters } = query;
    const logs = await this.auditService.queryAll(this.getTenantSlug(req), {
      entity: filters.entity,
      entityId: filters.entityId,
      userId: filters.userId,
      action: filters.action,
      search: filters.search,
      startDate: filters.startDate ? new Date(filters.startDate) : undefined,
      endDate: filters.endDate ? new Date(filters.endDate) : undefined,
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=audit-logs-${timestamp}.csv`);
      res.send(this.formatCsv(logs));
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=audit-logs-${timestamp}.json`);
      res.send(JSON.stringify(logs, null, 2));
    }
  }

  private formatCsv(logs: any[]): string {
    const headers = ['Timestamp', 'User', 'Action', 'Entity', 'Entity ID', 'Changes', 'IP Address', 'User Agent'];
    const escapeField = (value: string): string => {
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    const rows = logs.map((log) => [
      log.timestamp ? new Date(log.timestamp).toISOString() : '',
      log.user?.name ?? 'System',
      log.action ?? '',
      log.entity ?? '',
      log.entityId ?? '',
      escapeField(log.changes ? JSON.stringify(log.changes) : ''),
      (log.metadata as any)?.requestIp ?? '',
      (log.metadata as any)?.userAgent ?? '',
    ].map(String).map(escapeField).join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  @Post('retention')
  @Permissions('audit-log.log.retention')
  @ApiOperation({ summary: 'Apply data retention policy to audit logs' })
  @ApiResponse({ status: 200, description: 'Audit logs retention applied successfully' })
  @ApiResponse({ status: 400, description: 'Invalid retention parameters' })
  async applyRetention(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(auditRetentionSchema)) dto: AuditRetentionDto,
  ): Promise<{ deleted: number; message: string }> {
    if (dto.type === 'time' && !dto.beforeDate) {
      throw new Error('beforeDate is required when type is "time"');
    }

    if (dto.type === 'count' && !dto.keepCount) {
      throw new Error('keepCount is required when type is "count"');
    }

    const deleted = await this.auditService.applyRetention(this.getTenantSlug(req), {
      type: dto.type,
      beforeDate: dto.beforeDate ? new Date(dto.beforeDate) : undefined,
      keepCount: dto.keepCount,
      backup: dto.backup ?? true,
    });

    return {
      deleted,
      message: `Successfully deleted ${deleted} audit log(s)`,
    };
  }

  @Post('replay')
  @Permissions('audit-log.log.replay')
  @ApiOperation({ summary: 'Replay failed audit log entries from fallback files' })
  @ApiResponse({ status: 200, description: 'Replay results' })
  async replayFallbackLogs(
    @Body(new ZodValidationPipe(auditReplaySchema)) dto: AuditReplayDto,
  ) {
    const result = await this.auditService.replayFallbackLogs({
      date: dto.date,
      dryRun: dto.dryRun,
    });

    return {
      ...result,
      message: dto.dryRun
        ? `Dry run: ${result.total} entries found, ${result.replayed} would be replayed`
        : `Replayed ${result.replayed} of ${result.total} entries (${result.failed} failed)`,
    };
  }

  @Get('verify')
  @Permissions('audit-log.log.verify')
  @ApiOperation({ summary: 'Verify audit log hash chain integrity' })
  @ApiResponse({ status: 200, description: 'Verification result' })
  async verifyIntegrity(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(auditVerifySchema)) query: AuditVerifyDto,
  ) {
    return this.auditService.verifyIntegrity(this.getTenantSlug(req), {
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    });
  }

  @Get('config')
  @Permissions('audit-log.config.manage')
  @ApiOperation({ summary: 'Get audit field configuration for this tenant' })
  @ApiResponse({ status: 200, description: 'Current audit config' })
  async getAuditConfig(@Req() req: AuthenticatedRequest) {
    const config = await this.auditConfigService.getConfig(this.getTenantSlug(req));
    return {
      ...config,
      isRetentionRunning: this.retentionCron.isRunning(),
    };
  }

  @Put('config')
  @Permissions('audit-log.config.manage')
  @ApiOperation({ summary: 'Update audit field configuration for this tenant' })
  @ApiResponse({ status: 200, description: 'Audit config updated successfully' })
  async updateAuditConfig(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(auditConfigSchema)) dto: AuditConfigDto,
  ) {
    const config = await this.auditConfigService.saveConfig(this.getTenantSlug(req), dto);
    return {
      ...config,
      message: 'Audit configuration updated successfully',
    };
  }
}
