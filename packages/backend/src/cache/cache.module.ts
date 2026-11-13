import { DynamicModule, Global, Module, Provider, Type, InjectionToken } from '@nestjs/common';
import { CacheService, CacheOptions, CACHE_OPTIONS } from './cache.service';

export interface CacheModuleAsyncOptions {
  imports?: Type<unknown>[];
  useFactory: (...args: any[]) => CacheOptions | Promise<CacheOptions>;
  inject?: InjectionToken[];
}

@Global()
@Module({})
export class CacheModule {
  /**
   * Register with static config.
   * Usage: CacheModule.forRoot({ redisUrl: 'redis://localhost:6379' })
   * Or:    CacheModule.forRoot() for in-memory only
   */
  static forRoot(options?: CacheOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: CACHE_OPTIONS,
      useValue: options ?? {},
    };

    return {
      module: CacheModule,
      providers: [optionsProvider, CacheService],
      exports: [CacheService],
    };
  }

  /**
   * Register with async config (e.g. inject ConfigService).
   * Usage:
   * CacheModule.forRootAsync({
   *   imports: [ConfigModule],
   *   useFactory: (config: ConfigService) => ({
   *     redisUrl: config.get('REDIS_URL'),
   *   }),
   *   inject: [ConfigService],
   * })
   */
  static forRootAsync(asyncOptions: CacheModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: CACHE_OPTIONS,
      useFactory: asyncOptions.useFactory,
      inject: asyncOptions.inject ?? [],
    };

    return {
      module: CacheModule,
      imports: asyncOptions.imports ?? [],
      providers: [optionsProvider, CacheService],
      exports: [CacheService],
    };
  }
}
