import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '@saas/backend';
import { Prisma } from '@saas/database';
import type { PartnerQueryDto } from './dto/partner-query.dto';
import type { CreatePartnerDto } from './dto/create-partner.dto';
import type { UpdatePartnerDto } from './dto/update-partner.dto';

@Injectable()
export class PartnersService {
  constructor(private prisma: PrismaService) {}

  private getClient(tenantSlug: string) {
    return this.prisma.getTenantClient(tenantSlug);
  }

  async findAll(tenantSlug: string, params: PartnerQueryDto) {
    const client = this.getClient(tenantSlug);
    const { page = 1, limit = 10, search, status, sortBy = 'createdAt', sortOrder = 'desc' } = params;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' as const } },
        { code: { contains: search, mode: 'insensitive' as const } },
        { contactEmail: { contains: search, mode: 'insensitive' as const } },
      ];
    }

    if (status) {
      where.status = status;
    }

    const [data, total] = await Promise.all([
      client.integrationPartner.findMany({
        where,
        skip: Number(skip),
        take: Number(limit),
        orderBy: { [sortBy]: sortOrder },
      }),
      client.integrationPartner.count({ where }),
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
    const partner = await client.integrationPartner.findUnique({ where: { id } });
    if (!partner) {
      throw new NotFoundException(`Partner with ID ${id} not found`);
    }
    return partner;
  }

  async create(dto: CreatePartnerDto, tenantSlug: string) {
    const client = this.getClient(tenantSlug);
    const available = await this.checkCodeAvailable(dto.code, undefined, tenantSlug);
    if (!available) {
      throw new ConflictException(`Partner with code '${dto.code}' already exists`);
    }

    return client.integrationPartner.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        contactName: dto.contactName,
        contactEmail: dto.contactEmail,
        metadata: (dto.metadata as Prisma.InputJsonValue) ?? undefined,
      },
    });
  }

  async update(id: string, dto: UpdatePartnerDto, tenantSlug: string) {
    const client = this.getClient(tenantSlug);

    await this.findOne(id, tenantSlug);

    if (dto.code) {
      const available = await this.checkCodeAvailable(dto.code, id, tenantSlug);
      if (!available) {
        throw new ConflictException(`Partner with code '${dto.code}' already exists`);
      }
    }

    const { metadata, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest };
    if (metadata !== undefined) {
      data.metadata = metadata === null ? Prisma.JsonNull : metadata;
    }
    return client.integrationPartner.update({
      where: { id },
      data: data as Prisma.IntegrationPartnerUpdateInput,
    });
  }

  async remove(id: string, tenantSlug: string) {
    const client = this.getClient(tenantSlug);
    await this.findOne(id, tenantSlug);
    await client.integrationPartner.delete({ where: { id } });
  }

  async bulkDelete(ids: string[], tenantSlug: string) {
    const client = this.getClient(tenantSlug);
    await client.integrationPartner.deleteMany({ where: { id: { in: ids } } });
  }

  async updateStatus(id: string, status: string, tenantSlug: string) {
    const client = this.getClient(tenantSlug);
    await this.findOne(id, tenantSlug);
    return client.integrationPartner.update({
      where: { id },
      data: { status: status as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' },
    });
  }

  async checkCodeAvailable(code: string, excludeId: string | undefined, tenantSlug: string): Promise<boolean> {
    const client = this.getClient(tenantSlug);
    const where: Record<string, unknown> = { code };
    if (excludeId) where.id = { not: excludeId };
    const count = await client.integrationPartner.count({ where });
    return count === 0;
  }
}
