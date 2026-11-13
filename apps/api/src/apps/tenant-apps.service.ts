import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, appKeyOf, appRef, grantingAppRefs, isPluginGranted, isSubscriptionLive } from '@saas/backend';
import type { TenantSubscription } from '@saas/database';
import { CatalogService, type Product } from '../billing/catalog.service';
import { CreditService } from '../billing/credit.service';
import { InvoiceService } from '../billing/invoice.service';
import { replacementFor, type ReplacementAction } from '../billing/replacement';
import { AppsCatalogService } from './apps-catalog.service';

export interface StoreApp {
  key: string;
  name: string;
  description: string | null;
  icon: string;
  pricing: { pricingModel: string; price: string | null; currency: string; trialDays: number; pricingLabel: string | null };
  /** Saving against buying the included paid plugins one by one, when comparable. */
  savingPercent: number | null;
  /** `owned`: the tenant may use it already (its own subscription or a live app). */
  plugins: Array<{ key: string; name: string; owned: boolean }>;
  subscription: {
    status: string;
    /** `OWNED` for a paid one-time purchase, otherwise `status`. */
    displayStatus: string;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
    openInvoiceId: string | null;
  } | null;
  /** The app has a trial and this tenant hasn't used it. */
  canStartTrial: boolean;
}

export interface AppPreview {
  app: StoreApp;
  /** What paying for the app does to each included plugin the tenant already has (see replacementFor). */
  plugins: Array<{ key: string; name: string; action: ReplacementAction | 'none'; creditEstimate: string | null; currentPeriodEnd: Date | null }>;
  /** Included plugins another live app of the tenant already grants. */
  overlaps: Array<{ pluginKey: string; pluginName: string; appName: string }>;
  /** The tenant's credit in the app's currency. */
  creditBalance: string;
}

export interface MenuApp {
  key: string;
  name: string;
  icon: string;
  /** Granted plugins in the app's order. */
  plugins: string[];
}

/** Apps as a tenant sees them: the store, what buying one would do, and the sidebar's app sections. */
@Injectable()
export class TenantAppsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly credits: CreditService,
    private readonly invoices: InvoiceService,
    private readonly appsCatalog: AppsCatalogService,
  ) {}

  /** Published apps, plus hidden ones the tenant still holds, by name. */
  async store(tenantSlug: string, tenantId: string): Promise<StoreApp[]> {
    const subs = await this.prisma.getTenantClient(tenantSlug).tenantSubscription.findMany();
    const apps = await this.prisma.app.findMany({ orderBy: { name: 'asc' } });
    const out: StoreApp[] = [];
    for (const app of apps) {
      const sub = subs.find((s) => s.pluginKey === appRef(app.key));
      if (!app.isPublished && !(sub && sub.status !== 'ENDED')) continue;
      const product = await this.catalog.getProduct(appRef(app.key));
      if (product) out.push(await this.storeApp(product, app.description, app.pricingLabel, sub, subs, tenantId));
    }
    return out;
  }

  async preview(tenantSlug: string, tenantId: string, appKey: string, now: Date = new Date()): Promise<AppPreview> {
    const app = (await this.store(tenantSlug, tenantId)).find((a) => a.key === appKey);
    const product = app ? await this.catalog.getProduct(appRef(appKey)) : null;
    if (!app || !product) throw new NotFoundException(`App "${appKey}" not found.`);

    const subs = await this.prisma.getTenantClient(tenantSlug).tenantSubscription.findMany();
    const plugins: AppPreview['plugins'] = [];
    for (const plugin of product.plugins) {
      const own = subs.find((s) => s.pluginKey === plugin.key);
      const action = own ? (replacementFor(own, product.currency) ?? 'none') : 'none';
      plugins.push({
        key: plugin.key,
        name: plugin.name,
        action,
        // Same calculation the payment uses (CreditService.unusedTime)
        creditEstimate: own && action === 'end-with-credit' ? await this.credits.unusedTime(tenantId, plugin.key, own.currency, now, own.startDate) : null,
        currentPeriodEnd: own?.currentPeriodEnd ?? null,
      });
    }

    const otherApps = new Map<string, string>();
    for (const ref of new Set(product.plugins.flatMap((p) => grantingAppRefs(p.key, subs, now)))) {
      if (ref !== product.ref) otherApps.set(ref, (await this.catalog.getProduct(ref))?.name ?? appKeyOf(ref)!);
    }
    const overlaps = product.plugins.flatMap((p) =>
      grantingAppRefs(p.key, subs, now)
        .filter((ref) => ref !== product.ref)
        .map((ref) => ({ pluginKey: p.key, pluginName: p.name, appName: otherApps.get(ref)! })),
    );

    return { app, plugins, overlaps, creditBalance: await this.credits.balance(tenantId, product.currency) };
  }

  /** The tenant's live apps for the sidebar, by name. */
  async menu(tenantSlug: string): Promise<MenuApp[]> {
    const subs = await this.prisma.getTenantClient(tenantSlug).tenantSubscription.findMany();
    const out: MenuApp[] = [];
    for (const sub of subs.filter((s) => appKeyOf(s.pluginKey) !== null && isSubscriptionLive(s))) {
      const product = await this.catalog.getProduct(sub.pluginKey);
      if (!product) continue;
      const order = product.plugins.map((p) => p.key);
      const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);
      const plugins = [...(sub.grantedPlugins ?? [])].sort((a, b) => rank(a) - rank(b));
      out.push({ key: product.key, name: product.name, icon: product.icon ?? 'package', plugins });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async storeApp(
    product: Product,
    description: string | null,
    pricingLabel: string | null,
    sub: TenantSubscription | undefined,
    subs: TenantSubscription[],
    tenantId: string,
  ): Promise<StoreApp> {
    const { savingPercent } = await this.appsCatalog.quote({
      plugins: product.plugins.map((p) => p.key),
      pricingModel: product.pricingModel,
      price: product.price != null ? Number(product.price) : null,
      pricingCurrency: product.currency as 'USD' | 'IDR',
    });
    const open = sub ? await this.invoices.findOpenForSubscription(tenantId, product.ref) : null;
    return {
      key: product.key,
      name: product.name,
      description,
      icon: product.icon ?? 'package',
      pricing: { pricingModel: product.pricingModel, price: product.price, currency: product.currency, trialDays: product.trialDays, pricingLabel },
      savingPercent,
      plugins: product.plugins.map((p) => ({ key: p.key, name: p.name, owned: isPluginGranted(p.key, subs) })),
      subscription: sub
        ? {
            status: sub.status,
            displayStatus: sub.status === 'ACTIVE' && sub.pricingModel === 'ONE_TIME' && !sub.currentPeriodEnd ? 'OWNED' : sub.status,
            trialEndsAt: sub.trialEndsAt,
            currentPeriodEnd: sub.currentPeriodEnd,
            openInvoiceId: open?.id ?? null,
          }
        : null,
      canStartTrial: product.trialDays > 0 && !sub?.trialEndsAt,
    };
  }
}
