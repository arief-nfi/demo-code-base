/**
 * Whether a paid plugin's subscription currently allows the plugin to be on.
 * Shared by the paywall (enabling a paid plugin), PluginEnabledGuard (using it)
 * and billing, so the three can't disagree.
 *
 * Live: ACTIVE (including "cancel at period end"), PAST_DUE (grace period) and a
 * TRIAL whose end is still in the future. Everything else — pending payment,
 * paused, ended, the legacy statuses, or no subscription at all — is not.
 */
export function isSubscriptionLive(
  sub: { status: string; trialEndsAt: Date | null } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!sub) return false;
  if (sub.status === 'ACTIVE' || sub.status === 'PAST_DUE') return true;
  return sub.status === 'TRIAL' && sub.trialEndsAt != null && new Date(sub.trialEndsAt) > now;
}
