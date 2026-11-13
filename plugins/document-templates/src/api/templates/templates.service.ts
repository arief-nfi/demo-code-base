import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '@saas/backend';
import type { TemplateQueryDto } from './dto/template-query.dto';
import type { CreateTemplateDto } from './dto/create-template.dto';
import type { UpdateTemplateDto } from './dto/update-template.dto';

@Injectable()
export class TemplatesService {
  constructor(private prisma: PrismaService) {}

  private getClient(tenantSlug: string) {
    return this.prisma.getTenantClient(tenantSlug);
  }

  async findAll(tenantSlug: string, params: TemplateQueryDto) {
    const client = this.getClient(tenantSlug);
    const { page = 1, limit = 10, search, category, sortBy = 'updatedAt', sortOrder = 'desc' } = params;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (category) {
      where.category = category;
    }

    const [data, total] = await Promise.all([
      client.documentTemplate.findMany({
        where,
        skip: Number(skip),
        take: Number(limit),
        orderBy: { [sortBy]: sortOrder },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          category: true,
          paperSize: true,
          orientation: true,
          isDefault: true,
          isActive: true,
          version: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      client.documentTemplate.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string, tenantSlug: string) {
    const client = this.getClient(tenantSlug);
    const template = await client.documentTemplate.findUnique({ where: { id } });
    if (!template) {
      throw new NotFoundException(`Template with ID ${id} not found`);
    }
    return template;
  }

  async findBySlug(slug: string, tenantSlug: string) {
    const client = this.getClient(tenantSlug);
    const template = await client.documentTemplate.findUnique({ where: { slug } });
    if (!template) {
      throw new NotFoundException(`Template with slug '${slug}' not found`);
    }
    return template;
  }

  async create(createDto: CreateTemplateDto, tenantSlug: string, userId?: string) {
    const client = this.getClient(tenantSlug);

    const existing = await client.documentTemplate.findUnique({ where: { slug: createDto.slug } });
    if (existing) {
      throw new ConflictException(`Template with slug '${createDto.slug}' already exists`);
    }

    return client.documentTemplate.create({
      data: {
        ...createDto,
        createdBy: userId,
        updatedBy: userId,
      },
    });
  }

  async update(id: string, updateDto: UpdateTemplateDto, tenantSlug: string, userId?: string) {
    const client = this.getClient(tenantSlug);

    const existing = await client.documentTemplate.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Template with ID ${id} not found`);
    }

    if (updateDto.slug && updateDto.slug !== existing.slug) {
      const slugTaken = await client.documentTemplate.findUnique({ where: { slug: updateDto.slug } });
      if (slugTaken) {
        throw new ConflictException(`Template with slug '${updateDto.slug}' already exists`);
      }
    }

    return client.documentTemplate.update({
      where: { id },
      data: {
        ...updateDto,
        version: existing.version + 1,
        updatedBy: userId,
      },
    });
  }

  async remove(id: string, tenantSlug: string) {
    const client = this.getClient(tenantSlug);
    try {
      await client.documentRender.deleteMany({ where: { templateId: id } });
      await client.documentTemplate.delete({ where: { id } });
    } catch {
      throw new NotFoundException(`Template with ID ${id} not found`);
    }
  }

  async duplicate(id: string, tenantSlug: string, userId?: string) {
    const client = this.getClient(tenantSlug);
    const source = await client.documentTemplate.findUnique({ where: { id } });
    if (!source) {
      throw new NotFoundException(`Template with ID ${id} not found`);
    }

    let newSlug = `${source.slug}-copy`;
    let counter = 1;
    while (await client.documentTemplate.findUnique({ where: { slug: newSlug } })) {
      counter++;
      newSlug = `${source.slug}-copy-${counter}`;
    }

    return client.documentTemplate.create({
      data: {
        name: `${source.name} (Copy)`,
        slug: newSlug,
        description: source.description,
        category: source.category,
        htmlContent: source.htmlContent,
        cssContent: source.cssContent,
        headerHtml: source.headerHtml,
        footerHtml: source.footerHtml,
        paperSize: source.paperSize,
        orientation: source.orientation,
        marginTop: source.marginTop,
        marginBottom: source.marginBottom,
        marginLeft: source.marginLeft,
        marginRight: source.marginRight,
        sampleData: source.sampleData,
        isDefault: false,
        createdBy: userId,
        updatedBy: userId,
      },
    });
  }
}
