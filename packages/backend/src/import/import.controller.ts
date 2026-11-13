import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { ImportService } from './import.service';
import type { AuthenticatedRequest } from '../types';

@Controller('imports')
@UseGuards(JwtAuthGuard, RbacGuard)
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) throw new Error('Tenant context is required');
    return req.tenant.slug;
  }

  /**
   * List available import definitions (based on registered handlers).
   */
  @Get('definitions')
  getDefinitions() {
    return this.importService.getDefinitions();
  }

  /**
   * Validate parsed rows against an import definition.
   */
  @Post('validate')
  async validate(
    @Body() body: { importKey: string; rows: Record<string, unknown>[] },
  ) {
    if (!body.importKey || !body.rows) throw new BadRequestException('importKey and rows are required');
    return this.importService.validateRows(body.importKey, body.rows);
  }

  /**
   * Execute an import from pre-parsed rows.
   * The frontend handles file upload and parsing via POST /imports/parse,
   * then sends the parsed rows here to start the background job.
   */
  @Post('execute')
  async execute(
    @Body() body: {
      importKey: string;
      rows: Record<string, unknown>[];
      fileName: string;
      fileSize: number;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!body.importKey || !body.rows) {
      throw new BadRequestException('importKey and rows are required');
    }

    const tenantSlug = this.getTenantSlug(req);
    return this.importService.execute(
      tenantSlug,
      body.importKey,
      body.rows,
      req.user.userId,
      body.fileName || 'import',
      body.fileSize || 0,
    );
  }

  /**
   * Get import job status.
   */
  @Get('jobs/:jobId')
  async getJobStatus(
    @Param('jobId') jobId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.importService.getJobStatus(this.getTenantSlug(req), jobId);
  }

  /**
   * Get import history.
   */
  @Get('jobs')
  async getHistory(
    @Query('importKey') importKey: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.importService.getHistory(this.getTenantSlug(req), {
      importKey,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  /**
   * Download import template (Excel).
   */
  @Get('templates/:importKey')
  async getTemplate(
    @Param('importKey') importKey: string,
    @Res() res: any,
  ) {
    const buffer = await this.importService.getTemplate(importKey);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${importKey}-template.xlsx"`);
    res.send(buffer);
  }

  /**
   * Download error report for a completed import job.
   */
  @Get('jobs/:jobId/errors')
  async getErrorReport(
    @Param('jobId') jobId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: any,
  ) {
    const buffer = await this.importService.getErrorReport(this.getTenantSlug(req), jobId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="import-errors-${jobId}.xlsx"`);
    res.send(buffer);
  }
}
