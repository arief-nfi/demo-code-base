import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@saas/backend';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private prisma: PrismaService) {}

  private getClient(tenantSlug: string) {
    return this.prisma.getTenantClient(tenantSlug);
  }

  async create(tenantSlug: string, data: {
    userId: string;
    title: string;
    body: string;
    type?: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'ACTION';
    link?: string;
    category?: string;
    sourceEvent?: string;
    metadata?: Record<string, unknown>;
  }) {
    const client = this.getClient(tenantSlug);

    // Check user preference
    const pref = await client.notificationPreference.findUnique({
      where: { userId_category: { userId: data.userId, category: data.category || 'system' } },
    });
    if (pref && !pref.inApp) {
      return null; // User opted out of this category
    }

    return client.notification.create({
      data: {
        userId: data.userId,
        title: data.title,
        body: data.body,
        type: data.type || 'INFO',
        link: data.link,
        category: data.category || 'system',
        sourceEvent: data.sourceEvent,
        metadata: data.metadata as any,
      },
    });
  }

  async notifyAdmins(tenantSlug: string, data: {
    title: string;
    body: string;
    type?: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'ACTION';
    link?: string;
    category?: string;
    sourceEvent?: string;
  }) {
    const client = this.getClient(tenantSlug);
    const admins = await client.user.findMany({
      where: { roles: { some: { name: { in: ['ADMIN', 'SYSADMIN'] } } }, status: 'ACTIVE' },
      select: { id: true },
    });

    const results = [];
    for (const admin of admins) {
      const n = await this.create(tenantSlug, { ...data, userId: admin.id });
      if (n) results.push(n);
    }
    return results;
  }

  async findAll(tenantSlug: string, userId: string, params: { limit?: number; offset?: number; read?: string; category?: string }) {
    const client = this.getClient(tenantSlug);
    const { limit = 20, offset = 0, read, category } = params;

    const where: Record<string, unknown> = { userId };
    if (read === 'true') where.read = true;
    else if (read === 'false') where.read = false;
    if (category) where.category = category;

    const [data, total] = await Promise.all([
      client.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: Number(offset),
        take: Number(limit),
      }),
      client.notification.count({ where }),
    ]);

    return { data, meta: { total, limit: Number(limit), offset: Number(offset) } };
  }

  async getUnreadCount(tenantSlug: string, userId: string) {
    const client = this.getClient(tenantSlug);
    const count = await client.notification.count({
      where: { userId, read: false },
    });
    return { count };
  }

  async markAsRead(tenantSlug: string, notificationId: string) {
    const client = this.getClient(tenantSlug);
    return client.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });
  }

  async markAllAsRead(tenantSlug: string, userId: string) {
    const client = this.getClient(tenantSlug);
    const result = await client.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return { updated: result.count };
  }

  async deleteNotification(tenantSlug: string, notificationId: string) {
    const client = this.getClient(tenantSlug);
    await client.notification.delete({ where: { id: notificationId } });
  }

  async getPreferences(tenantSlug: string, userId: string) {
    const client = this.getClient(tenantSlug);
    const prefs = await client.notificationPreference.findMany({ where: { userId } });

    // Fill defaults for categories without preferences
    const categories = ['system', 'security', 'plugins'];
    const prefMap = new Map(prefs.map((p) => [p.category, p]));

    return categories.map((cat) => ({
      category: cat,
      inApp: prefMap.get(cat)?.inApp ?? true,
      email: prefMap.get(cat)?.email ?? false,
    }));
  }

  async updatePreferences(tenantSlug: string, userId: string, preferences: Array<{ category: string; inApp: boolean; email: boolean }>) {
    const client = this.getClient(tenantSlug);

    for (const pref of preferences) {
      await client.notificationPreference.upsert({
        where: { userId_category: { userId, category: pref.category } },
        update: { inApp: pref.inApp, email: pref.email },
        create: { userId, category: pref.category, inApp: pref.inApp, email: pref.email },
      });
    }

    return this.getPreferences(tenantSlug, userId);
  }
}
