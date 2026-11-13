import { BadRequestException } from '@nestjs/common';
import { assertSafeOutboundUrl, type UnsafeOutboundUrlError } from '@saas/backend';

/**
 * Local-development escape hatch: `ALLOW_PRIVATE_WEBHOOK_URLS=true` lets
 * webhooks target localhost / private networks. Never enable in production —
 * webhook delivery responses are readable by tenant admins (SSRF).
 */
export function allowPrivateWebhookUrls(): boolean {
  return process.env.ALLOW_PRIVATE_WEBHOOK_URLS === 'true';
}

/**
 * True for SSRF-policy rejections from `@saas/backend`. Matched by the error's
 * stable `code` rather than `instanceof`, because the package can be loaded
 * twice (src in tests/dev, dist at runtime) and then the classes differ.
 */
export function isUnsafeOutboundUrlError(err: unknown): err is UnsafeOutboundUrlError {
  return (err as Partial<UnsafeOutboundUrlError> | null)?.code === 'ERR_UNSAFE_OUTBOUND_URL';
}

/**
 * Config-time check for webhook URLs: http(s) only, no credentials, and the
 * host must not be (or resolve to) a private/reserved address → 400.
 * DNS failures are not rejected here (the host may not exist yet); delivery
 * re-validates every attempt and records the failure.
 */
export async function assertWebhookUrlAllowed(url: string): Promise<void> {
  try {
    await assertSafeOutboundUrl(url, { allowPrivate: allowPrivateWebhookUrls() });
  } catch (err) {
    if (isUnsafeOutboundUrlError(err)) {
      throw new BadRequestException(`Webhook URL is not allowed: ${err.message}`);
    }
  }
}
