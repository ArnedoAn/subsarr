import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Job, Queue } from 'bull';
import { randomUUID, createHash } from 'node:crypto';
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
import { canonicalizeLanguage } from '../common/language.utils';
import { SettingsService } from '../settings/settings.service';
import { TokenUsageService } from '../settings/token-usage.service';
import { ProfilesService } from '../profiles/profiles.service';
import type { TranslationProfile } from '../profiles/profile.types';
import type { LogsQueryDto } from './dto/logs-query.dto';
import { JobCancellationService } from './job-cancellation.service';
import { JobsEventsService } from './jobs-events.service';
import { encodeLogCursor } from './job-logs.service';
import type { JobsQueryDto } from './dto/jobs-query.dto';

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
    private readonly cancellation: JobCancellationService,
    private readonly events: JobsEventsService,
  ) {}

  onModuleInit() {
    this.translationQueue.on('stalled', (job) => {
      // Bull may requeue a stalled lock while the old process is still alive.
      // Signal both processors; never remove/fail work that can still write output.
      void this.cancellation
        .request(String(job.id), 'stalled')
        .catch((error: unknown) => {
          this.logger.error(
            `Cannot signal stalled job ${job.id}: ${String(error)}`,
          );
        });
    });
  }

  async enqueue(dto: CreateJobDto): Promise<
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
          sourceLanguage: sourceLanguage || settings.sourceLanguage,
          targetLanguage: targetLanguage || settings.targetLanguage,
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

    await this.settingsService.assertTranslationBudget({
      provider,
      automatic: dto.triggeredBy === 'auto-scan',
      allowBudgetOverride: dto.allowBudgetOverride,
    });
    const outputPath = this.outputService.buildSubtitlePath(
      item.path,
      targetLanguage,
      false,
      outputExtension,
      dto.targetConflictResolution === 'alternate' ? 'alternate' : 'default',
    );
    // All subtitle formats for the same target share one claim.
    const outputKey = `output-${createHash('sha256').update(outputPath.slice(0, -outputExtension.length)).digest('hex')}`;
    let jobId: string = randomUUID();
    const client = this.translationQueue.client;
    const lockKey = this.translationQueue.toKey(`enqueue:${outputKey}`);
    const claimKey = this.translationQueue.toKey(`claim:${outputKey}`);
    const lockToken = randomUUID();
    if ((await client.set(lockKey, lockToken, 'PX', 30000, 'NX')) !== 'OK') {
      throw new ConflictException('This output is already being queued');
    }
    let job: Job<TranslationJobPayload>;
    try {
      const previousId = await client.get(claimKey);
      const previous = previousId
        ? await this.translationQueue.getJob(previousId)
        : null;
      if (previous) {
        const state = await previous.getState();
        if (!['completed', 'failed'].includes(state)) {
          throw new ConflictException(
            `A job is already processing this output path: ${outputPath}`,
          );
        }
      }
      if (
        previousId &&
        !previous &&
        !(await this.jobArchiveService.getSnapshot(previousId))
      ) {
        // Reuse a not-yet-added reservation. Even if an enqueue lease expired,
        // Bull's atomic custom jobId insertion lets only one processor own it.
        jobId = previousId;
      }
      // A pruned cancelled attempt can resemble an interrupted reservation.
      // Clear only under the enqueue lease, before Bull atomically inserts the selected id.
      await this.cancellation.clear(jobId);
      // Persist the claim before add so a crashed enqueue can safely resume it.
      await client.set(claimKey, jobId);
      job = await this.translationQueue.add(
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
          automatic: dto.triggeredBy === 'auto-scan',
          allowBudgetOverride: dto.allowBudgetOverride,
        },
        {
          jobId,
          removeOnComplete: 200,
          removeOnFail: 200,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10000 },
          priority: this.defaultPriority(dto),
        },
      );
    } finally {
      await client.eval(
        "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",
        1,
        lockKey,
        lockToken,
      );
    }

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
    if (!dto.items.length || dto.items.length > 500)
      throw new BadRequestException('Batch must contain 1 to 500 items');
    await this.settingsService.assertTranslationBudget({
      provider: dto.provider,
      automatic: dto.triggeredBy === 'auto-scan',
      allowBudgetOverride: dto.allowBudgetOverride,
    });

    const results: Array<{
      mediaItemId: string;
      id?: string | number;
      error?: string;
      index: number;
      status: 'queued' | 'conflict' | 'rejected';
      errorCode?: number;
    }> = [];

    for (const [index, item] of dto.items.entries()) {
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
          allowBudgetOverride: dto.allowBudgetOverride,
        });

        if ('batchGroupId' in job) {
          throw new Error('Unexpected multi-target batch item');
        }

        results.push({
          mediaItemId: item.mediaItemId,
          index,
          status: 'queued',
          id: job.id,
        });
      } catch (error) {
        results.push({
          mediaItemId: item.mediaItemId,
          index,
          status: error instanceof ConflictException ? 'conflict' : 'rejected',
          errorCode:
            error instanceof ConflictException
              ? 409
              : error instanceof BadRequestException
                ? 400
                : error instanceof NotFoundException
                  ? 404
                  : 500,
          error: error instanceof Error ? error.message : 'Failed to enqueue',
        });
      }
    }

    return results;
  }

  async previewBatch(dto: BatchPreviewDto) {
    if (!dto.items.length || dto.items.length > 500)
      throw new BadRequestException('Batch must contain 1 to 500 items');
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
      alreadyTranslated?: boolean;
      name?: string;
      path?: string;
    }> = [];

    for (const { mediaItemId } of dto.items) {
      try {
        const item = await this.libraryService.getById(mediaItemId);
        const alreadyTranslated = [
          ...item.subtitleTracks,
          ...item.externalSubtitles,
        ].some(
          (subtitle) =>
            this.normalizeLanguage(subtitle.language) === targetLanguage,
        );
        const track = item.subtitleTracks.find(
          (t) => t.language === sourceLanguage,
        );
        if (!track) {
          results.push({
            mediaItemId,
            alreadyTranslated,
            name: item.name,
            path: item.path,
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
              alreadyTranslated,
              name: item.name,
              path: item.path,
              status: 'rule_blocked',
              sourceTrackIndex: track.index,
              reason: ruleResult.reason ?? 'Blocked by rules',
            });
            continue;
          }
        }

        results.push({
          mediaItemId,
          alreadyTranslated,
          name: item.name,
          path: item.path,
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

  async list(query: JobsQueryDto = {}) {
    const jobs = await this.translationQueue.getJobs([
      'waiting',
      'active',
      'delayed',
      'paused',
      'completed',
      'failed',
    ]);
    const fromRedis = await Promise.all(
      jobs.map(async (job) => ({
        id: job.id,
        data: job.data,
        progress: Number(job.progress()),
        state:
          (await job.getState()) === 'active' &&
          (await this.cancellation.isRequested(String(job.id)))
            ? 'cancelling'
            : await job.getState(),
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

    const snapshots = new Map(
      archived.map((snapshot) => [snapshot.id, snapshot]),
    );
    const merged = [
      ...fromRedis.map((row) => {
        const snapshot = snapshots.get(String(row.id));
        return snapshot?.state === 'cancelled' && row.state !== 'active'
          ? this.mapArchivedToListItem(snapshot)
          : row;
      }),
      ...fromArchive,
    ];
    const filtered = merged.filter(
      (row) =>
        (!query.mediaItemId || row.data.mediaItemId === query.mediaItemId) &&
        (!query.state || query.state.split(',').includes(row.state)) &&
        (!query.q ||
          `${row.id} ${row.data.mediaItemPath} ${row.data.targetLanguage}`
            .toLowerCase()
            .includes(query.q.toLowerCase())),
    );
    filtered.sort(
      (a, b) =>
        (b.finishedAt ?? b.processedAt ?? b.createdAt) -
          (a.finishedAt ?? a.processedAt ?? a.createdAt) ||
        String(a.id).localeCompare(String(b.id)),
    );
    const offset = query.offset ?? 0;
    const limit = Math.min(query.limit ?? 50, 200);
    return {
      jobs: filtered.slice(offset, offset + limit),
      total: filtered.length,
      offset,
      limit,
    };
  }

  async getById(id: string) {
    const job = await this.translationQueue.getJob(id);
    if (job) {
      return {
        id: job.id,
        data: job.data,
        progress: Number(job.progress()),
        state:
          (await job.getState()) === 'active' &&
          (await this.cancellation.isRequested(id))
            ? 'cancelling'
            : (await this.jobArchiveService.getSnapshot(id))?.state ===
                'cancelled'
              ? 'cancelled'
              : await job.getState(),
        returnValue: job.returnvalue as JobReturnValue | undefined,
        failedReason: job.failedReason,
        createdAt: job.timestamp,
        processedAt: job.processedOn,
        finishedAt: job.finishedOn,
        logs: await this.getLogsByJob(id),
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
        logs: await this.getLogsByJob(id),
        archived: true,
      };
    }

    throw new NotFoundException(`Job not found: ${id}`);
  }

  async cancel(id: string) {
    const job = await this.translationQueue.getJob(id);
    if (!job) throw new NotFoundException(`Job not found: ${id}`);
    const state = await job.getState();
    if (!['waiting', 'paused', 'delayed', 'active'].includes(state))
      throw new BadRequestException(`Cannot cancel job in state: ${state}`);
    await this.cancellation.request(id);
    if (state !== 'active') {
      try {
        await job.remove();
        await this.jobArchiveService.appendSnapshot({
          id,
          state: 'cancelled',
          data: job.data,
          createdAt: job.timestamp,
          processedAt: job.processedOn,
          finishedAt: Date.now(),
          progress: 100,
          logs: [],
        });
        await this.jobLogsService.append({
          jobId: id,
          level: 'info',
          phase: 'cancelled',
          message: 'Job cancelled before processing',
        });
        this.events.publish(id, {
          phase: 'cancelled',
          progressPercent: 100,
          message: 'Job cancelled',
          timestamp: new Date().toISOString(),
        });
        return { id, canceled: true, state: 'cancelled', previousState: state };
      } catch (error) {
        // remove() is atomic and refuses locked work. A waiting -> active race must be stopped cooperatively.
        if ((await job.getState()) !== 'active') throw error;
      }
    }
    this.events.publish(id, {
      phase: 'cancelling',
      progressPercent: Number(job.progress()),
      message: 'Waiting for processor to stop',
      timestamp: new Date().toISOString(),
    });
    return { id, canceled: false, state: 'cancelling', previousState: state };
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
    const canonical = await this.jobLogsService.getByJob(jobId);
    const snapshot = await this.jobArchiveService.getSnapshot(jobId);
    const entries = new Map(
      (snapshot?.logs ?? []).map((entry) => [entry.id, entry]),
    );
    for (const entry of canonical) entries.set(entry.id, entry);
    return [...entries.values()]
      .sort(
        (a, b) =>
          a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id),
      )
      .slice(-500);
  }

  async queryLogs(query: LogsQueryDto) {
    const q = {
      level: query.level,
      jobId: query.jobId,
      search: query.search,
      q: query.q,
      offset: query.offset,
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
      q: q.q,
      from: q.from,
      to: q.to,
    });
    const nextCursor =
      items.length === q.limit
        ? encodeLogCursor(items[items.length - 1])
        : null;
    return { logs: items, total, nextCursor };
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
    // Bull 4.16 has no changePriority API. Update its documented Redis layout atomically,
    // using the same insertion algorithm as addJobWithPriority.lua (never remove/re-add a job).
    const client = this.translationQueue.client;
    const result = await client.eval(
      `
      if redis.call('LPOS',KEYS[2],ARGV[1]) then return 0 end
      local waiting = redis.call('LREM',KEYS[3],0,ARGV[1])
      local paused = redis.call('LREM',KEYS[4],0,ARGV[1])
      if waiting == 0 and paused == 0 and not redis.call('ZSCORE',KEYS[5],ARGV[1]) then return 0 end
      local opts = cjson.decode(redis.call('HGET',KEYS[1],'opts') or '{}')
      opts.priority = tonumber(ARGV[2]); redis.call('HSET',KEYS[1],'opts',cjson.encode(opts))
      redis.call('HSET',KEYS[1],'priority',ARGV[2])
      if waiting > 0 or paused > 0 then
        local target = KEYS[3]; if paused > 0 then target = KEYS[4] end
        redis.call('ZADD',KEYS[6],ARGV[2],ARGV[1])
        local count = redis.call('ZCOUNT',KEYS[6],0,ARGV[2])
        local before = redis.call('LINDEX',target,redis.call('LLEN',target)-(count-1))
        if before then redis.call('LINSERT',target,'BEFORE',before,ARGV[1]) else redis.call('RPUSH',target,ARGV[1]) end
      end
      return 1`,
      6,
      this.translationQueue.toKey(id),
      this.translationQueue.toKey('active'),
      this.translationQueue.toKey('wait'),
      this.translationQueue.toKey('paused'),
      this.translationQueue.toKey('delayed'),
      this.translationQueue.toKey('priority'),
      id,
      priority,
    );
    if (result !== 1)
      throw new ConflictException(
        'Job started before its priority could be changed',
      );
    return { id, state: await job.getState(), priority };
  }

  async retryFromArchive(
    id: string,
    options: { allowBudgetOverride?: boolean } = {},
  ) {
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
      triggeredBy: 'manual',
      forceBypassRules: d.forceBypassRules ?? false,
      provider: d.provider,
      targetConflictResolution: d.targetConflictResolution,
      allowBudgetOverride: options.allowBudgetOverride,
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
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException('Language must not be empty');
    }

    return canonicalizeLanguage(trimmed);
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
    // Monthly policy is enforced centrally with automatic/manual override semantics.
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
