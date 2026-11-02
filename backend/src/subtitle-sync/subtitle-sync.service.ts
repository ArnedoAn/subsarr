import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SubsyncEnvConfig } from '../config/subsync.config';
import {
  assertWithinMediaRoots,
  validateLanguageCode,
} from '../common/path-safety';
import { ExtractionService } from '../extraction/extraction.service';
import { JellyfinService } from '../integrations/jellyfin.service';
import { LibraryService } from '../library/library.service';
import type { MediaItem } from '../library/media-item.entity';
import { OutputService } from '../output/output.service';
import {
  decodeSubtitle,
  parseDocument,
  SUPPORTED_SUBTITLE_FORMATS,
  type DocumentExtension,
} from '../translation/subtitle-document';
import { runFfsubsync } from './ffsubsync-runner';
import type { StartSubtitleSyncDto } from './subtitle-sync.dto';
import type {
  SubtitleSyncConflictResolution,
  SubtitleSyncReferenceUsed,
  SubtitleSyncTask,
} from './subtitle-sync.types';

export const SUBTITLE_SYNC_LIMITS = {
  inputBytes: 8 * 1024 * 1024,
  pending: 20,
  retained: 200,
  retentionMs: 60 * 60 * 1000,
  timeoutMs: 20 * 60 * 1000,
} as const;

/** Embedded codecs ffmpeg can convert to SRT for a subtitle-to-subtitle reference. */
const TEXT_SUBTITLE_CODECS = new Set([
  'subrip',
  'srt',
  'ass',
  'ssa',
  'webvtt',
  'mov_text',
  'text',
]);
/** Partial tracks only cover foreign dialogue or signs and make poor timing references. */
const PARTIAL_TRACK_TITLE = /forced|signs|songs|commentary/i;

export interface SubtitleSyncUpload {
  originalname: string;
  buffer: Buffer;
}

interface SyncJob {
  task: SubtitleSyncTask;
  mediaPath: string;
  content?: string;
  extension: DocumentExtension;
  referenceTrackIndex: number | null;
  conflict: SubtitleSyncConflictResolution;
  controller: AbortController;
}

@Injectable()
export class SubtitleSyncService implements OnModuleDestroy {
  private readonly logger = new Logger(SubtitleSyncService.name);
  private readonly jobs = new Map<string, SyncJob>();
  private readonly pending: SyncJob[] = [];
  private running = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly libraryService: LibraryService,
    private readonly extractionService: ExtractionService,
    private readonly outputService: OutputService,
    private readonly jellyfinService: JellyfinService,
  ) {}

  onModuleDestroy(): void {
    for (const job of this.jobs.values())
      job.controller.abort(new Error('Server shutting down'));
  }

  async start(
    dto: StartSubtitleSyncDto,
    upload?: SubtitleSyncUpload,
  ): Promise<SubtitleSyncTask> {
    if (!upload === !dto.sidecarPath)
      throw new BadRequestException(
        'Provide either an uploaded subtitle file or an existing sidecar path',
      );
    if (this.pending.length >= SUBTITLE_SYNC_LIMITS.pending)
      throw new ServiceUnavailableException(
        'Too many subtitle syncs are waiting; try again later',
      );
    let item: MediaItem;
    try {
      item = await this.libraryService.getById(dto.mediaItemId);
    } catch {
      throw new NotFoundException('Media item not found');
    }
    if (item.probeStatus !== 'ok')
      throw new ConflictException(
        'This media file has not been probed successfully yet',
      );
    const config = this.configService.getOrThrow<SubsyncEnvConfig>('subsync');
    const mediaPath = await assertWithinMediaRoots(item.path, config.mediaDirs);

    const sidecar = dto.sidecarPath
      ? item.externalSubtitles.find((entry) => entry.path === dto.sidecarPath)
      : undefined;
    if (dto.sidecarPath && !sidecar)
      throw new BadRequestException(
        'Choose a subtitle sidecar listed for this media item',
      );
    const inputName = upload
      ? path.basename(upload.originalname)
      : path.basename(sidecar!.path);
    const extension = path.extname(inputName).slice(1).toLowerCase();
    if (!(SUPPORTED_SUBTITLE_FORMATS as readonly string[]).includes(extension))
      throw new BadRequestException(
        `Unsupported subtitle format; use ${SUPPORTED_SUBTITLE_FORMATS.join(', ')}`,
      );
    const raw = upload
      ? upload.buffer
      : await this.readSidecar(sidecar!.path, config.mediaDirs);
    if (raw.length > SUBTITLE_SYNC_LIMITS.inputBytes)
      throw new BadRequestException('Subtitle file exceeds 8 MB');
    let content: string;
    try {
      content = decodeSubtitle(raw);
      if (parseDocument(content, extension as DocumentExtension).cueCount === 0)
        throw new Error('Subtitle contains no cues');
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Subtitle cannot be parsed',
      );
    }

    const language = validateLanguageCode(
      dto.language ?? sidecar?.language ?? '',
    );
    const forced = dto.forced ?? sidecar?.forced ?? false;
    const conflict = dto.conflict ?? 'fail';
    const destination = this.outputService.buildSubtitlePath(
      mediaPath,
      language,
      forced,
      extension as DocumentExtension,
      conflict === 'alternate' ? 'alternate' : 'default',
    );
    if (conflict !== 'replace' && (await this.exists(destination)))
      throw new ConflictException(
        `${path.basename(destination)} already exists; choose replace or alternate`,
      );

    const referenceTrackIndex = this.chooseReferenceTrack(item, dto);
    const now = new Date().toISOString();
    const job: SyncJob = {
      task: {
        id: randomUUID(),
        mediaItemId: item.id,
        inputName,
        language,
        forced,
        allowSplits: dto.allowSplits ?? false,
        maxOffsetSeconds: dto.maxOffsetSeconds ?? 60,
        state: 'queued',
        reference: null,
        progressPercent: null,
        message: 'Waiting for the sync engine',
        createdAt: now,
        startedAt: null,
        finishedAt: null,
        result: null,
        error: null,
      },
      mediaPath,
      content,
      extension: extension as DocumentExtension,
      referenceTrackIndex,
      conflict,
      controller: new AbortController(),
    };
    this.prune();
    this.jobs.set(job.task.id, job);
    this.pending.push(job);
    void this.drain();
    return { ...job.task };
  }

  get(id: string): SubtitleSyncTask {
    const job = this.jobs.get(id);
    if (!job) throw new NotFoundException('Subtitle sync task not found');
    return { ...job.task };
  }

  list(mediaItemId?: string): SubtitleSyncTask[] {
    return [...this.jobs.values()]
      .filter((job) => !mediaItemId || job.task.mediaItemId === mediaItemId)
      .map((job) => ({ ...job.task }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  cancel(id: string): SubtitleSyncTask {
    const job = this.jobs.get(id);
    if (!job) throw new NotFoundException('Subtitle sync task not found');
    if (job.task.state === 'queued') {
      this.pending.splice(this.pending.indexOf(job), 1);
      this.finish(job, 'cancelled', 'Cancelled before starting');
    } else if (job.task.state === 'running') {
      job.task.message = 'Cancelling';
      job.controller.abort(new Error('Subtitle sync cancelled'));
    }
    return { ...job.task };
  }

  /** `null` selects the audio track; otherwise an embedded text subtitle stream index. */
  private chooseReferenceTrack(
    item: MediaItem,
    dto: StartSubtitleSyncDto,
  ): number | null {
    const mode = dto.reference ?? 'auto';
    if (mode === 'audio') return null;
    const textTracks = item.subtitleTracks.filter((track) =>
      TEXT_SUBTITLE_CODECS.has(track.codec.trim().toLowerCase()),
    );
    if (mode === 'track') {
      const track = textTracks.find(
        (entry) => entry.index === dto.referenceTrackIndex,
      );
      if (!track)
        throw new BadRequestException(
          'Reference track must be an embedded text subtitle of this media item',
        );
      return track.index;
    }
    return (
      textTracks.find((track) => !PARTIAL_TRACK_TITLE.test(track.title ?? ''))
        ?.index ?? null
    );
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let job = this.pending.shift(); job; job = this.pending.shift())
        await this.execute(job);
    } finally {
      this.running = false;
    }
  }

  private async execute(job: SyncJob): Promise<void> {
    const { task, controller } = job;
    const signal = controller.signal;
    const config = this.configService.getOrThrow<SubsyncEnvConfig>('subsync');
    task.state = 'running';
    task.startedAt = new Date().toISOString();
    let workDir: string | undefined;
    let referencePath: string | undefined;
    try {
      signal.throwIfAborted();
      workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subsarr-sync-'));
      const inputPath = path.join(workDir, `input.${job.extension}`);
      const outputPath = path.join(workDir, `output.${job.extension}`);
      await fs.writeFile(inputPath, job.content!, 'utf8');
      job.content = undefined;

      let reference: SubtitleSyncReferenceUsed = { kind: 'audio' };
      if (job.referenceTrackIndex !== null) {
        task.message = 'Extracting embedded reference subtitle';
        const track = (
          await this.libraryService.getById(task.mediaItemId)
        ).subtitleTracks.find(
          (entry) => entry.index === job.referenceTrackIndex,
        );
        referencePath = (
          await this.extractionService.extractSubtitleTrack(
            job.mediaPath,
            job.referenceTrackIndex,
            'srt',
            { signal },
          )
        ).tempFilePath;
        reference = {
          kind: 'track',
          trackIndex: job.referenceTrackIndex,
          language: track?.language ?? 'und',
        };
      }
      task.reference = reference;
      task.message =
        reference.kind === 'audio'
          ? 'Detecting speech in the audio track'
          : 'Aligning against the embedded subtitle';
      const outcome = await runFfsubsync({
        python: config.syncPython,
        reference: referencePath ?? job.mediaPath,
        referenceIsAudio: reference.kind === 'audio',
        input: inputPath,
        output: outputPath,
        allowSplits: task.allowSplits,
        maxOffsetSeconds: task.maxOffsetSeconds,
        timeoutMs: SUBTITLE_SYNC_LIMITS.timeoutMs,
        signal,
        onProgress: (fraction) => {
          task.progressPercent = Math.round(fraction * 100);
        },
      });
      if (!outcome.synced)
        throw new Error(
          'No trustworthy alignment was found; the subtitle may belong to different content or need a larger max offset',
        );
      const synced = await fs.readFile(outputPath, 'utf8');
      const document = parseDocument(synced, job.extension);
      if (document.cueCount === 0)
        throw new Error('Synchronized subtitle contains no cues');
      task.message = 'Writing synchronized subtitle';
      const written = await this.outputService.writeSubtitle(
        job.mediaPath,
        task.language,
        synced,
        task.forced,
        job.extension,
        job.conflict === 'alternate' ? 'alternate' : 'default',
        {
          signal,
          overwrite: job.conflict === 'replace',
          itemId: task.mediaItemId,
        },
      );
      task.result = {
        outputPath: written,
        offsetSeconds: outcome.offsetSeconds,
        framerateScaleFactor: outcome.framerateScaleFactor,
        cueCount: document.cueCount,
      };
      task.progressPercent = 100;
      this.finish(job, 'completed', 'Subtitle synchronized');
      void this.jellyfinService.refreshLibraryAfterSubtitle();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (signal.aborted) this.finish(job, 'cancelled', message);
      else {
        this.logger.warn(`Subtitle sync ${task.id} failed: ${message}`);
        task.error = message;
        this.finish(job, 'failed', message);
      }
    } finally {
      job.content = undefined;
      if (referencePath) await fs.rm(referencePath, { force: true });
      if (workDir) await fs.rm(workDir, { recursive: true, force: true });
    }
  }

  private finish(
    job: SyncJob,
    state: 'completed' | 'failed' | 'cancelled',
    message: string,
  ): void {
    job.task.state = state;
    job.task.message = message;
    job.task.finishedAt = new Date().toISOString();
  }

  private prune(): void {
    const cutoff = Date.now() - SUBTITLE_SYNC_LIMITS.retentionMs;
    const finished = [...this.jobs.values()]
      .filter((job) => job.task.finishedAt)
      .sort((a, b) => a.task.finishedAt!.localeCompare(b.task.finishedAt!));
    let excess = this.jobs.size + 1 - SUBTITLE_SYNC_LIMITS.retained;
    for (const job of finished) {
      if (excess <= 0 && Date.parse(job.task.finishedAt!) >= cutoff) break;
      this.jobs.delete(job.task.id);
      excess--;
    }
    if (this.jobs.size >= SUBTITLE_SYNC_LIMITS.retained)
      throw new ServiceUnavailableException(
        'Too many subtitle syncs are in progress',
      );
  }

  private async readSidecar(
    sidecarPath: string,
    mediaDirs: string[],
  ): Promise<Buffer> {
    const safe = await assertWithinMediaRoots(sidecarPath, mediaDirs);
    const stats = await fs.stat(safe);
    if (!stats.isFile()) throw new BadRequestException('Sidecar is not a file');
    if (stats.size > SUBTITLE_SYNC_LIMITS.inputBytes)
      throw new BadRequestException('Subtitle file exceeds 8 MB');
    return fs.readFile(safe);
  }

  private async exists(candidate: string): Promise<boolean> {
    try {
      await fs.lstat(candidate);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}
