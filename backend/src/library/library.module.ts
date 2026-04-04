import { forwardRef, Module } from '@nestjs/common';
import { LibraryService } from './library.service';
import { LibraryController } from './library.controller';
import { SettingsModule } from '../settings/settings.module';
import { RulesModule } from '../rules/rules.module';
import { OutputModule } from '../output/output.module';
import { ExtractionModule } from '../extraction/extraction.module';

@Module({
  imports: [
    forwardRef(() => SettingsModule),
    forwardRef(() => RulesModule),
    OutputModule,
    ExtractionModule,
  ],
  providers: [LibraryService],
  controllers: [LibraryController],
  exports: [LibraryService],
})
export class LibraryModule {}
