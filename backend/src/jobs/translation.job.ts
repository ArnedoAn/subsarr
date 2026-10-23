import { Logger, forwardRef, Inject } from '@nestjs/common';
import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { promises as fs } from 'node:fs';
import { ExtractionService } from '../extraction/extraction.service';
import type {
  JobReturnValue,
  TranslationJobPayload,
  JobProgressEvent,
} from './jobs.types';
import { LibraryService } from '../library/library.service';
import { RulesService } from '../rules/rules.service';
import { SettingsService } from '../settings/settings.service';
import { SubtitleTranslationService } from '../translation/subtitle-translation.service';
import { OutputService } from '../output/output.service';
import { JobsEventsService } from './jobs-events.service';
import { TokenUsageService } from '../settings/token-usage.service';
import { JobLogsService } from './job-logs.service';
import { JobArchiveService } from './job-archive.service';
import { TelegramService } from '../notifications/telegram.service';
import { JellyfinService } from '../integrations/jellyfin.service';
import {
  JobCancellationService,
  JobInterruptionError,
  type JobCancellationControl,
} from './job-cancellation.service';
@Processor('translation')
export class TranslationJobProcessor {
  private readonly logger = new Logger(TranslationJobProcessor.name);
  constructor(
    private readonly extractionService: ExtractionService,
    private readonly libraryService: LibraryService,
    private readonly rulesService: RulesService,
    private readonly settingsService: SettingsService,
    private readonly documentTranslation: SubtitleTranslationService,
    private readonly outputService: OutputService,
    private readonly jobsEventsService: JobsEventsService,
    private readonly tokenUsageService: TokenUsageService,
    private readonly jobLogsService: JobLogsService,
    private readonly jobArchiveService: JobArchiveService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
    private readonly jellyfinService: JellyfinService,
    private readonly cancellation: JobCancellationService,
  ) {}

  @Process({ concurrency: Number(process.env.SUBSYNC_CONCURRENCY ?? 2) })
  async handle(
    job: Job<TranslationJobPayload>,
  ): Promise<JobReturnValue | { cancelled: true }> {
    const jobId = String(job.id);
    let control: JobCancellationControl | undefined;
    let tempFilePath: string | undefined;
    let committedResult: JobReturnValue | undefined;
    const publish = async (
      phase: JobProgressEvent['phase'],
      progressPercent: number,
      message: string,
      details?: unknown,
    ) => {
      await job.progress(progressPercent);
      await this.jobLogsService.append({
        jobId,
        phase,
        level: phase === 'failed' ? 'error' : 'info',
        message,
        details,
      });
      this.jobsEventsService.publish(jobId, {
        phase,
        progressPercent,
        message,
        timestamp: new Date().toISOString(),
        details,
      });
    };
    const archive = async (
      state: 'completed' | 'failed' | 'cancelled',
      returnValue?: JobReturnValue,
      failedReason?: string,
    ) => {
      await this.jobArchiveService.appendSnapshot({
        id: jobId,
        state,
        data: job.data,
        createdAt: job.timestamp,
        processedAt: job.processedOn,
        finishedAt: Date.now(),
        progress: 100,
        returnValue,
        failedReason,
        logs: [],
      });
    };
    try {
      control = await this.cancellation.start(jobId);
      await publish('active', 0, 'Job started');
      await this.settingsService.assertTranslationBudget({
        provider: job.data.provider,
        automatic: job.data.automatic ?? job.data.triggeredBy === 'auto-scan',
        allowBudgetOverride: job.data.allowBudgetOverride,
      });
      const item = await this.libraryService.getById(job.data.mediaItemId);
      await control.checkpoint();
      if (!job.data.forceBypassRules) {
        const result = await this.rulesService.evaluate(item, {
          sourceLanguage: job.data.sourceLanguage,
          targetLanguage: job.data.targetLanguage,
          targetConflictResolution: job.data.targetConflictResolution,
        });
        if (result.skip)
          throw new Error(`Job blocked by rules: ${result.reason}`);
      }
      await control.checkpoint();
      await publish('extracting', 10, 'Extracting subtitle track');
      const extraction = await this.extractionService.extractSubtitleTrack(
        item.path,
        job.data.sourceTrackIndex,
        job.data.outputExtension ?? 'srt',
        { signal: control.signal },
      );
      tempFilePath = extraction.tempFilePath;
      await control.checkpoint();
      const input = await fs.readFile(tempFilePath, { signal: control.signal });
      await publish('translating', 25, 'Translating subtitle document');
      const translated = await this.documentTranslation.translateDocument(
        input,
        `subtitle.${job.data.outputExtension ?? 'srt'}`,
        {
          sourceLanguage: job.data.sourceLanguage,
          targetLanguage: job.data.targetLanguage,
          provider: job.data.provider,
          signal: control.signal,
          automatic: job.data.automatic ?? job.data.triggeredBy === 'auto-scan',
          allowBudgetOverride: job.data.allowBudgetOverride,
          onProgress: async (info) => {
            await control!.checkpoint();
            await publish(
              'translating',
              25 + Math.floor(info.progressPercent * 0.65),
              info.message,
              info.details,
            );
          },
          // Every successful HTTP response is billed once, including rejected responses.
          onUsage: async (attempt) => {
            await this.tokenUsageService.addProviderUsage(attempt);
          },
        },
      );
      await control.checkpoint();
      for (const warning of translated.warnings)
        await this.jobLogsService.append({
          jobId,
          phase: 'translating',
          level: 'warn',
          message: warning,
        });
      const outputExtension = translated.extension;
      if (outputExtension !== 'srt' && outputExtension !== 'ass') {
        throw new Error(
          `Unsupported extracted media subtitle format: ${outputExtension}`,
        );
      }
      await publish('writing', 95, 'Writing output subtitle file');
      await control.checkpoint();
      const outputPath = await this.outputService.writeSubtitle(
        item.path,
        job.data.targetLanguage,
        translated.content,
        false,
        outputExtension,
        job.data.targetConflictResolution === 'alternate'
          ? 'alternate'
          : 'default',
        {
          signal: control.signal,
          overwrite: job.data.targetConflictResolution === 'replace',
          itemId: item.id,
        },
      );
      // Atomic publication is the commit point: a cancellation racing after it cannot undo completed work.
      const result: JobReturnValue = {
        outputPath,
        tierUsed: translated.tierUsed,
        usage: translated.usage,
        lineCount: translated.cueCount,
      };
      committedResult = result;
      await job.discard();
      await archive('completed', result);
      await publish('completed', 100, 'Translation completed');
      void this.telegramService.notifyJobCompleted(
        jobId,
        job.data,
        result,
        job.timestamp,
      );
      void this.jellyfinService.refreshLibraryAfterSubtitle();
      return result;
    } catch (error) {
      if (committedResult) {
        // Publication is durable media success. Metadata failure must never rerun paid work.
        const warning = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Job ${jobId} output committed; completion metadata degraded: ${warning}`,
        );
        try {
          await archive('completed', committedResult);
        } catch (archiveError) {
          this.logger.error(
            `Job ${jobId} completion archive unavailable: ${String(archiveError)}`,
          );
        }
        this.jobsEventsService.publish(jobId, {
          phase: 'completed',
          progressPercent: 100,
          message: 'Translation completed; activity metadata update degraded',
          timestamp: new Date().toISOString(),
          details: { warning },
        });
        return committedResult;
      }
      const interruption =
        error instanceof JobInterruptionError
          ? error
          : control?.signal.reason instanceof JobInterruptionError
            ? control.signal.reason
            : undefined;
      if (interruption?.reason === 'user') {
        await job.discard();
        await publish('cancelled', 100, interruption.message);
        await archive('cancelled');
        return { cancelled: true };
      }
      if (interruption?.reason === 'stalled') await job.discard();
      const message =
        interruption?.message ??
        (error instanceof Error ? error.message : 'Unknown failure');
      this.logger.error(`Job ${jobId}: ${message}`);
      await publish('failed', 100, message);
      await archive('failed', undefined, message);
      void this.telegramService.notifyJobFailed(jobId, job.data, message);
      throw interruption ?? error;
    } finally {
      control?.stop();
      if (tempFilePath) await fs.unlink(tempFilePath).catch(() => undefined);
    }
  }
}
