import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_INTERCEPTOR, APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { join } from 'path';
import { PrismaModule, TenancyMiddleware, AuditModule, WorkflowModule, ImportModule, RequestContextInterceptor, GlobalExceptionFilter, SanitizePipe, LoggerModule, RequestLoggerMiddleware, CacheModule, EventsModule, PluginMetricsModule, PluginMetricsInterceptor, StorageModule, QueueModule, WebSocketModule } from '@saas/backend';
import { ScheduleModule } from '@nestjs/schedule';
import { UploadModule } from './uploads/uploads.module';
import { ImportUploadModule } from './imports/import-upload.module';
import { NotificationModule } from './notifications/notification.module';
import { JobsModule } from './jobs/jobs.module';
import { PluginModules } from './plugin-registry';
import { PluginsModule } from './plugins/plugins.module';
import { BillingModule } from './billing/billing.module';
import { AppsModule } from './apps/apps.module';
import { EmailModule } from './email/email.module';
import { CalendarModule } from './calendar/calendar.module';
import { MeetingsModule } from './meetings/meetings.module';
import { TenantsModule } from './tenants/tenants.module';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';
import { PermissionsModule } from './systems/permissions/permissions.module';
import { RolesModule } from './systems/roles/roles.module';
import { UsersModule } from './systems/users/users.module';
import { validateEnv } from './config/env.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: '../../.env',
      isGlobal: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        throttlers: [{
          ttl: configService.get<number>('THROTTLE_TTL_SECONDS', 60) * 1000,
          limit: configService.get<number>('THROTTLE_LIMIT', 100),
        }],
      }),
      inject: [ConfigService],
    }),
    ServeStaticModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => [{
        rootPath: join(process.cwd(), configService.get<string>('UPLOAD_DIR', 'uploads')),
        serveRoot: '/uploads',
      }],
      inject: [ConfigService],
    }),
    LoggerModule,
    CacheModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        redisUrl: config.get<string>('REDIS_URL'),
      }),
      inject: [ConfigService],
    }),
    EventsModule,
    StorageModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        provider: config.get<'local' | 's3'>('STORAGE_PROVIDER', 'local'),
        uploadDir: config.get<string>('UPLOAD_DIR', 'uploads'),
        serveRoot: '/uploads',
        s3Bucket: config.get<string>('S3_BUCKET'),
        s3Region: config.get<string>('AWS_REGION'),
        s3Endpoint: config.get<string>('S3_ENDPOINT'),
        s3AccessKeyId: config.get<string>('S3_ACCESS_KEY_ID'),
        s3SecretAccessKey: config.get<string>('S3_SECRET_ACCESS_KEY'),
        s3ForcePathStyle: config.get<boolean>('S3_FORCE_PATH_STYLE', false),
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    QueueModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        redisUrl: config.get<string>('REDIS_URL'),
      }),
      inject: [ConfigService],
    }),
    PrismaModule,
    EmailModule,
    CalendarModule,
    MeetingsModule,
    PluginMetricsModule,
    AuditModule,
    WorkflowModule,
    ImportModule,
    ImportUploadModule,
    AuthModule,
    DashboardModule,
    HealthModule,
    ...PluginModules,
    PluginsModule,
    BillingModule,
    AppsModule,
    WebSocketModule,
    UploadModule,
    NotificationModule,
    JobsModule,
    TenantsModule,
    PermissionsModule,
    RolesModule,
    UsersModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_PIPE,
      useClass: SanitizePipe,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestContextInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: PluginMetricsInterceptor,
    },
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestLoggerMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
    consumer
      .apply(TenancyMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
