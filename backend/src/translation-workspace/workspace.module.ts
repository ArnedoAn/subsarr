import { forwardRef, Module } from '@nestjs/common';
import { TranslationModule } from '../translation/translation.module';
import { SettingsModule } from '../settings/settings.module';
import { GlossaryModule } from '../glossary/glossary.module';
import { LibraryModule } from '../library/library.module';
import { OutputModule } from '../output/output.module';
import { ExtractionModule } from '../extraction/extraction.module';
import { WorkspacePersistenceModule } from './workspace-persistence.module';
import { WorkspaceService } from './workspace.service';
import {
  WorkspaceCheckpointController,
  WorkspaceController,
  WorkspaceMemoryController,
} from './workspace.controller';

@Module({
  imports: [
    TranslationModule,
    forwardRef(() => SettingsModule),
    GlossaryModule,
    forwardRef(() => LibraryModule),
    OutputModule,
    ExtractionModule,
    WorkspacePersistenceModule,
  ],
  providers: [WorkspaceService],
  controllers: [
    WorkspaceController,
    WorkspaceCheckpointController,
    WorkspaceMemoryController,
  ],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
