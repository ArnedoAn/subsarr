import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { TokenUsageService } from './token-usage.service';

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly tokenUsageService: TokenUsageService,
  ) {}

  @Get()
  async getSettings() {
    return this.settingsService.getPublicSettings();
  }

  @Put()
  async updateSettings(@Body() dto: UpdateSettingsDto) {
    return this.settingsService.updateSettings(dto);
  }

  @Post('reset')
  async resetSettings() {
    return this.settingsService.resetToEnvDefaults();
  }

  @Get('token-usage')
  tokenUsage() {
    return this.tokenUsageService.getSummary();
  }
}
