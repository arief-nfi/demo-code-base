import { Module } from '@nestjs/common';
import { TemplatesModule } from './templates/templates.module';
import { RenderingModule } from './rendering/rendering.module';
import { DefaultsModule } from './defaults/defaults.module';
import { EmailTemplatesModule } from './emails/email-templates.module';

@Module({
  imports: [TemplatesModule, RenderingModule, DefaultsModule, EmailTemplatesModule],
})
export class DocumentTemplatesModule {}
