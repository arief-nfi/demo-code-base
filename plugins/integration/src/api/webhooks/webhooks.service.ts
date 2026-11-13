import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@saas/backend';
import { Prisma } from '@saas/database';
import * as crypto from 'crypto';
import type { WebhookQueryDto } from './dto/webhook-query.dto';
import type { CreateWebhookDto } from './dto/create-webhook.dto';
import type { UpdateWebhookDto } from './dto/update-webhook.dto';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { assertWebhookUrlAllowed } from './webhook-url-policy';

@Injectable()
export class WebhooksService {
  constructor(
    private prisma: PrismaService,
    private deliveryService: WebhookDeliveryService,
  ) {}

  private getClient(tenantSlug: string) {
    return this.prisma.getTenantClient(tenantSlug);
  }

  private generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async findAll(tenantSlug: string, params: WebhookQueryDto) {
    const client = this.getClient(tenantSlug);
    const { page = 1, limit = 10, search, partnerId, eventId, isActive, sortBy = 'createdAt', sortOrder = 'desc' } = params;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (search) {
      where.url = { contains: search, mode: 'insensitive' as const };
    }

    if (partnerId) {
      where.partnerId = partnerId;
    }

    if (eventId) {
      where.eventId = eventId;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [data, total] = await Promise.all([
      client.integrationWebhook.findMany({
        where,
        skip: Number(skip),
        take: Number(limit),
        orderBy: { [sortBy]: sortOrder },
        include: {
          partner: { select: { id: true, code: true, name: true } },
          event: { select: { id: true, code: true, name: true } },
        },
      }),
      client.integrationWebhook.count({ where }),
    ]);

    const sanitized = data.map(({ secret: _secret, ...rest }) => rest);

    return {
      data: sanitized,
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
    const webhook = await client.integrationWebhook.findUnique({
      where: { id },
      include: {
        partner: { select: { id: true, code: true, name: true } },
        event: { select: { id: true, code: true, name: true } },
      },
    });
    if (!webhook) {
      throw new NotFoundException(`Webhook with ID ${id} not found`);
    }
    const { secret: _secret, ...rest } = webhook;
    return rest;
  }

  async create(dto: CreateWebhookDto, tenantSlug: string) {
    const client = this.getClient(tenantSlug);

    await assertWebhookUrlAllowed(dto.url);

    const partner = await client.integrationPartner.findUnique({ where: { id: dto.partnerId } });
    if (!partner) {
      throw new BadRequestException(`Partner with ID ${dto.partnerId} not found`);
    }

    const event = await client.integrationWebhookEvent.findUnique({ where: { id: dto.eventId } });
    if (!event) {
      throw new BadRequestException(`Webhook event with ID ${dto.eventId} not found`);
    }

    const existing = await client.integrationWebhook.findFirst({
      where: { partnerId: dto.partnerId, eventId: dto.eventId, url: dto.url },
    });
    if (existing) {
      throw new ConflictException('A webhook with this partner, event, and URL combination already exists');
    }

    const secret = this.generateSecret();

    const webhook = await client.integrationWebhook.create({
      data: {
        partnerId: dto.partnerId,
        eventId: dto.eventId,
        url: dto.url,
        description: dto.description,
        secret,
        headers: (dto.headers as Prisma.InputJsonValue) ?? undefined,
        retryPolicy: (dto.retryPolicy as unknown as Prisma.InputJsonValue) ?? undefined,
      },
      include: {
        partner: { select: { id: true, code: true, name: true } },
        event: { select: { id: true, code: true, name: true } },
      },
    });

    const { secret: _secret, ...rest } = webhook;
    return { webhook: rest, secret };
  }

  async update(id: string, dto: UpdateWebhookDto, tenantSlug: string) {
    const client = this.getClient(tenantSlug);

    const existing = await client.integrationWebhook.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Webhook with ID ${id} not found`);
    }

    if (dto.url !== undefined) {
      await assertWebhookUrlAllowed(dto.url);
    }

    const { headers, retryPolicy, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest };
    if (headers !== undefined) {
      data.headers = headers === null ? Prisma.JsonNull : headers;
    }
    if (retryPolicy !== undefined) {
      data.retryPolicy = retryPolicy === null ? Prisma.JsonNull : retryPolicy;
    }

    const webhook = await client.integrationWebhook.update({
      where: { id },
      data: data as Prisma.IntegrationWebhookUpdateInput,
      include: {
        partner: { select: { id: true, code: true, name: true } },
        event: { select: { id: true, code: true, name: true } },
      },
    });

    const { secret: _secret, ...sanitized } = webhook;
    return sanitized;
  }

  async remove(id: string, tenantSlug: string) {
    const client = this.getClient(tenantSlug);
    const webhook = await client.integrationWebhook.findUnique({ where: { id } });
    if (!webhook) {
      throw new NotFoundException(`Webhook with ID ${id} not found`);
    }
    await client.integrationWebhook.delete({ where: { id } });
  }

  async bulkDelete(ids: string[], tenantSlug: string) {
    const client = this.getClient(tenantSlug);
    await client.integrationWebhook.deleteMany({ where: { id: { in: ids } } });
  }

  async rotateSecret(id: string, tenantSlug: string) {
    const client = this.getClient(tenantSlug);

    const existing = await client.integrationWebhook.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Webhook with ID ${id} not found`);
    }

    const secret = this.generateSecret();

    const webhook = await client.integrationWebhook.update({
      where: { id },
      data: { secret },
      include: {
        partner: { select: { id: true, code: true, name: true } },
        event: { select: { id: true, code: true, name: true } },
      },
    });

    const { secret: _secret, ...rest } = webhook;
    return { webhook: rest, secret };
  }

  async testWebhook(id: string, tenantSlug: string) {
    const client = this.getClient(tenantSlug);

    const webhook = await client.integrationWebhook.findUnique({
      where: { id },
      include: { event: true },
    });
    if (!webhook) {
      throw new NotFoundException(`Webhook with ID ${id} not found`);
    }

    const payload = (webhook.event.samplePayload as Record<string, unknown>) ?? {
      test: true,
      message: 'This is a test delivery',
      timestamp: new Date().toISOString(),
    };

    return this.deliveryService.deliverWebhook(
      {
        id: webhook.id,
        url: webhook.url,
        secret: webhook.secret,
        headers: webhook.headers as Record<string, string> | null,
        retryPolicy: webhook.retryPolicy as { maxAttempts: number; backoffMs: number; backoffMultiplier: number } | null,
      },
      webhook.event.code,
      payload,
      tenantSlug,
    );
  }
}
