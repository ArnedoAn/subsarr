import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { JobSnapshotEntity } from '../database/entities/job-snapshot.entity';
import { JobLogRowEntity } from '../database/entities/job-log.entity';
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
import { JobArchiveService } from './job-archive.service';
import { SubsyncTempCleanupService } from './subsync-temp-cleanup.service';
import { LibraryScanSchedulerService } from './library-scan-scheduler.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { GlossaryModule } from '../glossary/glossary.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([JobSnapshotEntity, JobLogRowEntity]),
    BullModule.registerQueue({
      name: 'translation',
    }),
    LibraryModule,
    RulesModule,
    forwardRef(() => SettingsModule),
    forwardRef(() => NotificationsModule),
    ProfilesModule,
    GlossaryModule,
    IntegrationsModule,
    ExtractionModule,
    TranslationModule,
    OutputModule,
  ],
  providers: [
    JobsService,
    TranslationJobProcessor,
    JobsEventsService,
    JobLogsService,
    JobArchiveService,
    SubsyncTempCleanupService,
    LibraryScanSchedulerService,
  ],
  controllers: [JobsController],
  exports: [JobsService, LibraryScanSchedulerService],
})
export class JobsModule {}
