import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  forwardRef,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { parseSettingsBundle } from './import-bundle';
import type { Response } from 'express';
import archiver from 'archiver';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { TokenUsageService } from './token-usage.service';
import { LibraryScanSchedulerService } from '../jobs/library-scan-scheduler.service';
import { TelegramService } from '../notifications/telegram.service';
import { JellyfinService } from '../integrations/jellyfin.service';
import { ProfilesService } from '../profiles/profiles.service';
import { GlossaryService } from '../glossary/glossary.service';

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly tokenUsageService: TokenUsageService,
    @Inject(forwardRef(() => LibraryScanSchedulerService))
    private readonly libraryScanScheduler: LibraryScanSchedulerService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    @Inject(forwardRef(() => JellyfinService))
    private readonly jellyfinService: JellyfinService,
    private readonly profilesService: ProfilesService,
    private readonly glossaryService: GlossaryService,
  ) {}

  @Get()
  async getSettings() {
    return this.settingsService.getPublicSettings();
  }

  @Get('available-models')
  async availableModels() {
    return this.settingsService.fetchAvailableModels();
  }

  @Get('opencode-go/models')
  async openCodeGoModels() {
    return this.settingsService.fetchOpenCodeGoModels();
  }

  @Put()
  async updateSettings(@Body() dto: UpdateSettingsDto) {
    const res = await this.settingsService.updateSettings(dto);
    await this.libraryScanScheduler.refreshSchedule();
    return res;
  }

  @Post('reset')
  async resetSettings() {
    const res = await this.settingsService.resetToEnvDefaults();
    await this.libraryScanScheduler.refreshSchedule();
    return res;
  }

  @Get('token-usage')
  tokenUsage() {
    return this.tokenUsageService.getSummary();
  }

  @Get('budget')
  budget() {
    return this.settingsService.getBudgetStatus();
  }

  @Post('telegram/test')
  telegramTest() {
    return this.telegramService.sendTestMessage();
  }

  @Get('telegram/status')
  telegramStatus() {
    return this.telegramService.getConnectionStatus();
  }

  @Post('jellyfin/test')
  jellyfinTest() {
    return this.jellyfinService.testConnection();
  }

  @Get('export')
  async exportBundle(
    @Res() res: Response,
    @Query('includeSecrets') includeSecrets?: string,
  ): Promise<void> {
    if (
      includeSecrets !== undefined &&
      includeSecrets !== 'true' &&
      includeSecrets !== 'false'
    )
      throw new BadRequestException('includeSecrets must be true or false');
    const runtime = await this.settingsService.getExportSettings(
      includeSecrets === 'true',
    );
    const profiles = await this.profilesService.list();
    const glossary = await this.glossaryService.list();
    res.setHeader('Cache-Control', 'no-store');
    const token = await this.tokenUsageService.getSummary();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="subsarr-config.zip"',
    );

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err: Error) => {
      res.destroy(err);
    });
    archive.pipe(res);
    archive.append(JSON.stringify(runtime, null, 2), {
      name: 'settings-runtime.json',
    });
    archive.append(JSON.stringify({ profiles }, null, 2), {
      name: 'profiles.json',
    });
    archive.append(JSON.stringify({ entries: glossary }, null, 2), {
      name: 'glossary.json',
    });
    archive.append(JSON.stringify(token, null, 2), {
      name: 'token-usage-summary.json',
    });
    await archive.finalize();
  }

  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    }),
  )
  async importBundle(@UploadedFile() file: { buffer: Buffer } | undefined) {
    if (!file?.buffer?.length)
      throw new BadRequestException('ZIP file required');
    const bundle = parseSettingsBundle(file.buffer);
    const restored: string[] = [];
    if (bundle.settings) {
      const dto = plainToInstance(UpdateSettingsDto, bundle.settings);
      if (
        validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })
          .length
      )
        throw new BadRequestException('Invalid imported settings schema');
      await this.settingsService.updateSettings(dto);
      restored.push('settings');
    }
    if (bundle.profiles) {
      await this.profilesService.save(bundle.profiles);
      restored.push('profiles');
    }
    if (bundle.glossary) {
      await this.glossaryService.save(bundle.glossary);
      restored.push('glossary');
    }
    if (bundle.settings) await this.libraryScanScheduler.refreshSchedule();
    return { ok: true, restored };
  }
}
