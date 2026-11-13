import { Injectable } from '@nestjs/common';
import { PrismaService } from '@saas/backend';
import type { IImportHandler } from '@saas/backend';

@Injectable()
export class SampleItemImportHandler implements IImportHandler {
  constructor(private readonly prisma: PrismaService) {}

  async handleRow(
    tenantSlug: string,
    data: Record<string, unknown>,
    context: { userId: string; jobId: string; rowNumber: number },
  ) {
    const client = this.prisma.getTenantClient(tenantSlug);

    const name = String(data.name ?? '').trim();
    if (!name) {
      return { success: false, error: 'Name is required' };
    }

    // Check for duplicate by name
    const existing = await client.sampleItem.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });

    if (existing) {
      return { success: false, error: `Item "${name}" already exists` };
    }

    await client.sampleItem.create({
      data: {
        name,
        value: data.value ? String(data.value) : null,
      },
    });

    return { success: true };
  }
}
