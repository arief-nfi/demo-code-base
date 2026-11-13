import { Injectable } from '@nestjs/common';
import { PrismaService, appKeyOf, appRef } from '@saas/backend';

type PricingModel = 'FREE' | 'MONTHLY' | 'YEARLY' | 'ONE_TIME';

/** Something a tenant can subscribe to: a plugin, or an app (a bundle of plugins). */
export interface Product {
  /** Product key: the plugin key, or `app:<appKey>`. */
  ref: string;
  kind: 'plugin' | 'app';
  key: string;
  name: string;
  pricingModel: PricingModel;
  price: string | null;
  currency: string;
  trialDays: number;
  /** Plugin: switched on globally. App: published. */
  available: boolean;
  /** Apps only: the lucide icon name. */
  icon?: string;
  /** App contents in position order; empty for a plugin. */
  plugins: Array<{ key: string; name: string; pricingModel: string; price: string | null; currency: string }>;
}

const priceOf = (price: { toString(): string } | null | undefined): string | null => (price != null ? price.toString() : null);

/** Prices and contents of plugins and apps (public schema), by product key. */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async getProduct(productKey: string): Promise<Product | null> {
    const appKey = appKeyOf(productKey);
    if (appKey === null) {
      const plugin = await this.prisma.plugin.findUnique({ where: { key: productKey } });
      if (!plugin) return null;
      return {
        ref: plugin.key,
        kind: 'plugin',
        key: plugin.key,
        name: plugin.name,
        pricingModel: plugin.pricingModel as PricingModel,
        price: priceOf(plugin.price),
        currency: plugin.pricingCurrency,
        trialDays: plugin.trialDays ?? 0,
        available: plugin.isEnabled,
        plugins: [],
      };
    }

    const app = await this.prisma.app.findUnique({ where: { key: appKey } });
    if (!app) return null;
    // No `include`: the in-memory billing DB the specs use doesn't support it
    const members = await this.prisma.appPlugin.findMany({ where: { appId: app.id }, orderBy: { position: 'asc' } });
    const rows = members.length ? await this.prisma.plugin.findMany({ where: { key: { in: members.map((m) => m.pluginKey) } } }) : [];
    const byKey = new Map(rows.map((p) => [p.key, p]));
    return {
      ref: appRef(app.key),
      kind: 'app',
      key: app.key,
      name: app.name,
      pricingModel: app.pricingModel as PricingModel,
      price: priceOf(app.price),
      currency: app.pricingCurrency,
      trialDays: app.trialDays ?? 0,
      available: app.isPublished,
      icon: app.icon,
      plugins: members.flatMap((m) => {
        const p = byKey.get(m.pluginKey);
        return p ? [{ key: p.key, name: p.name, pricingModel: p.pricingModel, price: priceOf(p.price), currency: p.pricingCurrency }] : [];
      }),
    };
  }

  /** Pricing model of every product: plugin keys and `app:<key>` refs. */
  async pricingModels(): Promise<Map<string, string>> {
    const [plugins, apps] = await Promise.all([
      this.prisma.plugin.findMany({ select: { key: true, pricingModel: true } }),
      this.prisma.app.findMany({ select: { key: true, pricingModel: true } }),
    ]);
    return new Map<string, string>([
      ...plugins.map((p): [string, string] => [p.key, p.pricingModel]),
      ...apps.map((a): [string, string] => [appRef(a.key), a.pricingModel]),
    ]);
  }
}
