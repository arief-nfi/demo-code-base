import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@saas/backend';
import { Prisma } from '@saas/database';
import type { WebhookEventQueryDto } from './dto/webhook-event-query.dto';
import type { CreateWebhookEventDto } from './dto/create-webhook-event.dto';
import type { UpdateWebhookEventDto } from './dto/update-webhook-event.dto';

@Injectable()
export class WebhookEventsService {
  constructor(private prisma: PrismaService) {}

  private getClient(tenantSlug: string) {
    return this.prisma.getTenantClient(tenantSlug);
  }

  async findAll(tenantSlug: string, params: WebhookEventQueryDto) {
    const client = this.getClient(tenantSlug);
    const { page = 1, limit = 10, search, category, isActive, sortBy = 'createdAt', sortOrder = 'desc' } = params;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' as const } },
        { code: { contains: search, mode: 'insensitive' as const } },
      ];
    }

    if (category) {
      where.category = category;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [data, total] = await Promise.all([
      client.integrationWebhookEvent.findMany({
        where,
        skip: Number(skip),
        take: Number(limit),
        orderBy: { [sortBy]: sortOrder },
      }),
      client.integrationWebhookEvent.count({ where }),
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
    const event = await client.integrationWebhookEvent.findUnique({ where: { id } });
    if (!event) {
      throw new NotFoundException(`Webhook event with ID ${id} not found`);
    }
    return event;
  }

  async create(dto: CreateWebhookEventDto, tenantSlug: string) {
    const client = this.getClient(tenantSlug);
    const available = await this.checkCodeAvailable(dto.code, undefined, tenantSlug);
    if (!available) {
      throw new ConflictException(`Webhook event with code '${dto.code}' already exists`);
    }

    return client.integrationWebhookEvent.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        category: dto.category,
        payloadSchema: (dto.payloadSchema as Prisma.InputJsonValue) ?? undefined,
        samplePayload: (dto.samplePayload as Prisma.InputJsonValue) ?? undefined,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateWebhookEventDto, tenantSlug: string) {
    const client = this.getClient(tenantSlug);

    await this.findOne(id, tenantSlug);

    if (dto.code) {
      const available = await this.checkCodeAvailable(dto.code, id, tenantSlug);
      if (!available) {
        throw new ConflictException(`Webhook event with code '${dto.code}' already exists`);
      }
    }

    const { payloadSchema, samplePayload, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest };
    if (payloadSchema !== undefined) {
      data.payloadSchema = payloadSchema === null ? Prisma.JsonNull : payloadSchema;
    }
    if (samplePayload !== undefined) {
      data.samplePayload = samplePayload === null ? Prisma.JsonNull : samplePayload;
    }
    return client.integrationWebhookEvent.update({
      where: { id },
      data: data as Prisma.IntegrationWebhookEventUpdateInput,
    });
  }

  async remove(id: string, tenantSlug: string) {
    const client = this.getClient(tenantSlug);
    await this.findOne(id, tenantSlug);

    const activeWebhooks = await client.integrationWebhook.count({
      where: { eventId: id, isActive: true },
    });
    if (activeWebhooks > 0) {
      throw new BadRequestException(
        `Cannot delete webhook event: ${activeWebhooks} active webhook(s) still reference this event`,
      );
    }

    await client.integrationWebhookEvent.delete({ where: { id } });
  }

  async bulkDelete(ids: string[], tenantSlug: string) {
    const client = this.getClient(tenantSlug);

    const activeWebhooks = await client.integrationWebhook.count({
      where: { eventId: { in: ids }, isActive: true },
    });
    if (activeWebhooks > 0) {
      throw new BadRequestException(
        `Cannot delete: ${activeWebhooks} active webhook(s) still reference these events`,
      );
    }

    await client.integrationWebhookEvent.deleteMany({ where: { id: { in: ids } } });
  }

  async checkCodeAvailable(code: string, excludeId: string | undefined, tenantSlug: string): Promise<boolean> {
    const client = this.getClient(tenantSlug);
    const where: Record<string, unknown> = { code };
    if (excludeId) where.id = { not: excludeId };
    const count = await client.integrationWebhookEvent.count({ where });
    return count === 0;
  }
}
