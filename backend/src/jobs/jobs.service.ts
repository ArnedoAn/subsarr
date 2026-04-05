import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { randomUUID } from 'node:crypto';
import { type CreateJobDto } from './dto/create-job.dto';
import { type JobReturnValue, type TranslationJobPayload } from './jobs.types';
import { OutputService } from '../output/output.service';
import { type CreateBatchJobsDto } from './dto/create-batch-jobs.dto';
import { type BatchPreviewDto } from './dto/batch-preview.dto';
import { LibraryService } from '../library/library.service';
import { RulesService } from '../rules/rules.service';
import { JobLogsService } from './job-logs.service';
import {
  JobArchiveService,
  type ArchivedJobSnapshot,
} from './job-archive.service';
import {
  type MediaItem,
  type SubtitleTrack,
} from '../library/media-item.entity';
import {
  subtitleOutputExtensionFromCodec,
  type SubtitleOutputExtension,
} from '../translation/subtitle-format';
import { SettingsService } from '../settings/settings.service';
import { TokenUsageService } from '../settings/token-usage.service';
import { ProfilesService } from '../profiles/profiles.service';
import type { TranslationProfile } from '../profiles/profile.types';
import type { LogsQueryDto } from './dto/logs-query.dto';

@Injectable()
export class JobsService implements OnModuleInit {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @InjectQueue('translation')
    private readonly translationQueue: Queue<TranslationJobPayload>,
    private readonly outputService: OutputService,
    private readonly libraryService: LibraryService,
    private readonly rulesService: RulesService,
    private readonly jobLogsService: JobLogsService,
    private readonly jobArchiveService: JobArchiveService,
    private readonly settingsService: SettingsService,
    private readonly tokenUsageService: TokenUsageService,
    private readonly profilesService: ProfilesService,
  ) {}

  onModuleInit() {
    // Cuando Bull detecta que el proceso murió con un job activo (stalled),
    // lo mueve de vuelta a "waiting". Interceptamos ese evento para cancelarlo
    // en lugar de reintentarlo, y lo archivamos como fallido.
    this.translationQueue.on('stalled', (job) => {
      void (async () => {
        const jobId = String(job.id);
        const reason = 'Job cancelado: el servidor se reinició mientras estaba en proceso';
        this.logger.warn(`Stalled job detected [${jobId}], cancelling instead of retrying`);
        try {
          await this.jobLogsService.append({
            jobId,
            level: 'error',
            phase: 'failed',
            message: reason,
          });
          await this.jobArchiveService.appendSnapshot({
            id: jobId,
            state: 'failed',
            data: job.data as TranslationJobPayload,
            createdAt: job.timestamp,
            processedAt: job.processedOn ?? undefined,
            finishedAt: Date.now(),
            progress: 0,
            failedReason: reason,
            logs: await this.jobLogsService.getByJob(jobId),
          });
          // Quitar del queue para que no se reintente
          await job.remove();
        } catch (e) {
          this.logger.error(
            `Failed to cancel stalled job [${jobId}]: ${e instanceof Error ? e.message : e}`,
          );
        }
      })();
    });
  }

  async enqueue(
    dto: CreateJobDto,
  ): Promise<
    | { id: string | number; state: string }
    | {
        batchGroupId: string;
        jobs: Array<{ id: string | number; state: string }>;
      }
  > {
    await this.assertTokenQuotas();

    if (
      !dto.targetLanguages?.length &&
      (!dto.targetLanguage || !dto.targetLanguage.trim())
    ) {
      throw new BadRequestException(
        'targetLanguage or targetLanguages is required',
      );
    }

    const targets =
      dto.targetLanguages && dto.targetLanguages.length > 0
        ? dto.targetLanguages.map((l) => this.normalizeLanguage(l))
        : [this.normalizeLanguage(dto.targetLanguage!)];

    if (targets.length === 1) {
      return this.enqueueSingleTarget(dto, {
        targetLanguage: targets[0],
      });
    }

    const batchGroupId = randomUUID();
    const jobs: Array<{ id: string | number; state: string }> = [];
    for (const targetLanguage of targets) {
      jobs.push(
        await this.enqueueSingleTarget(dto, {
          targetLanguage,
          batchGroupId,
        }),
      );
    }
    return { batchGroupId, jobs };
  }

  private async enqueueSingleTarget(
    dto: CreateJobDto,
    ctx: { targetLanguage: string; batchGroupId?: string },
  ): Promise<{ id: string | number; state: string }> {
    let item: MediaItem | null = null;
    let sourceLanguage = '';
    let targetLanguage = ctx.targetLanguage;
    let provider: 'openrouter' | 'deepseek' | undefined = dto.provider;
    let outputExtension: SubtitleOutputExtension = 'srt';

    try {
      sourceLanguage = this.normalizeLanguage(dto.sourceLanguage);

      item = await this.libraryService.getById(dto.mediaItemId);
      this.validateMediaPath(dto, item);

      if (dto.respectProfiles !== false) {
        const settings = await this.settingsService.getSettings();
        const profiles = await this.profilesService.list();
        const eff = this.resolveProfileForPath(item.path, profiles, {
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          provider: dto.provider,
        });
        sourceLanguage = this.normalizeLanguage(eff.sourceLanguage);
        provider = eff.provider ?? dto.provider;
        if (!dto.targetLanguages?.length) {
          targetLanguage = this.normalizeLanguage(eff.targetLanguage);
        }
      }

      const sourceTrack = this.validateSourceTrack(item, dto.sourceTrackIndex);
      outputExtension = subtitleOutputExtensionFromCodec(sourceTrack.codec);
      if (sourceTrack.language !== sourceLanguage) {
        throw new BadRequestException(
          `Source language ${sourceLanguage} does not match selected track language ${sourceTrack.language}`,
        );
      }
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      await this.jobLogsService.append({
        level: 'warn',
        phase: 'precheck',
        message:
          error instanceof Error
            ? error.message
            : 'Job payload validation failed before enqueue',
        details: {
          mediaItemId: dto.mediaItemId,
          sourceTrackIndex: dto.sourceTrackIndex,
        },
      });
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Job payload validation failed before enqueue',
      );
    }

    if (!item) {
      throw new BadRequestException(
        'Media item was not resolved during precheck',
      );
    }

    if (!dto.forceBypassRules) {
      const ruleResult = await this.rulesService.evaluate(item, {
        sourceLanguage,
        targetLanguage,
        targetConflictResolution: dto.targetConflictResolution,
      });

      if (ruleResult.skip) {
        await this.jobLogsService.append({
          level: 'warn',
          phase: 'precheck',
          message: `Job blocked by rules: ${ruleResult.reason ?? 'Blocked by rule'}`,
          details: {
            mediaItemId: dto.mediaItemId,
          },
        });
        throw new BadRequestException(
          `Job blocked by rules: ${ruleResult.reason ?? 'Blocked by rule'}`,
        );
      }
    }

    const pathVariant =
      dto.targetConflictResolution === 'alternate' ? 'alternate' : 'default';
    const outputPath = this.outputService.buildSubtitlePath(
      item.path,
      targetLanguage,
      false,
      outputExtension,
      pathVariant,
    );
    const waiting = await this.translationQueue.getWaiting();
    const active = await this.translationQueue.getActive();

    const duplicate = [...waiting, ...active].find((job) => {
      const payload = job.data;
      if (!payload.mediaItemPath) {
        return false;
      }

      const ext = payload.outputExtension ?? 'srt';
      const variant =
        payload.targetConflictResolution === 'alternate'
          ? 'alternate'
          : 'default';
      return (
        this.outputService.buildSubtitlePath(
          payload.mediaItemPath,
          payload.targetLanguage,
          false,
          ext,
          variant,
        ) === outputPath
      );
    });

    if (duplicate) {
      await this.jobLogsService.append({
        level: 'warn',
        phase: 'precheck',
        message: `Duplicate output path conflict: ${outputPath}`,
        details: {
          mediaItemId: dto.mediaItemId,
        },
      });
      throw new ConflictException(
        `A job is already processing this output path: ${outputPath}`,
      );
    }

    const job = await this.translationQueue.add(
      {
        mediaItemId: item.id,
        mediaItemPath: item.path,
        sourceLanguage,
        targetLanguage,
        sourceTrackIndex: dto.sourceTrackIndex,
        outputExtension,
        targetConflictResolution: dto.targetConflictResolution,
        triggeredBy: dto.triggeredBy,
        forceBypassRules: dto.forceBypassRules ?? false,
        provider,
        batchGroupId: ctx.batchGroupId,
      },
      {
        removeOnComplete: 200,
        removeOnFail: 200,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
        priority: this.defaultPriority(dto),
      },
    );

    await this.jobLogsService.append({
      jobId: String(job.id),
      level: 'info',
      phase: 'waiting',
      message: `Queued translation job for ${item.path}`,
      details: {
        sourceLanguage,
        targetLanguage,
        sourceTrackIndex: dto.sourceTrackIndex,
      },
    });

    return {
      id: job.id,
      state: await job.getState(),
    };
  }

  async enqueueBatch(dto: CreateBatchJobsDto) {
    await this.assertTokenQuotas();

    const results: Array<{
      mediaItemId: string;
      id?: string | number;
      error?: string;
    }> = [];

    for (const item of dto.items) {
      try {
        const job = await this.enqueue({
          mediaItemId: item.mediaItemId,
          mediaItemPath: item.mediaItemPath,
          sourceLanguage: dto.sourceLanguage,
          targetLanguage: dto.targetLanguage,
          sourceTrackIndex: item.sourceTrackIndex,
          triggeredBy: dto.triggeredBy,
          forceBypassRules: dto.forceBypassRules,
          provider: dto.provider,
          targetConflictResolution: dto.targetConflictResolution,
          priority: dto.priority ?? 8,
        });

        if ('batchGroupId' in job) {
          throw new Error('Unexpected multi-target batch item');
        }

        results.push({
          mediaItemId: item.mediaItemId,
          id: job.id,
        });
      } catch (error) {
        results.push({
          mediaItemId: item.mediaItemId,
          error: error instanceof Error ? error.message : 'Failed to enqueue',
        });
      }
    }

    return results;
  }

  async previewBatch(dto: BatchPreviewDto) {
    const sourceLanguage = this.normalizeLanguage(dto.sourceLanguage);
    const targetLanguage = this.normalizeLanguage(dto.targetLanguage);

    const results: Array<{
      mediaItemId: string;
      status:
        | 'ready'
        | 'no_source_track'
        | 'rule_blocked'
        | 'not_found'
        | 'error';
      sourceTrackIndex?: number;
      reason?: string;
    }> = [];

    for (const { mediaItemId } of dto.items) {
      try {
        const item = await this.libraryService.getById(mediaItemId);
        const track = item.subtitleTracks.find(
          (t) => t.language === sourceLanguage,
        );
        if (!track) {
          results.push({
            mediaItemId,
            status: 'no_source_track',
            reason: `No embedded subtitle track for language "${sourceLanguage}"`,
          });
          continue;
        }

        this.validateSourceTrack(item, track.index);

        if (!dto.forceBypassRules) {
          const ruleResult = await this.rulesService.evaluate(item, {
            sourceLanguage,
            targetLanguage,
            targetConflictResolution: dto.targetConflictResolution,
          });
          if (ruleResult.skip) {
            results.push({
              mediaItemId,
              status: 'rule_blocked',
              sourceTrackIndex: track.index,
              reason: ruleResult.reason ?? 'Blocked by rules',
            });
            continue;
          }
        }

        results.push({
          mediaItemId,
          status: 'ready',
          sourceTrackIndex: track.index,
        });
      } catch (error) {
        if (error instanceof NotFoundException) {
          results.push({
            mediaItemId,
            status: 'not_found',
            reason: 'Media item not found',
          });
          continue;
        }
        results.push({
          mediaItemId,
          status: 'error',
          reason:
            error instanceof Error ? error.message : 'Unknown preview error',
        });
      }
    }

    return results;
  }

  async list() {
    const jobs = await this.translationQueue.getJobs([
      'waiting',
      'active',
      'completed',
      'failed',
    ]);
    const fromRedis = await Promise.all(
      jobs.map(async (job) => ({
        id: job.id,
        data: job.data,
        progress: Number(job.progress()),
        state: await job.getState(),
        returnValue: job.returnvalue as JobReturnValue | undefined,
        failedReason: job.failedReason,
        createdAt: job.timestamp,
        processedAt: job.processedOn,
        finishedAt: job.finishedOn,
        archived: false,
      })),
    );

    const redisIds = new Set(fromRedis.map((j) => String(j.id)));
    const archived = await this.jobArchiveService.readSnapshots();
    const fromArchive = archived
      .filter((s) => !redisIds.has(s.id))
      .map((s) => this.mapArchivedToListItem(s));

    const merged = [...fromRedis, ...fromArchive];
    merged.sort(
      (a, b) =>
        (b.finishedAt ?? b.processedAt ?? b.createdAt) -
        (a.finishedAt ?? a.processedAt ?? a.createdAt),
    );
    return merged;
  }

  async getById(id: string) {
    const job = await this.translationQueue.getJob(id);
    if (job) {
      return {
        id: job.id,
        data: job.data,
        progress: Number(job.progress()),
        state: await job.getState(),
        returnValue: job.returnvalue as JobReturnValue | undefined,
        failedReason: job.failedReason,
        createdAt: job.timestamp,
        processedAt: job.processedOn,
        finishedAt: job.finishedOn,
        logs: await this.jobLogsService.getByJob(id),
        archived: false,
      };
    }

    const snap = await this.jobArchiveService.getSnapshot(id);
    if (snap) {
      return {
        id: snap.id,
        data: snap.data,
        progress: snap.progress,
        state: snap.state,
        returnValue: snap.returnValue,
        failedReason: snap.failedReason,
        createdAt: snap.createdAt,
        processedAt: snap.processedAt,
        finishedAt: snap.finishedAt,
        logs: snap.logs,
        archived: true,
      };
    }

    throw new NotFoundException(`Job not found: ${id}`);
  }

  async cancel(id: string) {
    const job = await this.translationQueue.getJob(id);
    if (!job) {
      throw new NotFoundException(`Job not found: ${id}`);
    }

    const state = await job.getState();
    const allowedStates = ['waiting', 'delayed', 'failed', 'active'];

    if (!allowedStates.includes(state)) {
      throw new BadRequestException(
        `Cannot cancel job in state: ${state}. Allowed states: ${allowedStates.join(', ')}`,
      );
    }

    // For active jobs, we need to discard/fail them before removing
    if (state === 'active') {
      // In Bull (not BullMQ), active jobs need to be marked as failed first
      await job.discard();
      await job.moveToFailed({ message: 'Job cancelled by user' }, true);
    }

    const jobData = job.data;
    const createdAt = job.timestamp;
    const processedAt = job.processedOn;

    await job.remove();

    await this.jobLogsService.append({
      jobId: id,
      level: 'info',
      phase: 'cancelled',
      message: `Job cancelled by user (was in state: ${state})`,
    });

    await this.jobArchiveService.appendSnapshot({
      id: String(id),
      state: 'cancelled',
      data: jobData,
      createdAt,
      processedAt: processedAt ?? undefined,
      finishedAt: Date.now(),
      progress: 100,
      logs: await this.jobLogsService.getByJob(id),
    });

    return {
      id,
      canceled: true,
      previousState: state,
    };
  }

  private mapArchivedToListItem(s: ArchivedJobSnapshot) {
    return {
      id: s.id,
      data: s.data,
      progress: s.progress,
      state: s.state,
      returnValue: s.returnValue,
      failedReason: s.failedReason,
      createdAt: s.createdAt,
      processedAt: s.processedAt,
      finishedAt: s.finishedAt,
      archived: true,
    };
  }

  async getLogsByJob(jobId: string) {
    return this.jobLogsService.getByJob(jobId);
  }

  async queryLogs(query: LogsQueryDto) {
    const q = {
      level: query.level,
      jobId: query.jobId,
      search: query.search,
      from: query.from,
      to: query.to,
      cursor: query.cursor,
      limit: query.limit ?? 100,
    };
    const items = await this.jobLogsService.query(q);
    const total = await this.jobLogsService.queryCount({
      level: q.level,
      jobId: q.jobId,
      search: q.search,
      from: q.from,
      to: q.to,
    });
    const nextCursor =
      items.length > 0 ? items[items.length - 1].timestamp : null;
    return { items, total, nextCursor };
  }

  async setJobPriority(id: string, priority: number) {
    const job = await this.translationQueue.getJob(id);
    if (!job) {
      throw new NotFoundException(`Job not found: ${id}`);
    }
    const state = await job.getState();
    if (state !== 'waiting' && state !== 'delayed') {
      throw new BadRequestException(
        `Only waiting or delayed jobs can change priority (state: ${state})`,
      );
    }
    const json = job.toJSON() as unknown as {
      data: TranslationJobPayload;
      opts: Record<string, unknown>;
    };
    await job.remove();
    const newJob = await this.translationQueue.add(json.data, {
      ...json.opts,
      priority,
    } as any);
    return { id: newJob.id, state: await newJob.getState() };
  }

  async retryFromArchive(id: string) {
    await this.assertTokenQuotas();
    const snap = await this.jobArchiveService.getSnapshot(id);
    if (!snap) {
      throw new NotFoundException(`Job not found: ${id}`);
    }
    if (snap.state !== 'failed' && snap.state !== 'cancelled') {
      throw new BadRequestException(
        `Only failed or cancelled jobs can be retried (state: ${snap.state})`,
      );
    }
    const d = snap.data;
    return this.enqueue({
      mediaItemId: d.mediaItemId,
      mediaItemPath: d.mediaItemPath,
      sourceLanguage: d.sourceLanguage,
      targetLanguage: d.targetLanguage,
      sourceTrackIndex: d.sourceTrackIndex,
      triggeredBy: d.triggeredBy,
      forceBypassRules: d.forceBypassRules ?? false,
      provider: d.provider,
      targetConflictResolution: d.targetConflictResolution,
    });
  }

  async getQueueHealth(): Promise<{
    ok: boolean;
    jobCounts?: Record<string, number>;
    error?: string;
  }> {
    try {
      const jobCounts = await this.translationQueue.getJobCounts();
      return { ok: true, jobCounts: { ...jobCounts } };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'Queue unavailable',
      };
    }
  }

  private normalizeLanguage(input: string): string {
    const normalized = input.trim().toLowerCase();
    if (normalized.length === 0) {
      throw new BadRequestException('Language must not be empty');
    }

    return normalized;
  }

  private defaultPriority(dto: CreateJobDto): number {
    if (dto.priority != null) {
      return dto.priority;
    }
    if (dto.triggeredBy === 'batch') {
      return 8;
    }
    if (dto.triggeredBy === 'auto-scan') {
      return 10;
    }
    return 5;
  }

  private resolveProfileForPath(
    mediaPath: string,
    profiles: TranslationProfile[],
    defaults: {
      sourceLanguage: string;
      targetLanguage: string;
      provider?: 'openrouter' | 'deepseek';
    },
  ): {
    sourceLanguage: string;
    targetLanguage: string;
    provider?: 'openrouter' | 'deepseek';
  } {
    let best: TranslationProfile | null = null;
    for (const p of profiles) {
      if (mediaPath.startsWith(p.pathPrefix)) {
        if (!best || p.pathPrefix.length > best.pathPrefix.length) {
          best = p;
        }
      }
    }
    if (!best) {
      return defaults;
    }
    return {
      sourceLanguage: best.sourceLanguage,
      targetLanguage: best.targetLanguage,
      provider: best.provider ?? defaults.provider,
    };
  }

  private async assertTokenQuotas(): Promise<void> {
    const settings = await this.settingsService.getSettings();
    const { free, paid } = await this.tokenUsageService.getTodayTotals();
    if (
      settings.dailyTokenLimitFree != null &&
      free >= settings.dailyTokenLimitFree
    ) {
      throw new BadRequestException('Daily free-tier token limit reached');
    }
    if (
      settings.dailyTokenLimitPaid != null &&
      paid >= settings.dailyTokenLimitPaid
    ) {
      throw new BadRequestException('Daily paid-tier token limit reached');
    }
    if (settings.monthlyBudgetUsd != null) {
      const spent =
        await this.tokenUsageService.getMonthPaidCostEstimateUsd();
      if (spent >= settings.monthlyBudgetUsd) {
        throw new BadRequestException('Monthly DeepSeek budget limit reached');
      }
    }
  }

  private validateMediaPath(dto: CreateJobDto, item: MediaItem): void {
    if (dto.mediaItemPath && dto.mediaItemPath !== item.path) {
      throw new BadRequestException(
        'Provided media path does not match media item ID',
      );
    }
  }

  private validateSourceTrack(
    item: MediaItem,
    sourceTrackIndex: number,
  ): SubtitleTrack {
    const track = item.subtitleTracks.find(
      (candidate) => candidate.index === sourceTrackIndex,
    );
    if (!track) {
      throw new BadRequestException(
        `Source subtitle track index ${sourceTrackIndex} does not exist on media item`,
      );
    }

    return track;
  }
}
