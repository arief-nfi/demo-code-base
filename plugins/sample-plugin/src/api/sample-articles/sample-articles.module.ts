// plugins/sample-plugin/src/api/sample-articles/sample-articles.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '@saas/backend';
import { SampleArticlesController } from './sample-articles.controller';
import { SampleArticlesService } from './sample-articles.service';
import { SampleArticlesCalendarListener } from './sample-articles.calendar-listener';
import { SampleArticleMeetingsController } from './sample-article-meetings.controller';
import { SampleArticleMeetingsService } from './sample-article-meetings.service';

@Module({
  imports: [PrismaModule],
  controllers: [SampleArticlesController, SampleArticleMeetingsController],
  providers: [SampleArticlesService, SampleArticleMeetingsService, SampleArticlesCalendarListener],
  exports: [SampleArticlesService],
})
export class SampleArticlesModule {}
