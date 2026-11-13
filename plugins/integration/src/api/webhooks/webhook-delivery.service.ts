import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService, safeHttpRequest } from '@saas/backend';
import { Prisma } from '@saas/database';
import * as crypto from 'crypto';
import type { DeliveryQueryDto } from './dto/delivery-query.dto';
import { allowPrivateWebhookUrls, isUnsafeOutboundUrlError } from './webhook-url-policy';

interface WebhookForDelivery {
  id: string;
  url: string;
  secret: string;
  headers: Record<string, string> | null;
  retryPolicy: { maxAttempts: number; backoffMs: number; backoffMultiplier: number } | null;
}

@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  constructor(private prisma: PrismaService) {}

  private getClient(tenantSlug: string) {
    return this.prisma.getTenantClient(tenantSlug);
  }

  async deliverWebhook(
    webhook: WebhookForDelivery,
    eventCode: string,
    payload: Record<string, unknown>,
    tenantSlug: string,
  ) {
    const client = this.getClient(tenantSlug);

    const retryPolicy = webhook.retryPolicy ?? { maxAttempts: 3, backoffMs: 1000, backoffMultiplier: 2 };

    const delivery = await client.integrationWebhookDelivery.create({
      data: {
        webhookId: webhook.id,
        eventCode,
        payload: payload as Prisma.InputJsonValue,
        status: 'PENDING',
        attempt: 1,
        maxAttempts: retryPolicy.maxAttempts,
      },
    });

    return this.executeDelivery(delivery.id, webhook, eventCode, payload, 1, retryPolicy, tenantSlug);
  }

  private async executeDelivery(
    deliveryId: string,
    webhook: WebhookForDelivery,
    eventCode: string,
    payload: Record<string, unknown>,
    attempt: number,
    retryPolicy: { maxAttempts: number; backoffMs: number; backoffMultiplier: number },
    tenantSlug: string,
  ) {
    const client = this.getClient(tenantSlug);
    const timestamp = new Date().toISOString();
    const payloadStr = JSON.stringify(payload);

    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(`${timestamp}.${payloadStr}`)
      .digest('hex');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': `sha256=${signature}`,
      'X-Webhook-Event': eventCode,
      'X-Webhook-Delivery-Id': deliveryId,
      'X-Webhook-Timestamp': timestamp,
      ...(webhook.headers ?? {}),
    };

    const startTime = Date.now();

    try {
      // SSRF-safe: re-validates the URL on every attempt (DNS may have changed
      // since it was configured), pins the connection to the vetted addresses
      // and never follows redirects.
      const response = await safeHttpRequest(webhook.url, {
        method: 'POST',
        headers,
        body: payloadStr,
        timeoutMs: 10000,
        allowPrivate: allowPrivateWebhookUrls(),
      });

      const duration = Date.now() - startTime;
      const responseBody = response.body;

      if (response.ok) {
        return client.integrationWebhookDelivery.update({
          where: { id: deliveryId },
          data: {
            status: 'SUCCESS',
            httpStatus: response.status,
            responseBody: responseBody.substring(0, 10000),
            duration,
            attempt,
            completedAt: new Date(),
          },
        });
      }

      const redirectNote = response.status >= 300 && response.status < 400 ? ' (redirects are not followed)' : '';
      return this.handleFailure(
        deliveryId, webhook, eventCode, payload, attempt, retryPolicy, tenantSlug,
        response.status, responseBody.substring(0, 10000), duration,
        `HTTP ${response.status}: ${response.statusText}${redirectNote}`,
      );
    } catch (err) {
      const duration = Date.now() - startTime;
      const error = err instanceof Error ? err.message : 'Unknown error';

      if (isUnsafeOutboundUrlError(err)) {
        // Policy violation — retrying cannot succeed, so fail permanently.
        return client.integrationWebhookDelivery.update({
          where: { id: deliveryId },
          data: {
            status: 'FAILED',
            httpStatus: null,
            responseBody: null,
            duration,
            attempt,
            error: `Blocked by SSRF protection: ${error}`,
            completedAt: new Date(),
          },
        });
      }

      return this.handleFailure(
        deliveryId, webhook, eventCode, payload, attempt, retryPolicy, tenantSlug,
        null, null, duration, error,
      );
    }
  }

  private async handleFailure(
    deliveryId: string,
    webhook: WebhookForDelivery,
    eventCode: string,
    payload: Record<string, unknown>,
    attempt: number,
    retryPolicy: { maxAttempts: number; backoffMs: number; backoffMultiplier: number },
    tenantSlug: string,
    httpStatus: number | null,
    responseBody: string | null,
    duration: number,
    error: string,
  ) {
    const client = this.getClient(tenantSlug);

    if (attempt < retryPolicy.maxAttempts) {
      const backoffDelay = retryPolicy.backoffMs * Math.pow(retryPolicy.backoffMultiplier, attempt - 1);
      const nextRetryAt = new Date(Date.now() + backoffDelay);

      const delivery = await client.integrationWebhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'RETRYING',
          httpStatus,
          responseBody,
          duration,
          attempt,
          error,
          nextRetryAt,
        },
      });

      setTimeout(() => {
        this.executeDelivery(
          deliveryId, webhook, eventCode, payload,
          attempt + 1, retryPolicy, tenantSlug,
        ).catch((e) => this.logger.error(`Retry failed for delivery ${deliveryId}`, e));
      }, backoffDelay);

      return delivery;
    }

    return client.integrationWebhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'FAILED',
        httpStatus,
        responseBody,
        duration,
        attempt,
        error,
        completedAt: new Date(),
      },
    });
  }

  async findDeliveries(webhookId: string, tenantSlug: string, params: DeliveryQueryDto) {
    const client = this.getClient(tenantSlug);
    const { page = 1, limit = 10, status, sortBy = 'createdAt', sortOrder = 'desc' } = params;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { webhookId };
    if (status) {
      where.status = status;
    }

    const [data, total] = await Promise.all([
      client.integrationWebhookDelivery.findMany({
        where,
        skip: Number(skip),
        take: Number(limit),
        orderBy: { [sortBy]: sortOrder },
      }),
      client.integrationWebhookDelivery.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async retryDelivery(webhookId: string, deliveryId: string, tenantSlug: string) {
    const client = this.getClient(tenantSlug);

    const delivery = await client.integrationWebhookDelivery.findFirst({
      where: { id: deliveryId, webhookId },
      include: { webhook: true },
    });

    if (!delivery) {
      throw new NotFoundException(`Delivery ${deliveryId} not found for webhook ${webhookId}`);
    }

    const webhook: WebhookForDelivery = {
      id: delivery.webhook.id,
      url: delivery.webhook.url,
      secret: delivery.webhook.secret,
      headers: delivery.webhook.headers as Record<string, string> | null,
      retryPolicy: delivery.webhook.retryPolicy as WebhookForDelivery['retryPolicy'],
    };

    const retryPolicy = webhook.retryPolicy ?? { maxAttempts: 3, backoffMs: 1000, backoffMultiplier: 2 };

    await client.integrationWebhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'RETRYING', attempt: delivery.attempt + 1 },
    });

    return this.executeDelivery(
      deliveryId, webhook, delivery.eventCode,
      delivery.payload as Record<string, unknown>,
      delivery.attempt + 1, retryPolicy, tenantSlug,
    );
  }

  async processRetries(tenantSlug: string) {
    const client = this.getClient(tenantSlug);

    const pendingRetries = await client.integrationWebhookDelivery.findMany({
      where: {
        status: 'RETRYING',
        nextRetryAt: { lte: new Date() },
      },
      include: { webhook: true },
    });

    for (const delivery of pendingRetries) {
      const webhook: WebhookForDelivery = {
        id: delivery.webhook.id,
        url: delivery.webhook.url,
        secret: delivery.webhook.secret,
        headers: delivery.webhook.headers as Record<string, string> | null,
        retryPolicy: delivery.webhook.retryPolicy as WebhookForDelivery['retryPolicy'],
      };

      const retryPolicy = webhook.retryPolicy ?? { maxAttempts: 3, backoffMs: 1000, backoffMultiplier: 2 };

      this.executeDelivery(
        delivery.id, webhook, delivery.eventCode,
        delivery.payload as Record<string, unknown>,
        delivery.attempt + 1, retryPolicy, tenantSlug,
      ).catch((e) => this.logger.error(`Retry processing failed for delivery ${delivery.id}`, e));
    }

    return { processed: pendingRetries.length };
  }
}
