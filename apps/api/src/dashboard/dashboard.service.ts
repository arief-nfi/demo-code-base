import { Injectable } from '@nestjs/common';
import { PrismaService } from '@saas/backend';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardData(userId: string, tenantSlug: string) {
    // Get tenant client for tenant-specific queries
    const tenantClient = await this.prisma.getTenantClient(tenantSlug);

    // Fetch user profile
    const userProfile = await tenantClient.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        avatar: true,
        status: true,
        roles: {
          select: {
            name: true,
          },
        },
      },
    });

    // Fetch tenant info from public schema
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
      },
    });

    // Fetch tenant config from tenant schema
    const tenantConfig = await tenantClient.tenantConfig.findFirst({
      select: {
        description: true,
        domain: true,
        theme: true,
        language: true,
        currency: true,
        timezone: true,
        dateFormat: true,
        timeFormat: true,
        numberFormat: true,
        currencyFormat: true,
      },
    });

    // Fetch users statistics
    const totalUsers = await tenantClient.user.count();
    const activeUsers = await tenantClient.user.count({
      where: { status: 'ACTIVE' },
    });
    const inactiveUsers = await tenantClient.user.count({
      where: { status: 'INACTIVE' },
    });

    // Fetch roles and permissions counts
    const rolesCount = await tenantClient.role.count();
    const permissionsCount = await tenantClient.permission.count();

    // Fetch activated plugins
    // 1. Get all globally enabled plugins from Public Schema
    const systemPlugins = await this.prisma.plugin.findMany({
      where: { isEnabled: true },
    });

    // 2. Get tenant's plugin configuration from Tenant Schema
    const tenantPlugins = await tenantClient.plugin.findMany({
      where: { isEnabled: true },
    });
    const tenantPluginKeys = new Set(tenantPlugins.map((p) => p.key));

    // 3. Only include system plugins that are also enabled in tenant
    const activePlugins = systemPlugins
      .filter((sp) => tenantPluginKeys.has(sp.key))
      .map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        key: plugin.key,
        description: plugin.description,
      }));

    return {
      userProfile,
      tenantInfo: {
        ...tenant,
        config: tenantConfig,
      },
      usersStats: {
        total: totalUsers,
        active: activeUsers,
        inactive: inactiveUsers,
      },
      rolesCount,
      permissionsCount,
      plugins: activePlugins,
    };
  }
}
