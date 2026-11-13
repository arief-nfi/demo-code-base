import { Global, Logger, Module } from '@nestjs/common';
import { EMAIL_SERVICE } from '@saas/backend';
import { PluginEmails } from '../plugin-registry';
import { CoreEmails } from './definitions/core.emails';
import { EmailDefinitionsRegistry } from './definitions-registry';
import { EMAIL_ENV, emailEnvFromProcess, type EmailEnv } from './email-env';
import { EmailProcessor } from './email.processor';
import { EmailAdminController, EmailPlatformController } from './email-admin.controller';
import { EmailLogService } from './email-log.service';
import { EmailRetentionJob } from './email-retention.job';
import { EMAIL_DEFINITIONS, EmailService } from './email.service';
import { createSmtpTransport, EMAIL_TRANSPORT, type EmailTransportRef } from './smtp-transport';

/** Global so any module or plugin can inject EMAIL_SERVICE without importing core. */
@Global()
@Module({
  controllers: [EmailAdminController, EmailPlatformController],
  providers: [
    { provide: EMAIL_ENV, useFactory: () => emailEnvFromProcess() },
    // Throws at boot when a core or plugin email definition is invalid
    { provide: EMAIL_DEFINITIONS, useFactory: () => new EmailDefinitionsRegistry(CoreEmails, PluginEmails) },
    {
      provide: EMAIL_TRANSPORT,
      inject: [EMAIL_ENV],
      useFactory: (env: EmailEnv): EmailTransportRef => {
        const current = createSmtpTransport(env);
        if (!current) new Logger('Email').warn('SMTP_HOST or MAIL_FROM is not set: emails are logged as SKIPPED, not sent');
        return { current };
      },
    },
    EmailService,
    { provide: EMAIL_SERVICE, useExisting: EmailService },
    EmailProcessor,
    EmailLogService,
    EmailRetentionJob,
  ],
  exports: [EMAIL_SERVICE, EmailService],
})
export class EmailModule {}
