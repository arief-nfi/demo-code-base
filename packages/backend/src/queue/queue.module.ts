import { DynamicModule, Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from './queue.constants';

interface QueueModuleOptions {
  redisUrl?: string;
}

interface QueueModuleAsyncOptions {
  imports?: any[];
  useFactory: (...args: any[]) => QueueModuleOptions | Promise<QueueModuleOptions>;
  inject?: any[];
}

function parseRedisUrl(url?: string) {
  if (!url) return { host: 'localhost', port: 6379 };
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
    };
  } catch {
    return { host: 'localhost', port: 6379 };
  }
}

@Global()
@Module({})
export class QueueModule {
  static forRootAsync(asyncOptions: QueueModuleAsyncOptions): DynamicModule {
    return {
      module: QueueModule,
      imports: [
        BullModule.forRootAsync({
          imports: asyncOptions.imports,
          useFactory: async (...args: any[]) => {
            const options = await asyncOptions.useFactory(...args);
            const connection = parseRedisUrl(options.redisUrl);
            return { connection };
          },
          inject: asyncOptions.inject,
        }),
        BullModule.registerQueue(
          { name: QUEUE_NAMES.EMAIL },
          { name: QUEUE_NAMES.WEBHOOK },
          { name: QUEUE_NAMES.EXPORT },
          { name: QUEUE_NAMES.IMPORT },
          { name: QUEUE_NAMES.CALENDAR },
        ),
      ],
      exports: [BullModule],
    };
  }
}
