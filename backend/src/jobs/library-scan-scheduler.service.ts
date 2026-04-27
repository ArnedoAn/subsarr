import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { SettingsService } from '../settings/settings.service';
import { LibraryService } from '../library/library.service';
import { JobsService } from './jobs.service';
import { TelegramService } from '../notifications/telegram.service';
import type { MediaItem } from '../library/media-item.entity';
import type { RuntimeSettings } from '../settings/settings.types';

const CRON_NAME = 'libraryAutoScan';

@Injectable()
export class LibraryScanSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(LibraryScanSchedulerService.name);

  constructor(
    @Inject(forwardRef(() => SettingsService))
    private readonly settingsService: SettingsService,
    private readonly libraryService: LibraryService,
    private readonly jobsService: JobsService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly telegramService: TelegramService,
  ) {}

  async onModuleInit() {
    await this.refreshSchedule();
  }

  /** Re-register cron from settings (call after settings PUT / reset). */
  async refreshSchedule(): Promise<void> {
    try {
      const existing = this.schedulerRegistry.getCronJob(CRON_NAME);
      existing.stop();
      this.schedulerRegistry.deleteCronJob(CRON_NAME);
    } catch {
      /* no job */
    }

    const s = await this.settingsService.getSettings();
    if (!s.autoScanEnabled) {
      this.logger.log('Library auto-scan is disabled');
      return;
    }

    let job: CronJob;
    try {
      job = new CronJob(s.autoScanCronExpression, () => {
        void this.runScheduledScan();
      });
    } catch (e) {
      this.logger.error(
        `Invalid autoScanCronExpression "${s.autoScanCronExpression}": ${e instanceof Error ? e.message : e}`,
      );
      return;
    }

    this.schedulerRegistry.addCronJob(CRON_NAME, job);
    job.start();
    this.logger.log(`Library auto-scan scheduled: ${s.autoScanCronExpression}`);
  }

  async runScheduledScan(): Promise<void> {
    const settings = await this.settingsService.getSettings();
    if (!settings.autoScanEnabled) {
      return;
    }

    const start = Date.now();
    try {
      const before = await this.libraryService.getLibrary(false);
      const beforeIds = new Set(before.map((i) => i.id));
      const items = await this.libraryService.rescan();
      const newItems = items.filter((i) => !beforeIds.has(i.id));

      if (settings.autoTranslateNewItems && newItems.length > 0) {
        for (const item of newItems) {
          await this.tryEnqueueNewMedia(item, settings);
        }
      }

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      this.logger.log(
        `Library auto-scan done: ${items.length} items, ${newItems.length} new since last cache, ${elapsed}s`,
      );
      void this.telegramService.notifyScanCompleted({
        totalItems: items.length,
        newItems: newItems.length,
        seconds: elapsed,
      });
    } catch (err) {
      this.logger.error(
        `Library auto-scan failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private async tryEnqueueNewMedia(
    item: MediaItem,
    settings: RuntimeSettings,
  ): Promise<void> {
    const track = item.subtitleTracks.find(
      (t) => t.language === settings.sourceLanguage,
    );
    if (!track) {
      this.logger.debug(
        `Auto-translate skip (no embedded ${settings.sourceLanguage} track): ${item.path}`,
      );
      return;
    }

    try {
      await this.jobsService.enqueue({
        mediaItemId: item.id,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        sourceTrackIndex: track.index,
        triggeredBy: 'auto-scan',
        targetConflictResolution: 'replace',
      });
      this.logger.log(`Auto-translate queued: ${item.path}`);
    } catch (e) {
      this.logger.warn(
        `Auto-translate not queued for ${item.path}: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
}
