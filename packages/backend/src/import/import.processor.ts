import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ImportService } from './import.service';
import { QUEUE_NAMES } from '../queue/queue.constants';
import type { ImportJobData } from './import.types';

@Processor(QUEUE_NAMES.IMPORT)
export class ImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly importService: ImportService,
  ) {
    super();
  }

  async process(job: Job<ImportJobData>): Promise<void> {
    const { tenantSlug, importKey, jobId, rows, userId } = job.data;

    this.logger.log(`Processing import job ${jobId}: ${rows.length} rows for "${importKey}"`);

    const client = this.prisma.getTenantClient(tenantSlug);
    const handler = this.importService.getHandler(importKey);

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ row: number; error: string }> = [];
    const batchSize = 100;

    try {
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);

        for (let j = 0; j < batch.length; j++) {
          const rowNum = i + j + 1;
          try {
            const result = await handler.handleRow(tenantSlug, batch[j], {
              userId,
              jobId,
              rowNumber: rowNum,
            });
            if (result.success) {
              imported++;
            } else {
              failed++;
              errors.push({ row: rowNum, error: result.error || 'Unknown error' });
            }
          } catch (err: any) {
            failed++;
            errors.push({ row: rowNum, error: err.message || 'Unexpected error' });
          }
        }

        // Update progress
        const progress = Math.round(((i + batch.length) / rows.length) * 100);
        await job.updateProgress(progress);

        await client.importJob.update({
          where: { id: jobId },
          data: { importedRows: imported, skippedRows: skipped, failedRows: failed },
        });
      }

      // Finalize
      await client.importJob.update({
        where: { id: jobId },
        data: {
          status: failed > 0 && imported === 0 ? 'FAILED' : 'COMPLETED',
          importedRows: imported,
          skippedRows: skipped,
          failedRows: failed,
          errorLog: errors.length > 0 ? errors : undefined,
          completedAt: new Date(),
        },
      });

      // Post-import hook
      if (handler.afterImport) {
        await handler.afterImport(tenantSlug, { imported, skipped, failed });
      }

      this.logger.log(
        `Import job ${jobId} completed: ${imported} imported, ${skipped} skipped, ${failed} failed`,
      );
    } catch (err: any) {
      this.logger.error(`Import job ${jobId} failed: ${err.message}`, err.stack);

      await client.importJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          errorLog: [{ row: 0, error: `Job failed: ${err.message}` }],
          completedAt: new Date(),
        },
      });
    }
  }
}
