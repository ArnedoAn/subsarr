import { Module } from '@nestjs/common';
import { ExtractionModule } from '../extraction/extraction.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { LibraryModule } from '../library/library.module';
import { OutputModule } from '../output/output.module';
import { SubtitleSyncController } from './subtitle-sync.controller';
import { SubtitleSyncService } from './subtitle-sync.service';

@Module({
  imports: [LibraryModule, ExtractionModule, OutputModule, IntegrationsModule],
  controllers: [SubtitleSyncController],
  providers: [SubtitleSyncService],
})
export class SubtitleSyncModule {}
