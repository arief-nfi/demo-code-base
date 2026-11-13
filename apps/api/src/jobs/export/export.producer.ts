import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES, RETRY_POLICIES } from '@saas/backend';

export interface ExportJobData {
  tenantId: string;
  tenantSlug: string;
  requestedBy?: string;
}

@Injectable()
export class ExportProducer {
  constructor(@InjectQueue(QUEUE_NAMES.EXPORT) private exportQueue: Queue) {}

  async enqueue(data: ExportJobData) {
    return this.exportQueue.add(JOB_NAMES.EXPORT_TENANT_DATA, data, {
      attempts: RETRY_POLICIES.export.attempts,
      backoff: RETRY_POLICIES.export.backoff,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 100 },
    });
  }
}
