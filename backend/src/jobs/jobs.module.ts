import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { TranslationJobProcessor } from './translation.job';
import { LibraryModule } from '../library/library.module';
import { RulesModule } from '../rules/rules.module';
import { SettingsModule } from '../settings/settings.module';
import { ExtractionModule } from '../extraction/extraction.module';
import { TranslationModule } from '../translation/translation.module';
import { OutputModule } from '../output/output.module';
import { JobsEventsService } from './jobs-events.service';
import { JobLogsService } from './job-logs.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'translation',
    }),
    LibraryModule,
    RulesModule,
    SettingsModule,
    ExtractionModule,
    TranslationModule,
    OutputModule,
  ],
  providers: [
    JobsService,
    TranslationJobProcessor,
    JobsEventsService,
    JobLogsService,
  ],
  controllers: [JobsController],
  exports: [JobsService],
})
export class JobsModule {}
