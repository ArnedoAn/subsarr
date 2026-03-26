import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { type CreateJobDto } from './dto/create-job.dto';
import { type JobReturnValue, type TranslationJobPayload } from './jobs.types';
import { OutputService } from '../output/output.service';
import { type CreateBatchJobsDto } from './dto/create-batch-jobs.dto';
import { LibraryService } from '../library/library.service';
import { RulesService } from '../rules/rules.service';
import { JobLogsService } from './job-logs.service';
import {
  type MediaItem,
  type SubtitleTrack,
} from '../library/media-item.entity';

@Injectable()
export class JobsService {
  constructor(
    @InjectQueue('translation')
    private readonly translationQueue: Queue<TranslationJobPayload>,
    private readonly outputService: OutputService,
    private readonly libraryService: LibraryService,
    private readonly rulesService: RulesService,
    private readonly jobLogsService: JobLogsService,
  ) {}

  async enqueue(dto: CreateJobDto) {
    let item: MediaItem | null = null;
    let sourceLanguage = '';
    let targetLanguage = '';

    try {
      targetLanguage = this.normalizeLanguage(dto.targetLanguage);
      sourceLanguage = this.normalizeLanguage(dto.sourceLanguage);

      item = await this.libraryService.getById(dto.mediaItemId);
      this.validateMediaPath(dto, item);
      const sourceTrack = this.validateSourceTrack(item, dto.sourceTrackIndex);
      if (sourceTrack.language !== sourceLanguage) {
        throw new Error(
          `Source language ${sourceLanguage} does not match selected track language ${sourceTrack.language}`,
        );
      }
    } catch (error) {
      this.jobLogsService.append({
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
      throw error;
    }

    if (!item) {
      throw new Error('Media item was not resolved during precheck');
    }

    if (!dto.forceBypassRules) {
      const ruleResult = await this.rulesService.evaluate(item, {
        sourceLanguage,
        targetLanguage,
      });

      if (ruleResult.skip) {
        this.jobLogsService.append({
          level: 'warn',
          phase: 'precheck',
          message: `Job blocked by rules: ${ruleResult.reason ?? 'Blocked by rule'}`,
          details: {
            mediaItemId: dto.mediaItemId,
          },
        });
        throw new Error(
          `Job blocked by rules: ${ruleResult.reason ?? 'Blocked by rule'}`,
        );
      }
    }

    const outputPath = this.outputService.buildSubtitlePath(
      item.path,
      targetLanguage,
    );
    const waiting = await this.translationQueue.getWaiting();
    const active = await this.translationQueue.getActive();

    const duplicate = [...waiting, ...active].find((job) => {
      const payload = job.data;
      if (!payload.mediaItemPath) {
        return false;
      }

      return (
        this.outputService.buildSubtitlePath(
          payload.mediaItemPath,
          payload.targetLanguage,
        ) === outputPath
      );
    });

    if (duplicate) {
      this.jobLogsService.append({
        level: 'warn',
        phase: 'precheck',
        message: `Duplicate output path conflict: ${outputPath}`,
        details: {
          mediaItemId: dto.mediaItemId,
        },
      });
      throw new Error(
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
        triggeredBy: dto.triggeredBy,
        forceBypassRules: dto.forceBypassRules ?? false,
        provider: dto.provider,
      },
      {
        removeOnComplete: 200,
        removeOnFail: 200,
      },
    );

    this.jobLogsService.append({
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
        });

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

  async list() {
    const jobs = await this.translationQueue.getJobs([
      'waiting',
      'active',
      'completed',
      'failed',
    ]);
    return Promise.all(
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
      })),
    );
  }

  async getById(id: string) {
    const job = await this.translationQueue.getJob(id);
    if (!job) {
      throw new NotFoundException(`Job not found: ${id}`);
    }

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
      logs: this.jobLogsService.getByJob(id),
    };
  }

  async cancel(id: string) {
    const job = await this.translationQueue.getJob(id);
    if (!job) {
      throw new NotFoundException(`Job not found: ${id}`);
    }

    const state = await job.getState();
    const allowedStates = ['waiting', 'delayed', 'failed', 'active'];

    if (!allowedStates.includes(state)) {
      throw new Error(
        `Cannot cancel job in state: ${state}. Allowed states: ${allowedStates.join(', ')}`,
      );
    }

    // For active jobs, we need to discard/fail them before removing
    if (state === 'active') {
      // In Bull (not BullMQ), active jobs need to be marked as failed first
      await job.discard();
      await job.moveToFailed({ message: 'Job cancelled by user' }, true);
    }

    await job.remove();

    this.jobLogsService.append({
      jobId: id,
      level: 'info',
      phase: 'cancelled',
      message: `Job cancelled by user (was in state: ${state})`,
    });

    return {
      id,
      canceled: true,
      previousState: state,
    };
  }

  getLogsByJob(jobId: string) {
    return this.jobLogsService.getByJob(jobId);
  }

  queryLogs(query: {
    level?: 'info' | 'warn' | 'error';
    jobId?: string;
    search?: string;
    from?: string;
    to?: string;
  }) {
    return this.jobLogsService.query(query);
  }

  private normalizeLanguage(input: string): string {
    const normalized = input.trim().toLowerCase();
    if (normalized.length === 0) {
      throw new Error('Language must not be empty');
    }

    return normalized;
  }

  private validateMediaPath(dto: CreateJobDto, item: MediaItem): void {
    if (dto.mediaItemPath && dto.mediaItemPath !== item.path) {
      throw new Error('Provided media path does not match media item ID');
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
      throw new Error(
        `Source subtitle track index ${sourceTrackIndex} does not exist on media item`,
      );
    }

    return track;
  }
}
