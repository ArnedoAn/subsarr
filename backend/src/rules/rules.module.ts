import { forwardRef, Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { RulesService } from './rules.service';
import { RulesController } from './rules.controller';

@Module({
  imports: [forwardRef(() => SettingsModule)],
  providers: [RulesService],
  controllers: [RulesController],
  exports: [RulesService],
})
export class RulesModule {}
