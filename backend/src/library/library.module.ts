import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LibraryService } from './library.service';
import { LibraryController } from './library.controller';
import { SettingsModule } from '../settings/settings.module';
import { RulesModule } from '../rules/rules.module';
import { OutputModule } from '../output/output.module';
import { ExtractionModule } from '../extraction/extraction.module';
import { ProbeCacheEntity } from '../database/entities/probe-cache.entity';
import { MediaInventoryEntity } from '../database/entities/media-inventory.entity';
import { LibraryScanRunEntity } from './scan-run.entity';
import { ScanHistoryService } from './scan-history.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProbeCacheEntity,
      MediaInventoryEntity,
      LibraryScanRunEntity,
    ]),
    forwardRef(() => SettingsModule),
    forwardRef(() => RulesModule),
    OutputModule,
    ExtractionModule,
  ],
  providers: [LibraryService, ScanHistoryService],
  controllers: [LibraryController],
  exports: [LibraryService],
})
export class LibraryModule {}
