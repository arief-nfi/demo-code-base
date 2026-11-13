import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { TenantPublicController } from './tenant-public.controller';
import { UploadModule } from '../uploads/uploads.module';

@Module({
  imports: [UploadModule],
  controllers: [TenantPublicController, TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
