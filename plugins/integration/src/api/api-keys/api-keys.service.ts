import { Injectable, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '@saas/backend';
import { Prisma } from '@saas/database';
import * as crypto from 'crypto';
import type { ApiKeyQueryDto } from './dto/api-key-query.dto';
import type { CreateApiKeyDto } from './dto/create-api-key.dto';
import type { UpdateApiKeyDto } from './dto/update-api-key.dto';

const KEY_PREFIX = 'intk_';

@Injectable()
export class ApiKeysService {
  constructor(private prisma: PrismaService) {}

  private getClient(tenantSlug: string) {
    return this.prisma.getTenantClient(tenantSlug);
  }

  private generateRawKey(): string {
    return KEY_PREFIX + crypto.randomBytes(32).toString('hex');
  }

  private extractPrefix(rawKey: string): string {
    return rawKey.substring(5, 9);
  }

  private hashKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
  }

  private sanitize(apiKey: Record<string, unknown>) {
    const { keyHash: _keyHash, ...rest } = apiKey;
    return rest;
  }

  async findAll(tenantSlug: string, params: ApiKeyQueryDto) {
    const client = this.getClient(tenantSlug);
    const { page = 1, limit = 10, search, partnerId, isActive, sortBy = 'createdAt', sortOrder = 'desc' } = params;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (search) {
      where.name = { contains: search, mode: 'insensitive' as const };
    }

    if (partnerId) {
      where.partnerId = partnerId;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [data, total] = await Promise.all([
      client.integrationApiKey.findMany({
        where,
        skip: Number(skip),
        take: Number(limit),
        orderBy: { [sortBy]: sortOrder },
        include: {
          partner: { select: { id: true, code: true, name: true } },
        },
      }),
      client.integrationApiKey.count({ where }),
    ]);

    return {
      data: data.map((key) => this.sanitize(key as unknown as Record<string, unknown>)),
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
    const apiKey = await client.integrationApiKey.findUnique({
      where: { id },
      include: {
        partner: { select: { id: true, code: true, name: true } },
      },
    });
    if (!apiKey) {
      throw new NotFoundException(`API key with ID ${id} not found`);
    }
    return this.sanitize(apiKey as unknown as Record<string, unknown>);
  }

  async create(dto: CreateApiKeyDto, tenantSlug: string) {
    const client = this.getClient(tenantSlug);

    const partner = await client.integrationPartner.findUnique({ where: { id: dto.partnerId } });
    if (!partner) {
      throw new BadRequestException(`Partner with ID ${dto.partnerId} not found`);
    }

    const rawKey = this.generateRawKey();
    const keyPrefix = this.extractPrefix(rawKey);
    const keyHash = this.hashKey(rawKey);

    const apiKey = await client.integrationApiKey.create({
      data: {
        partnerId: dto.partnerId,
        name: dto.name,
        keyPrefix,
        keyHash,
        scopes: dto.scopes as Prisma.InputJsonValue,
        expiresAt: dto.expiresAt ?? undefined,
      },
      include: {
        partner: { select: { id: true, code: true, name: true } },
      },
    });

    return {
      apiKey: this.sanitize(apiKey as unknown as Record<string, unknown>),
      rawKey,
    };
  }

  async update(id: string, dto: UpdateApiKeyDto, tenantSlug: string) {
    const client = this.getClient(tenantSlug);

    const existing = await client.integrationApiKey.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`API key with ID ${id} not found`);
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.scopes !== undefined) data.scopes = dto.scopes;
    if (dto.expiresAt !== undefined) data.expiresAt = dto.expiresAt;

    const apiKey = await client.integrationApiKey.update({
      where: { id },
      data: data as Prisma.IntegrationApiKeyUpdateInput,
      include: {
        partner: { select: { id: true, code: true, name: true } },
      },
    });

    return this.sanitize(apiKey as unknown as Record<string, unknown>);
  }

  async remove(id: string, tenantSlug: string) {
    const client = this.getClient(tenantSlug);
    const existing = await client.integrationApiKey.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`API key with ID ${id} not found`);
    }
    await client.integrationApiKey.delete({ where: { id } });
  }

  async bulkDelete(ids: string[], tenantSlug: string) {
    const client = this.getClient(tenantSlug);
    await client.integrationApiKey.deleteMany({ where: { id: { in: ids } } });
  }

  async revoke(id: string, tenantSlug: string) {
    const client = this.getClient(tenantSlug);
    const existing = await client.integrationApiKey.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`API key with ID ${id} not found`);
    }
    if (!existing.isActive) {
      throw new BadRequestException('API key is already revoked');
    }

    const apiKey = await client.integrationApiKey.update({
      where: { id },
      data: { isActive: false, revokedAt: new Date() },
      include: {
        partner: { select: { id: true, code: true, name: true } },
      },
    });

    return this.sanitize(apiKey as unknown as Record<string, unknown>);
  }

  async regenerate(id: string, tenantSlug: string) {
    const client = this.getClient(tenantSlug);
    const existing = await client.integrationApiKey.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`API key with ID ${id} not found`);
    }

    // Revoke the old key
    await client.integrationApiKey.update({
      where: { id },
      data: { isActive: false, revokedAt: new Date() },
    });

    // Create a new key with the same config
    const rawKey = this.generateRawKey();
    const keyPrefix = this.extractPrefix(rawKey);
    const keyHash = this.hashKey(rawKey);

    const apiKey = await client.integrationApiKey.create({
      data: {
        partnerId: existing.partnerId,
        name: existing.name,
        keyPrefix,
        keyHash,
        scopes: existing.scopes as Prisma.InputJsonValue,
        expiresAt: existing.expiresAt,
      },
      include: {
        partner: { select: { id: true, code: true, name: true } },
      },
    });

    return {
      apiKey: this.sanitize(apiKey as unknown as Record<string, unknown>),
      rawKey,
    };
  }

  async validateApiKey(rawKey: string, tenantSlug: string) {
    if (!rawKey.startsWith(KEY_PREFIX)) {
      throw new UnauthorizedException('Invalid API key format');
    }

    const client = this.getClient(tenantSlug);
    const keyPrefix = this.extractPrefix(rawKey);

    const candidates = await client.integrationApiKey.findMany({
      where: { keyPrefix },
      include: {
        partner: { select: { id: true, code: true, name: true, status: true } },
      },
    });

    const keyHash = this.hashKey(rawKey);
    const matched = candidates.find((k) => k.keyHash === keyHash);

    if (!matched) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (!matched.isActive) {
      throw new UnauthorizedException('API key has been revoked');
    }

    if (matched.revokedAt) {
      throw new UnauthorizedException('API key has been revoked');
    }

    if (matched.expiresAt && matched.expiresAt < new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    if (matched.partner.status !== 'ACTIVE') {
      throw new UnauthorizedException('Partner is not active');
    }

    // Update lastUsedAt (fire-and-forget)
    client.integrationApiKey
      .update({ where: { id: matched.id }, data: { lastUsedAt: new Date() } })
      .catch(() => { /* non-critical */ });

    return {
      partnerId: matched.partner.id,
      partnerCode: matched.partner.code,
      partnerName: matched.partner.name,
      scopes: matched.scopes as string[],
    };
  }
}
