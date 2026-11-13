import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import * as crypto from 'crypto';
import { QUEUE_NAMES, safeHttpRequest, type UnsafeOutboundUrlError } from '@saas/backend';
import type { WebhookJobData } from './webhook.producer';

/**
 * SSRF-policy rejections are matched by their stable code rather than
 * `instanceof`, since @saas/backend may be loaded twice (src vs dist).
 */
function isUnsafeOutboundUrlError(err: unknown): boolean {
  return (err as Partial<UnsafeOutboundUrlError> | null)?.code === 'ERR_UNSAFE_OUTBOUND_URL';
}

@Processor(QUEUE_NAMES.WEBHOOK)
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  async process(job: Job<WebhookJobData>): Promise<{ statusCode: number; duration: number }> {
    const { webhookUrl, webhookSecret, eventType, payload, tenantSlug, deliveryId } = job.data;

    this.logger.log(`Processing webhook job ${job.id}: url=${webhookUrl}, event=${eventType}, tenant=${tenantSlug}`);

    const payloadStr = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Webhook-Event': eventType,
      'X-Webhook-Delivery': deliveryId || job.id || '',
      'X-Webhook-Attempt': String(job.attemptsMade + 1),
    };

    // HMAC signature if secret is configured
    if (webhookSecret) {
      const signature = crypto.createHmac('sha256', webhookSecret).update(payloadStr).digest('hex');
      headers['X-Webhook-Signature'] = `sha256=${signature}`;
    }

    const start = Date.now();
    try {
      // SSRF-safe: blocks private/reserved targets (re-checked at connect time),
      // never follows redirects. ALLOW_PRIVATE_WEBHOOK_URLS=true is for local dev only.
      const response = await safeHttpRequest(webhookUrl, {
        method: 'POST',
        headers,
        body: payloadStr,
        timeoutMs: 10000,
        allowPrivate: process.env.ALLOW_PRIVATE_WEBHOOK_URLS === 'true',
      });

      const duration = Date.now() - start;

      if (!response.ok) {
        this.logger.warn(`Webhook job ${job.id} got HTTP ${response.status} (${duration}ms)`);
        const redirectNote = response.status >= 300 && response.status < 400 ? ' (redirects are not followed)' : '';
        throw new Error(`HTTP ${response.status}: ${response.statusText}${redirectNote}`);
      }

      this.logger.log(`Webhook job ${job.id} delivered successfully (${duration}ms, HTTP ${response.status})`);
      return { statusCode: response.status, duration };
    } catch (error) {
      const duration = Date.now() - start;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Webhook job ${job.id} failed (${duration}ms): ${message}`);
      if (isUnsafeOutboundUrlError(error)) {
        // Policy violation — retrying cannot succeed.
        throw new UnrecoverableError(`Blocked by SSRF protection: ${message}`);
      }
      throw error; // BullMQ will retry
    }
  }
}
