import { DynamicModule, Global, Module, Provider, Logger } from '@nestjs/common';
import type { StorageOptions } from './storage.interface';
import { STORAGE_PROVIDER } from './storage.interface';
import { LocalStorageProvider } from './local-storage.provider';
import { S3StorageProvider } from './s3-storage.provider';

interface StorageModuleAsyncOptions {
  imports?: any[];
  useFactory: (...args: any[]) => StorageOptions | Promise<StorageOptions>;
  inject?: any[];
}

function createProvider(options: StorageOptions): Provider {
  return {
    provide: STORAGE_PROVIDER,
    useFactory: () => {
      const logger = new Logger('StorageModule');
      if (options.provider === 's3') {
        logger.log('Using S3 storage provider');
        return new S3StorageProvider(options);
      }
      logger.log('Using local storage provider');
      return new LocalStorageProvider(options);
    },
  };
}

@Global()
@Module({})
export class StorageModule {
  static forRoot(options: StorageOptions): DynamicModule {
    const provider = createProvider(options);
    return {
      module: StorageModule,
      providers: [provider],
      exports: [STORAGE_PROVIDER],
    };
  }

  static forRootAsync(asyncOptions: StorageModuleAsyncOptions): DynamicModule {
    const provider: Provider = {
      provide: STORAGE_PROVIDER,
      useFactory: async (...args: any[]) => {
        const logger = new Logger('StorageModule');
        const options = await asyncOptions.useFactory(...args);
        if (options.provider === 's3') {
          logger.log('Using S3 storage provider');
          return new S3StorageProvider(options);
        }
        logger.log('Using local storage provider');
        return new LocalStorageProvider(options);
      },
      inject: asyncOptions.inject || [],
    };

    return {
      module: StorageModule,
      imports: asyncOptions.imports || [],
      providers: [provider],
      exports: [STORAGE_PROVIDER],
    };
  }
}
