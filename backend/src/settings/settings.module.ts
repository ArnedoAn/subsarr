import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { TokenUsageService } from './token-usage.service';

@Module({
  providers: [SettingsService, TokenUsageService],
  controllers: [SettingsController],
  exports: [SettingsService, TokenUsageService],
})
export class SettingsModule {}
