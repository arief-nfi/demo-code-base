import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PluginEventService, PrismaService, SystemEvents, appRef, isSubscriptionLive } from '@saas/backend';
import type { AppEventPayload } from '@saas/backend';
import type { App } from '@saas/database';
import { manifestDeps } from '../billing/dependency-order';
import { savingPercent, signedSum } from '../billing/money';
import type { AppCreateDto, AppQuoteDto, AppUpdateDto } from './apps.schemas';

/** A plugin added to an app that couldn't be switched on for a subscriber (AppContentsListener records it). */
export interface SwitchOnFailure {
  tenantSlug: string;
  pluginKey: string;
  error: string;
  /** ISO time of the attempt. */
  at: string;
}

export interface AppView extends Omit<App, 'price' | 'switchOnFailures'> {
  price: string | null;
  /** Plugin keys in the app's order. */
  plugins: string[];
  /** Tenants with a live subscription to the app. */
  liveSubscribers: number;
  /** Recorded failures that still matter: the tenant holds the app live and the plugin is still off. */
  switchOnFailures: Array<SwitchOnFailure & { pluginName: string }>;
}

type SubscriptionStatus = { status: string; trialEndsAt: Date | null };

export interface AppQuote {
  missingDependencies: string[];
  /** What the included paid plugins cost one by one, when they share the app's currency and interval. */
  sumOfParts: string | null;
  savingPercent: number | null;
}

type Pricing = Pick<App, 'pricingModel' | 'pricingCurrency' | 'trialDays'> & { price: string | null };

const priceText = (price: { toString(): string } | number | null | undefined): string | null => (price != null ? price.toString() : null);

/** The app catalog (public schema): apps, the plugins they bundle, their pricing. Sysadmin only. */
@Injectable()
export class AppsCatalogService {
  private readonly logger = new Logger(AppsCatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: PluginEventService,
  ) {}

  async list(): Promise<AppView[]> {
    const apps = await this.prisma.app.findMany({ orderBy: { name: 'asc' } });
    const statuses = await this.subscriptionsByTenant();
    return Promise.all(apps.map((app) => this.view(app, statuses)));
  }

  async get(key: string): Promise<AppView> {
    return this.view(await this.find(key), await this.subscriptionsByTenant());
  }

  async create(dto: AppCreateDto): Promise<AppView> {
    if (await this.prisma.plugin.findUnique({ where: { key: dto.key } })) {
      throw new BadRequestException(`"${dto.key}" is already a plugin key.`);
    }
    if (await this.prisma.app.findUnique({ where: { key: dto.key } })) {
      throw new BadRequestException(`An app with key "${dto.key}" already exists.`);
    }
    await this.assertPlugins(dto.plugins);
    const pricing = this.pricing(dto);

    await this.prisma.$transaction(async (tx) => {
      const app = await tx.app.create({
        data: {
          key: dto.key,
          name: dto.name,
          description: dto.description ?? null,
          icon: dto.icon,
          isPublished: dto.isPublished,
          pricingLabel: dto.pricingLabel ?? null,
          ...pricing,
        },
      });
      for (const [position, pluginKey] of dto.plugins.entries()) {
        await tx.appPlugin.create({ data: { appId: app.id, pluginKey, position } });
      }
    });
    return this.get(dto.key);
  }

  async update(key: string, dto: AppUpdateDto): Promise<AppView> {
    const app = await this.find(key);
    const before: Pricing = { pricingModel: app.pricingModel, price: priceText(app.price), pricingCurrency: app.pricingCurrency, trialDays: app.trialDays };
    const pricing = this.pricing({
      pricingModel: dto.pricingModel ?? app.pricingModel,
      price: dto.price !== undefined ? dto.price : app.price != null ? Number(app.price) : null,
      pricingCurrency: dto.pricingCurrency ?? app.pricingCurrency,
      trialDays: dto.trialDays ?? app.trialDays,
    });

    const current = await this.pluginKeys(app.id);
    const next = dto.plugins ?? current;
    if (dto.plugins) await this.assertPlugins(dto.plugins);

    await this.prisma.$transaction(async (tx) => {
      await tx.app.update({
        where: { key },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
          ...(dto.isPublished !== undefined ? { isPublished: dto.isPublished } : {}),
          ...(dto.pricingLabel !== undefined ? { pricingLabel: dto.pricingLabel } : {}),
          ...pricing,
        },
      });
      if (dto.plugins) {
        await tx.appPlugin.deleteMany({ where: { appId: app.id } });
        for (const [position, pluginKey] of dto.plugins.entries()) {
          await tx.appPlugin.create({ data: { appId: app.id, pluginKey, position } });
        }
      }
    });

    const after: Pricing = { ...pricing, price: priceText(pricing.price) };
    if (JSON.stringify(before) !== JSON.stringify(after)) this.emit(SystemEvents.APP_PRICING_UPDATED, key, []);
    const added = next.filter((k) => !current.includes(k));
    const removed = current.filter((k) => !next.includes(k));
    if (added.length) this.emit(SystemEvents.APP_PLUGINS_ADDED, key, added);
    if (removed.length) this.emit(SystemEvents.APP_PLUGINS_REMOVED, key, removed);
    return this.get(key);
  }

  /** Delete an app nobody holds any more (ENDED subscriptions only); hide it otherwise. */
  async remove(key: string): Promise<void> {
    const app = await this.find(key);
    const statuses = await this.subscriptionsByTenant();
    if ([...statuses.values()].some((subs) => subs.get(appRef(key)) && subs.get(appRef(key))!.status !== 'ENDED')) {
      throw new BadRequestException('Tenants still have this app. Hide it instead.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.appPlugin.deleteMany({ where: { appId: app.id } });
      await tx.app.delete({ where: { key } });
    });
  }

  async quote(input: AppQuoteDto): Promise<AppQuote> {
    const missingDependencies = [...new Set(input.plugins.flatMap((key) => manifestDeps(key)))]
      .filter((dep) => !input.plugins.includes(dep))
      .sort();
    const plugins = input.plugins.length ? await this.prisma.plugin.findMany({ where: { key: { in: input.plugins } } }) : [];
    const paid = plugins.filter((p) => p.pricingModel !== 'FREE' && p.price != null);
    const comparable =
      input.pricingModel !== 'FREE' &&
      paid.length > 0 &&
      paid.every((p) => p.pricingCurrency === input.pricingCurrency && p.pricingModel === input.pricingModel);
    if (!comparable) return { missingDependencies, sumOfParts: null, savingPercent: null };

    const sumOfParts = signedSum(paid.map((p) => p.price!.toString()), input.pricingCurrency);
    return {
      missingDependencies,
      sumOfParts,
      savingPercent: input.price != null ? savingPercent(sumOfParts, input.price, input.pricingCurrency) : null,
    };
  }

  /** Plugins to choose from, with their prices and what they need. */
  async pluginOptions(): Promise<Array<{ key: string; name: string; pricingModel: string; price: string | null; currency: string; dependencies: string[] }>> {
    const plugins = await this.prisma.plugin.findMany({ orderBy: { name: 'asc' } });
    return plugins.map((p) => ({
      key: p.key,
      name: p.name,
      pricingModel: p.pricingModel,
      price: priceText(p.price),
      currency: p.pricingCurrency,
      dependencies: manifestDeps(p.key),
    }));
  }

  private async find(key: string): Promise<App> {
    const app = await this.prisma.app.findUnique({ where: { key } });
    if (!app) throw new NotFoundException(`App "${key}" not found.`);
    return app;
  }

  private async pluginKeys(appId: string): Promise<string[]> {
    const rows = await this.prisma.appPlugin.findMany({ where: { appId }, orderBy: { position: 'asc' } });
    return rows.map((r) => r.pluginKey);
  }

  private async view(app: App, statuses: Map<string, Map<string, SubscriptionStatus>>): Promise<AppView> {
    const ref = appRef(app.key);
    const { switchOnFailures, ...rest } = app;
    return {
      ...rest,
      price: priceText(app.price),
      plugins: await this.pluginKeys(app.id),
      liveSubscribers: [...statuses.values()].filter((subs) => isSubscriptionLive(subs.get(ref))).length,
      switchOnFailures: await this.openFailures(ref, (switchOnFailures as SwitchOnFailure[] | null) ?? [], statuses),
    };
  }

  /** The recorded failures whose tenant still holds the app live and still has the plugin off. */
  private async openFailures(
    ref: string,
    failures: SwitchOnFailure[],
    statuses: Map<string, Map<string, SubscriptionStatus>>,
  ): Promise<AppView['switchOnFailures']> {
    const held = failures.filter((f) => isSubscriptionLive(statuses.get(f.tenantSlug)?.get(ref)));
    if (!held.length) return [];
    const names = new Map((await this.prisma.plugin.findMany({ select: { key: true, name: true } })).map((p) => [p.key, p.name]));
    const out: AppView['switchOnFailures'] = [];
    for (const slug of new Set(held.map((f) => f.tenantSlug))) {
      try {
        const enabled = await this.prisma.getTenantClient(slug).plugin.findMany({ where: { isEnabled: true } });
        for (const f of held.filter((f) => f.tenantSlug === slug && !enabled.some((p) => p.key === f.pluginKey))) {
          out.push({ ...f, pluginName: names.get(f.pluginKey) ?? f.pluginKey });
        }
      } catch (error) {
        this.logger.warn(`Reading the plugins of ${slug} failed: ${error instanceof Error ? error.message : error}`);
      }
    }
    return out;
  }

  /**
   * Each tenant's app subscriptions by product key, keyed by tenant slug: one query per tenant
   * (a tenant whose schema can't be read is skipped).
   */
  private async subscriptionsByTenant(): Promise<Map<string, Map<string, SubscriptionStatus>>> {
    const [tenants, apps] = await Promise.all([
      this.prisma.tenant.findMany({ select: { slug: true } }),
      this.prisma.app.findMany({ select: { key: true } }),
    ]);
    const out = new Map<string, Map<string, SubscriptionStatus>>();
    if (!apps.length) return out;
    const refs = apps.map((app) => appRef(app.key));
    for (const tenant of tenants) {
      try {
        const subs = await this.prisma.getTenantClient(tenant.slug).tenantSubscription.findMany({ where: { pluginKey: { in: refs } } });
        out.set(tenant.slug, new Map(subs.map((sub) => [sub.pluginKey, sub])));
      } catch (error) {
        this.logger.warn(`Reading app subscriptions of ${tenant.slug} failed: ${error instanceof Error ? error.message : error}`);
      }
    }
    return out;
  }

  /** Known plugins, and every plugin they need is included. */
  private async assertPlugins(keys: string[]): Promise<void> {
    const known = new Set((await this.prisma.plugin.findMany({ where: { key: { in: keys } } })).map((p) => p.key));
    const unknown = keys.find((key) => !known.has(key));
    if (unknown) throw new BadRequestException(`Unknown plugin "${unknown}".`);
    const missing = [...new Set(keys.flatMap((key) => manifestDeps(key)))].filter((dep) => !keys.includes(dep)).sort();
    if (missing.length) throw new BadRequestException(`Add the plugins these need: ${missing.join(', ')}.`);
  }

  /** A free app has no price and no trial; a paid one must have a price. */
  private pricing(dto: { pricingModel: App['pricingModel']; price?: number | null; pricingCurrency: string; trialDays: number }) {
    if (dto.pricingModel === 'FREE') {
      return { pricingModel: dto.pricingModel, price: null, pricingCurrency: dto.pricingCurrency, trialDays: 0 };
    }
    if (dto.price == null) throw new BadRequestException('Set a price for a paid app.');
    return { pricingModel: dto.pricingModel, price: dto.price, pricingCurrency: dto.pricingCurrency, trialDays: dto.trialDays };
  }

  private emit(event: string, appKey: string, pluginKeys: string[]): void {
    this.events.emit<AppEventPayload>(event, { tenantSlug: 'system', appKey, pluginKeys, timestamp: new Date() });
  }
}
