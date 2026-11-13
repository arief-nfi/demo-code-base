import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard, RbacGuard, Roles, QUEUE_NAMES } from '@saas/backend';

/** Email jobs carry the rendered message, which can hold a live password-reset link. */
function withoutEmailBody(data: any) {
  if (!data?.envelope) return data;
  const { html: _html, text: _text, ...envelope } = data.envelope;
  return { ...data, envelope };
}

@ApiTags('Jobs')
@ApiBearerAuth()
@Controller('jobs')
@UseGuards(JwtAuthGuard, RbacGuard)
@Roles('SYSADMIN')
export class JobsController {
  constructor(
    @InjectQueue(QUEUE_NAMES.EMAIL) private emailQueue: Queue,
    @InjectQueue(QUEUE_NAMES.WEBHOOK) private webhookQueue: Queue,
    @InjectQueue(QUEUE_NAMES.EXPORT) private exportQueue: Queue,
    @InjectQueue(QUEUE_NAMES.CALENDAR) private calendarQueue: Queue,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get queue statistics' })
  async getStats() {
    const [emailCounts, webhookCounts, exportCounts, calendarCounts] = await Promise.all([
      this.emailQueue.getJobCounts(),
      this.webhookQueue.getJobCounts(),
      this.exportQueue.getJobCounts(),
      this.calendarQueue.getJobCounts(),
    ]);

    return {
      email: emailCounts,
      webhook: webhookCounts,
      export: exportCounts,
      calendar: calendarCounts,
    };
  }

  @Get(':queue/jobs')
  @ApiOperation({ summary: 'List jobs in a queue' })
  async getJobs(
    @Param('queue') queueName: string,
    @Query('status') status: string = 'completed',
    @Query('start') start: string = '0',
    @Query('end') end: string = '20',
  ) {
    const queue = this.getQueue(queueName);
    if (!queue) return { error: `Queue '${queueName}' not found` };

    const validStatuses = ['completed', 'failed', 'delayed', 'active', 'waiting'] as const;
    const jobStatus = validStatuses.includes(status as any) ? status as any : 'completed';

    const jobs = await queue.getJobs([jobStatus], parseInt(start), parseInt(end));
    return jobs.map((job) => ({
      id: job.id,
      name: job.name,
      data: queueName === 'email' ? withoutEmailBody(job.data) : job.data,
      status: jobStatus,
      attemptsMade: job.attemptsMade,
      progress: job.progress,
      timestamp: job.timestamp,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason,
    }));
  }

  private getQueue(name: string): Queue | null {
    switch (name) {
      case 'email': return this.emailQueue;
      case 'webhook': return this.webhookQueue;
      case 'export': return this.exportQueue;
      case 'calendar': return this.calendarQueue;
      default: return null;
    }
  }
}
