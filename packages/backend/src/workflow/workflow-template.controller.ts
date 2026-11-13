import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { Roles, Permissions } from '../auth/rbac.decorator';
import { WorkflowTemplateService } from './workflow-template.service';
import type { AuthenticatedRequest } from '../types';

@Controller('workflow-templates')
@UseGuards(JwtAuthGuard, RbacGuard)
export class WorkflowTemplateController {
  constructor(private readonly templateService: WorkflowTemplateService) {}

  /**
   * List all workflow templates. Optionally filter by category.
   */
  @Get()
  @Permissions('system.workflow.view')
  async findAll(@Query('category') category?: string) {
    return this.templateService.findAll(category);
  }

  /**
   * Get distinct template categories.
   */
  @Get('categories')
  @Permissions('system.workflow.view')
  async getCategories() {
    return this.templateService.getCategories();
  }

  /**
   * Get a single template by ID.
   */
  @Get(':id')
  @Permissions('system.workflow.view')
  async findOne(@Param('id') id: string) {
    return this.templateService.findOne(id);
  }

  /**
   * Create a new workflow template (sysadmin only).
   */
  @Post()
  @Roles('SYSADMIN')
  async create(
    @Body()
    body: {
      name: string;
      category: string;
      description?: string;
      steps: Array<{
        state: string;
        label: string;
        sortOrder: number;
        isMandatory?: boolean;
        permissions?: string[];
      }>;
    },
  ) {
    return this.templateService.create(body);
  }

  /**
   * Update a workflow template (sysadmin only).
   */
  @Patch(':id')
  @Roles('SYSADMIN')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      category?: string;
      description?: string;
      isActive?: boolean;
      steps?: Array<{
        state: string;
        label: string;
        sortOrder: number;
        isMandatory?: boolean;
        permissions?: string[];
      }>;
    },
  ) {
    return this.templateService.update(id, body);
  }

  /**
   * Delete a workflow template (sysadmin only).
   */
  @Delete(':id')
  @Roles('SYSADMIN')
  async remove(@Param('id') id: string) {
    return this.templateService.remove(id);
  }

  /**
   * Activate a template for the current tenant.
   * Copies template steps into the tenant's workflow process table.
   */
  @Post(':id/activate')
  @Permissions('system.workflow.manage')
  async activate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    if (!req.tenant?.slug) throw new Error('Tenant context is required');
    return this.templateService.activateForTenant(id, req.tenant.slug);
  }
}
