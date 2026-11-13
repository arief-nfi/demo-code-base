import { isSubscriptionLive } from './subscription-status';

/**
 * Subscriptions and invoices are keyed by a product key: a plugin key, or
 * `app:<appKey>` for an app (a bundle of plugins sold at its own price).
 */
export const APP_REF_PREFIX = 'app:';

/** The product key of an app. */
export function appRef(appKey: string): string {
  return `${APP_REF_PREFIX}${appKey}`;
}

/** The app key of an app's product key, or null for a plugin key. */
export function appKeyOf(productKey: string): string | null {
  return productKey.startsWith(APP_REF_PREFIX) ? productKey.slice(APP_REF_PREFIX.length) : null;
}

/** What a tenant subscription contributes to "may this tenant use this plugin". */
export interface GrantSource {
  pluginKey: string;
  status: string;
  trialEndsAt: Date | null;
  /** App subscriptions only: the plugins it grants. */
  grantedPlugins?: string[] | null;
}

/** Product keys of the live app subscriptions that grant this plugin, sorted. */
export function grantingAppRefs(pluginKey: string, subs: GrantSource[], now: Date = new Date()): string[] {
  return subs
    .filter((s) => appKeyOf(s.pluginKey) !== null && (s.grantedPlugins ?? []).includes(pluginKey) && isSubscriptionLive(s, now))
    .map((s) => s.pluginKey)
    .sort();
}

/**
 * A paid plugin may be used when the tenant's own subscription to it is live, or a
 * live app subscription grants it. The one rule behind the guard, the paywall and billing.
 */
export function isPluginGranted(pluginKey: string, subs: GrantSource[], now: Date = new Date()): boolean {
  const own = subs.find((s) => s.pluginKey === pluginKey);
  return isSubscriptionLive(own, now) || grantingAppRefs(pluginKey, subs, now).length > 0;
}
