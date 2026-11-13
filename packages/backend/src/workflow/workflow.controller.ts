import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { Permissions } from '../auth/rbac.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from './workflow.service';
import type { AuthenticatedRequest } from '../types';

@Controller('workflow')
@UseGuards(JwtAuthGuard, RbacGuard)
export class WorkflowController {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly prisma: PrismaService,
  ) {}

  private getTenantSlug(req: AuthenticatedRequest): string {
    if (!req.tenant?.slug) throw new Error('Tenant context is required');
    return req.tenant.slug;
  }

  /**
   * List all workflow processes for the tenant (with all steps, including inactive).
   */
  @Get('processes')
  @Permissions('system.workflow.view')
  async listProcesses(@Req() req: AuthenticatedRequest) {
    const tenantSlug = this.getTenantSlug(req);
    const client = this.prisma.getTenantClient(tenantSlug);
    return client.workflowProcess.findMany({
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get a single process with all its steps.
   */
  @Get('processes/:processKey')
  @Permissions('system.workflow.view')
  async getProcess(
    @Param('processKey') processKey: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const tenantSlug = this.getTenantSlug(req);
    const client = this.prisma.getTenantClient(tenantSlug);
    return client.workflowProcess.findUniqueOrThrow({
      where: { pluginKey_processKey: { pluginKey: processKey.split('.')[0], processKey } },
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  /**
   * Get only active steps for a process (used by plugin UIs for progress indicators).
   * No special permission — any authenticated user can see the flow.
   */
  @Get('processes/:processKey/steps')
  async getActiveSteps(
    @Param('processKey') processKey: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.workflow.getActiveSteps(this.getTenantSlug(req), processKey);
  }

  /**
   * Toggle a workflow step on/off. Tenant admin only.
   */
  @Patch('steps/:stepId')
  @Permissions('system.workflow.manage')
  async toggleStep(
    @Param('stepId') stepId: string,
    @Body() body: { isActive: boolean },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.workflow.toggleStep(
      this.getTenantSlug(req),
      stepId,
      body.isActive,
    );
  }

  /**
   * Get transition history for a specific entity.
   */
  @Get('transitions/:processKey/:entityId')
  @Permissions('system.workflow.view')
  async getTransitionHistory(
    @Param('processKey') processKey: string,
    @Param('entityId') entityId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.workflow.getTransitionHistory(
      this.getTenantSlug(req),
      processKey,
      entityId,
    );
  }
}
