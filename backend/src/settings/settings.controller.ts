import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
  forwardRef,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import AdmZip from 'adm-zip';
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
  async exportBundle(@Res() res: Response): Promise<void> {
    const runtime = await this.settingsService.getSettings();
    const profiles = await this.profilesService.list();
    const glossary = await this.glossaryService.list();
    const token = await this.tokenUsageService.getSummary();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="subsarr-config.zip"',
    );

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err: Error) => {
      throw err;
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
  @UseInterceptors(FileInterceptor('file'))
  async importBundle(@UploadedFile() file: { buffer: Buffer } | undefined) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('ZIP file required');
    }
    const zip = new AdmZip(file.buffer);
    const restored: string[] = [];
    for (const e of zip.getEntries()) {
      if (e.isDirectory) {
        continue;
      }
      const name = e.entryName.split('/').pop() ?? e.entryName;
      if (name === 'profiles.json') {
        const j = JSON.parse(e.getData().toString('utf8')) as {
          profiles?: import('../profiles/profile.types').TranslationProfile[];
        };
        await this.profilesService.save(j.profiles ?? []);
        restored.push('profiles');
      }
      if (name === 'glossary.json') {
        const j = JSON.parse(e.getData().toString('utf8')) as {
          entries?: import('../glossary/glossary.types').GlossaryEntry[];
        };
        await this.glossaryService.save(j.entries ?? []);
        restored.push('glossary');
      }
    }
    if (restored.length === 0) {
      throw new BadRequestException(
        'No profiles.json or glossary.json found in ZIP',
      );
    }
    return { ok: true, restored };
  }
}
