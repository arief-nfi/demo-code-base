import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, PluginLockService, PrismaService, SystemEvents, appRef, isSubscriptionLive } from '@saas/backend';
import type { AppEventPayload } from '@saas/backend';
import type { Prisma } from '@saas/database';
import { AppPluginsService } from '../billing/app-plugins.service';
import { CatalogService } from '../billing/catalog.service';
import { NotificationService } from '../notifications/notification.service';
import type { SwitchOnFailure } from './apps-catalog.service';

const RECURRING = ['MONTHLY', 'YEARLY'];
const dateText = (d: Date) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * A sysadmin changed what an app contains. Added plugins reach every live subscriber
 * at once; one that can't be switched on is recorded on the app for the sysadmin and
 * the tenant is told. Removed ones stay with each subscriber until their next paid invoice
 * refreshes what the subscription grants (SubscriptionsService.activateFromPayment);
 * recurring subscribers are told when that is. Owned and free subscriptions keep them.
 */
@Injectable()
export class AppContentsListener {
  private readonly logger = new Logger(AppContentsListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pluginLock: PluginLockService,
    private readonly catalog: CatalogService,
    private readonly appPlugins: AppPluginsService,
    private readonly notifications: NotificationService,
  ) {}

  @OnEvent(SystemEvents.APP_PLUGINS_ADDED)
  async onAdded(payload: AppEventPayload): Promise<void> {
    const ref = appRef(payload.appKey);
    try {
      const app = await this.catalog.getProduct(ref);
      if (!app) return;
      const names = await this.names(payload.pluginKeys);
      const attempted: string[] = [];
      const failed: Array<Omit<SwitchOnFailure, 'at'>> = [];
      for (const { slug } of await this.tenants()) {
        try {
          // null: the tenant doesn't hold the app live; otherwise the plugins that couldn't be switched on
          const failures = await this.pluginLock.withLock(`toggle:${slug}:${ref}`, async () => {
            const client = this.prisma.getTenantClient(slug);
            const sub = await client.tenantSubscription.findUnique({ where: { pluginKey: ref } });
            if (!sub || !isSubscriptionLive(sub)) return null;
            const grantedPlugins = [...new Set([...(sub.grantedPlugins ?? []), ...payload.pluginKeys])];
            await client.tenantSubscription.update({ where: { pluginKey: ref }, data: { grantedPlugins } });
            return this.appPlugins.switchOn(slug, payload.pluginKeys);
          });
          if (failures === null) continue;
          attempted.push(slug);
          for (const f of failures) {
            this.logger.warn(`"${f.pluginKey}" added to ${app.name} couldn't be switched on for ${slug}: ${f.error}`);
            failed.push({ tenantSlug: slug, pluginKey: f.pluginKey, error: f.error });
          }
          let body = `${app.name} now includes ${names.join(', ')}.`;
          if (failures.length) {
            const off = await this.names(failures.map((f) => f.pluginKey));
            body += ` ${off.join(', ')} couldn't be switched on: turn ${off.length > 1 ? 'them' : 'it'} on in Tenant Plugins.`;
          }
          await this.notify(slug, SystemEvents.APP_PLUGINS_ADDED, `${app.name} got bigger`, body);
        } catch (error) {
          this.logger.warn(`Adding ${payload.pluginKeys.join(', ')} to ${app.name} for ${slug} failed: ${message(error)}`);
        }
      }
      await this.recordFailures(payload.appKey, payload.pluginKeys, attempted, failed);
    } catch (error) {
      this.logger.warn(`Applying plugins added to app "${payload.appKey}" failed: ${message(error)}`);
    }
  }

  /**
   * Keep the sysadmin's list of plugins that couldn't be switched on (shown on the Apps page): this
   * attempt replaces what was recorded for the same tenants and plugins.
   */
  private async recordFailures(appKey: string, pluginKeys: string[], attempted: string[], failed: Array<Omit<SwitchOnFailure, 'at'>>): Promise<void> {
    const app = await this.prisma.app.findUnique({ where: { key: appKey } });
    if (!app) return;
    const previous = (app.switchOnFailures as SwitchOnFailure[] | null) ?? [];
    const at = new Date().toISOString();
    const next = [
      ...previous.filter((f) => !(attempted.includes(f.tenantSlug) && pluginKeys.includes(f.pluginKey))),
      ...failed.map((f) => ({ ...f, at })),
    ];
    if (JSON.stringify(next) === JSON.stringify(previous)) return;
    await this.prisma.app.update({ where: { key: appKey }, data: { switchOnFailures: next as unknown as Prisma.InputJsonValue } });
  }

  @OnEvent(SystemEvents.APP_PLUGINS_REMOVED)
  async onRemoved(payload: AppEventPayload): Promise<void> {
    const ref = appRef(payload.appKey);
    try {
      const app = await this.catalog.getProduct(ref);
      if (!app) return;
      const names = await this.names(payload.pluginKeys);
      const several = names.length > 1;
      for (const { slug } of await this.tenants()) {
        try {
          const sub = await this.prisma.getTenantClient(slug).tenantSubscription.findUnique({ where: { pluginKey: ref } });
          if (!sub || !isSubscriptionLive(sub) || !RECURRING.includes(sub.pricingModel)) continue;
          const renewsAt = sub.status === 'TRIAL' ? sub.trialEndsAt : sub.currentPeriodEnd;
          if (!renewsAt) continue;
          const keep = several ? 'Buy them on their own to keep using them.' : 'Buy it on its own to keep using it.';
          await this.notify(
            slug,
            SystemEvents.APP_PLUGINS_REMOVED,
            `Change to ${app.name}`,
            `${names.join(', ')} will leave ${app.name} at your next renewal on ${dateText(renewsAt)}. ${keep}`,
          );
        } catch (error) {
          this.logger.warn(`Telling ${slug} about plugins leaving ${app.name} failed: ${message(error)}`);
        }
      }
    } catch (error) {
      this.logger.warn(`Applying plugins removed from app "${payload.appKey}" failed: ${message(error)}`);
    }
  }

  private tenants() {
    return this.prisma.tenant.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL'] } }, select: { slug: true } });
  }

  /** Plugin names in the given order (the key when a plugin is unknown). */
  private async names(pluginKeys: string[]): Promise<string[]> {
    const rows = await this.prisma.plugin.findMany({ where: { key: { in: pluginKeys } }, select: { key: true, name: true } });
    return pluginKeys.map((key) => rows.find((p) => p.key === key)?.name ?? key);
  }

  private notify(tenantSlug: string, event: string, title: string, body: string) {
    return this.notifications.notifyAdmins(tenantSlug, { title, body, type: 'INFO', category: 'billing', link: '/billing', sourceEvent: event });
  }
}
