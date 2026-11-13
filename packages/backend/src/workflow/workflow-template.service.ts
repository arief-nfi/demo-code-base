import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';

interface CreateTemplateDto {
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
}

interface UpdateTemplateDto {
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
}

@Injectable()
export class WorkflowTemplateService {
  private readonly logger = new Logger(WorkflowTemplateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /**
   * List all workflow templates (optionally filtered by category).
   */
  async findAll(category?: string) {
    return this.prisma.workflowTemplate.findMany({
      where: category ? { category } : undefined,
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Get a single template by ID.
   */
  async findOne(id: string) {
    return this.prisma.workflowTemplate.findUniqueOrThrow({
      where: { id },
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  /**
   * Create a new workflow template (sysadmin only).
   */
  async create(dto: CreateTemplateDto) {
    if (!dto.steps || dto.steps.length < 2) {
      throw new BadRequestException('A workflow must have at least 2 steps');
    }

    // Validate unique state codes within the template
    const states = dto.steps.map((s) => s.state);
    const uniqueStates = new Set(states);
    if (uniqueStates.size !== states.length) {
      throw new BadRequestException('Step state codes must be unique within a workflow');
    }

    return this.prisma.workflowTemplate.create({
      data: {
        name: dto.name,
        category: dto.category,
        description: dto.description,
        steps: {
          create: dto.steps.map((s) => ({
            state: s.state,
            label: s.label,
            sortOrder: s.sortOrder,
            isMandatory: s.isMandatory ?? false,
            permissions: s.permissions ?? [],
          })),
        },
      },
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  /**
   * Update a workflow template (sysadmin only).
   * If steps are provided, they replace all existing steps.
   */
  async update(id: string, dto: UpdateTemplateDto) {
    const existing = await this.prisma.workflowTemplate.findUniqueOrThrow({
      where: { id },
    });

    // If steps are being replaced, validate them
    if (dto.steps) {
      if (dto.steps.length < 2) {
        throw new BadRequestException('A workflow must have at least 2 steps');
      }
      const states = dto.steps.map((s) => s.state);
      const uniqueStates = new Set(states);
      if (uniqueStates.size !== states.length) {
        throw new BadRequestException('Step state codes must be unique within a workflow');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Update template fields
      const updated = await tx.workflowTemplate.update({
        where: { id },
        data: {
          name: dto.name ?? existing.name,
          category: dto.category ?? existing.category,
          description: dto.description,
          isActive: dto.isActive,
        },
      });

      // Replace steps if provided
      if (dto.steps) {
        await tx.workflowTemplateStep.deleteMany({ where: { templateId: id } });
        await tx.workflowTemplateStep.createMany({
          data: dto.steps.map((s) => ({
            templateId: id,
            state: s.state,
            label: s.label,
            sortOrder: s.sortOrder,
            isMandatory: s.isMandatory ?? false,
            permissions: s.permissions ?? [],
          })),
        });
      }

      return tx.workflowTemplate.findUniqueOrThrow({
        where: { id },
        include: { steps: { orderBy: { sortOrder: 'asc' } } },
      });
    });
  }

  /**
   * Delete a workflow template (sysadmin only).
   */
  async remove(id: string) {
    await this.prisma.workflowTemplate.findUniqueOrThrow({ where: { id } });
    return this.prisma.workflowTemplate.delete({ where: { id } });
  }

  /**
   * Activate a workflow template for a tenant.
   * Copies the template steps into the tenant's WorkflowProcess table.
   */
  async activateForTenant(templateId: string, tenantSlug: string) {
    const template = await this.prisma.workflowTemplate.findUniqueOrThrow({
      where: { id: templateId },
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
    });

    if (!template.isActive) {
      throw new BadRequestException('Cannot activate an inactive template');
    }

    const client = this.prisma.getTenantClient(tenantSlug);

    // Use category as pluginKey, template name as processKey identifier
    const pluginKey = template.category;
    const processKey = `${template.category}.${template.name.toLowerCase().replace(/\s+/g, '-')}`;

    // Upsert the process — if it already exists, replace its steps
    const process = await client.workflowProcess.upsert({
      where: { pluginKey_processKey: { pluginKey, processKey } },
      update: { name: template.name, description: template.description },
      create: {
        pluginKey,
        processKey,
        name: template.name,
        description: template.description,
      },
    });

    // Replace steps
    await client.workflowStep.deleteMany({ where: { processId: process.id } });
    await client.workflowStep.createMany({
      data: template.steps.map((s) => ({
        processId: process.id,
        state: s.state,
        label: s.label,
        sortOrder: s.sortOrder,
        isMandatory: s.isMandatory,
        permissions: s.permissions,
      })),
    });

    // Invalidate cache
    await this.cache.del(`workflow:steps:${tenantSlug}:${processKey}`);

    this.logger.log(`Activated template "${template.name}" for tenant "${tenantSlug}" as process "${processKey}"`);

    return client.workflowProcess.findUniqueOrThrow({
      where: { id: process.id },
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  /**
   * List distinct categories from existing templates.
   */
  async getCategories(): Promise<string[]> {
    const results = await this.prisma.workflowTemplate.findMany({
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });
    return results.map((r) => r.category);
  }
}
