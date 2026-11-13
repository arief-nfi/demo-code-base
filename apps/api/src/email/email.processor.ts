import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService, QUEUE_NAMES } from '@saas/backend';
import { EMAIL_TRANSPORT, type EmailEnvelope, type EmailTransportRef } from './smtp-transport';

export interface EmailJob {
  messageId: string;
  /** The tenant whose schema holds the EmailMessage row; null = public (platform emails) */
  tenantSlug: string | null;
  envelope: EmailEnvelope;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Delivers queued emails and records the outcome on their EmailMessage row. */
@Processor(QUEUE_NAMES.EMAIL)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransportRef,
  ) {
    super();
  }

  async process(job: Job<EmailJob>): Promise<void> {
    const { messageId, tenantSlug, envelope } = job.data;
    const messages = (tenantSlug ? this.prisma.getTenantClient(tenantSlug) : this.prisma).emailMessage;

    const transport = this.transport.current;
    if (!transport) {
      await messages.update({ where: { id: messageId }, data: { status: 'SKIPPED', lastError: 'SMTP not configured' } });
      return;
    }

    let providerMessageId: string | undefined;
    try {
      ({ messageId: providerMessageId } = await transport.send(envelope));
    } catch (error) {
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await messages
        .update({
          where: { id: messageId },
          data: { attempts: { increment: 1 }, lastError: errorText(error), ...(isLastAttempt ? { status: 'FAILED' as const } : {}) },
        })
        .catch((dbError: unknown) => this.logger.error(`Email ${messageId}: could not record the failure: ${errorText(dbError)}`));
      throw error; // BullMQ retries per RETRY_POLICIES.email
    }

    try {
      await messages.update({
        where: { id: messageId },
        data: { status: 'SENT', attempts: { increment: 1 }, sentAt: new Date(), providerMessageId: providerMessageId ?? null, lastError: null },
      });
    } catch (error) {
      // Already delivered: rethrowing would make BullMQ send it again
      this.logger.error(`Email ${messageId} was sent but could not be marked SENT: ${errorText(error)}`);
    }
  }

  /**
   * Some jobs fail without process() seeing it (stalled too many times, e.g. a worker
   * crash mid-send): once BullMQ gives a job up for good, its email is FAILED too.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<EmailJob> | undefined, error: Error): Promise<void> {
    if (!job || !(await job.isFailed())) return; // it will be retried
    const { messageId, tenantSlug } = job.data;
    await (tenantSlug ? this.prisma.getTenantClient(tenantSlug) : this.prisma).emailMessage
      .updateMany({ where: { id: messageId, status: 'QUEUED' }, data: { status: 'FAILED', lastError: error.message } })
      .catch((dbError: unknown) => this.logger.error(`Email ${messageId}: could not record the failure: ${errorText(dbError)}`));
  }
}
