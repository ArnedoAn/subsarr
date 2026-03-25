import { Module } from '@nestjs/common';
import { LibraryService } from './library.service';
import { LibraryController } from './library.controller';
import { SettingsModule } from '../settings/settings.module';
import { RulesModule } from '../rules/rules.module';

@Module({
  imports: [SettingsModule, RulesModule],
  providers: [LibraryService],
  controllers: [LibraryController],
  exports: [LibraryService],
})
export class LibraryModule {}
