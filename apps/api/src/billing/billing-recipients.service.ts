import { Injectable } from '@nestjs/common';
import { PrismaService } from '@saas/backend';
import { BillingSettingsService } from './billing-settings.service';

/** Who gets a tenant's billing emails: its billing email, or else its active admins. */
@Injectable()
export class BillingRecipientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: BillingSettingsService,
  ) {}

  async emailsFor(tenantSlug: string): Promise<string[]> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (tenant) {
      const { billingEmail } = await this.settings.getProfile(tenant.id);
      if (billingEmail) return [billingEmail];
    }
    const admins = await this.prisma.getTenantClient(tenantSlug).user.findMany({
      where: { status: 'ACTIVE', roles: { some: { name: 'ADMIN' } } },
      select: { email: true },
    });
    return admins.map((a) => a.email).filter(Boolean);
  }
}
