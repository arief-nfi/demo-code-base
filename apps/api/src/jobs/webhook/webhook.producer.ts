import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES, RETRY_POLICIES } from '@saas/backend';

export interface WebhookJobData {
  tenantSlug: string;
  webhookId: string;
  webhookUrl: string;
  webhookSecret?: string;
  eventType: string;
  payload: Record<string, unknown>;
  deliveryId?: string;
}

@Injectable()
export class WebhookProducer {
  constructor(@InjectQueue(QUEUE_NAMES.WEBHOOK) private webhookQueue: Queue) {}

  async enqueue(data: WebhookJobData) {
    return this.webhookQueue.add(JOB_NAMES.DELIVER_WEBHOOK, data, {
      attempts: RETRY_POLICIES.webhook.attempts,
      backoff: RETRY_POLICIES.webhook.backoff,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 1000 },
    });
  }
}
