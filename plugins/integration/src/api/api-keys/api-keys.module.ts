import { Module } from '@nestjs/common';
import { PrismaModule, API_KEYS_SERVICE_TOKEN } from '@saas/backend';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';

@Module({
  imports: [PrismaModule],
  controllers: [ApiKeysController],
  providers: [
    ApiKeysService,
    {
      provide: API_KEYS_SERVICE_TOKEN,
      useExisting: ApiKeysService,
    },
  ],
  exports: [ApiKeysService, API_KEYS_SERVICE_TOKEN],
})
export class ApiKeysModule {}
