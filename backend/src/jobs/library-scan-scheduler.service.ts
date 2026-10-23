import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobSchedulerStateEntity } from '../database/entities/job-scheduler-state.entity';
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
  private scanRunning = false;
  private readonly knownItemIds = new Set<string>();
  private readonly pendingProbeItemIds = new Set<string>();
  private mediaRootsKey: string | null = null;
  private checkpointRestored = false;
  private checkpointRestore: Promise<void> | null = null;

  constructor(
    @Inject(forwardRef(() => SettingsService))
    private readonly settingsService: SettingsService,
    private readonly libraryService: LibraryService,
    private readonly jobsService: JobsService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly telegramService: TelegramService,
    @Optional()
    @InjectRepository(JobSchedulerStateEntity)
    private readonly schedulerStateRepository?: Repository<JobSchedulerStateEntity>,
  ) {}

  async onModuleInit() {
    await this.restoreCheckpoint();
    await this.refreshSchedule();
  }

  /** Re-register cron from settings (call after settings PUT / reset). */
  async refreshSchedule(): Promise<void> {
    try {
      const existing = this.schedulerRegistry.getCronJob(CRON_NAME);
      await existing.stop();
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
    if (this.scanRunning) {
      this.logger.log(
        'Library auto-scan skipped: previous run is still active',
      );
      return;
    }

    this.scanRunning = true;
    const start = Date.now();
    try {
      const settings = await this.settingsService.getSettings();
      await this.restoreCheckpoint();
      if (!settings.autoScanEnabled) {
        return;
      }

      const rootsKey = JSON.stringify([...new Set(settings.mediaDirs)].sort());
      const rootsChanged =
        this.mediaRootsKey !== null && this.mediaRootsKey !== rootsKey;
      const before = this.libraryService.getCachedItems();
      const baselineReady =
        (before !== null || this.mediaRootsKey !== null) && !rootsChanged;

      // Interactive scans seed healthy discoveries, but must not consume a
      // failed discovery that is still waiting for its first successful probe.
      if (before !== null) {
        for (const item of before) {
          if (this.knownItemIds.has(item.id)) continue;
          if (item.probeStatus === 'failed') {
            this.pendingProbeItemIds.add(item.id);
          } else if (!this.pendingProbeItemIds.has(item.id)) {
            this.knownItemIds.add(item.id);
          }
        }
      }
      this.logger.log(
        `Library auto-scan baseline: ${baselineReady ? 'ready' : 'seeding'}, rootsChanged=${rootsChanged}, knownItems=${this.knownItemIds.size}`,
      );

      const items = await this.libraryService.getLibrary(true, 'scheduled');
      const newItems: MediaItem[] = [];

      // Root changes seed healthy items without mass enqueueing. Failed items
      // remain pending across scans, disappearances, and interactive recovery.
      // Keep known history so an already handled item never becomes new again.
      for (const item of items) {
        if (this.knownItemIds.has(item.id)) continue;
        if (item.probeStatus === 'failed') {
          this.pendingProbeItemIds.add(item.id);
          continue;
        }
        if (
          item.probeStatus === 'skipped' &&
          this.pendingProbeItemIds.has(item.id)
        ) {
          continue;
        }
        if (
          item.probeStatus === 'ok' &&
          (baselineReady || this.pendingProbeItemIds.has(item.id))
        ) {
          newItems.push(item);
        }
        this.pendingProbeItemIds.delete(item.id);
        this.knownItemIds.add(item.id);
      }
      // Commit roots only after a successful scan so failures still reseed.
      this.mediaRootsKey = rootsKey;
      await this.persistCheckpoint();

      if (settings.autoTranslateNewItems && newItems.length > 0) {
        for (const item of newItems) {
          await this.tryEnqueueNewMedia(item, settings);
        }
      }

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      this.logger.log(
        `Library auto-scan done: ${items.length} items, ${newItems.length} new, baselineReady=${baselineReady}, ${elapsed}s`,
      );
      await this.telegramService.notifyScanCompleted({
        totalItems: items.length,
        newItems: newItems.length,
        seconds: elapsed,
      });
    } catch (err) {
      this.logger.error(
        `Library auto-scan failed: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.scanRunning = false;
    }
  }

  private async restoreCheckpoint(): Promise<void> {
    if (this.checkpointRestored || !this.schedulerStateRepository) return;
    if (!this.checkpointRestore) {
      this.checkpointRestore = this.schedulerStateRepository
        .findOneBy({ id: CRON_NAME })
        .then((checkpoint) => {
          if (checkpoint) {
            for (const id of checkpoint.knownItemIds) this.knownItemIds.add(id);
            for (const id of checkpoint.pendingProbeItemIds) {
              if (!this.knownItemIds.has(id)) this.pendingProbeItemIds.add(id);
            }
            this.mediaRootsKey = checkpoint.mediaRootsKey;
          }
          this.checkpointRestored = true;
        })
        .finally(() => {
          this.checkpointRestore = null;
        });
    }
    await this.checkpointRestore;
  }

  private async persistCheckpoint(): Promise<void> {
    if (!this.schedulerStateRepository) return;
    await this.schedulerStateRepository.save({
      id: CRON_NAME,
      knownItemIds: [...this.knownItemIds],
      pendingProbeItemIds: [...this.pendingProbeItemIds],
      mediaRootsKey: this.mediaRootsKey,
    });
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
