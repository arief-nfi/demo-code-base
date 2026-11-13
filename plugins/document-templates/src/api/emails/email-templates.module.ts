import { Module } from '@nestjs/common';
import { EMAIL_TEMPLATE_OVERRIDES, PrismaModule } from '@saas/backend';
import { EmailTemplatesController } from './email-templates.controller';
import { EmailTemplatesService } from './email-templates.service';
import { PlatformEmailTemplatesController } from './platform-email-templates.controller';

@Module({
  imports: [PrismaModule],
  controllers: [EmailTemplatesController, PlatformEmailTemplatesController],
  providers: [
    EmailTemplatesService,
    // Core's EmailService looks this up to use tenant edits
    { provide: EMAIL_TEMPLATE_OVERRIDES, useExisting: EmailTemplatesService },
  ],
  exports: [EMAIL_TEMPLATE_OVERRIDES],
})
export class EmailTemplatesModule {}
