import {
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { type SubsyncEnvConfig } from '../config/subsync.config';
import { SettingsService } from '../settings/settings.service';
import type { RuntimeSettings } from '../settings/settings.types';
import {
  type ExternalSubtitle,
  type MediaItem,
  type MediaType,
  type SubtitleTrack,
} from './media-item.entity';
import { canonicalizeLanguage } from '../common/language.utils';

interface CachedLibrary {
  expiresAt: number;
  items: MediaItem[];
}

interface FfprobeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  tags?: {
    language?: string;
    title?: string;
  };
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
}

export interface LibraryScanStatus {
  state: 'idle' | 'running' | 'completed' | 'failed';
  trigger: 'startup' | 'request' | 'cache-refresh' | 'manual' | null;
  startedAt: number | null;
  finishedAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  lastDurationMs: number | null;
  lastItemCount: number | null;
}

const MEDIA_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.avi',
  '.mov',
  '.ts',
  '.m2ts',
  '.wmv',
]);
const EXTERNAL_SUB_EXTENSIONS = new Set(['.srt', '.ass']);
const FFPROBE_TIMEOUT_MS = 15_000;
const DEFAULT_PROBE_CONCURRENCY = 10;

@Injectable()
export class LibraryService implements OnModuleInit {
  private readonly logger = new Logger(LibraryService.name);
  private cache: CachedLibrary | null = null;
  private scanPromise: Promise<MediaItem[]> | null = null;
  private scanStatus: LibraryScanStatus = {
    state: 'idle',
    trigger: null,
    startedAt: null,
    finishedAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastDurationMs: null,
    lastItemCount: null,
  };

  constructor(
    private readonly settingsService: SettingsService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.logger.log('Warming up library cache on startup...');
    this.getLibrary(false, 'startup').catch((err) =>
      this.logger.error(`Library warm-up failed: ${err}`),
    );
  }

  async getLibrary(
    forceRescan = false,
    trigger: LibraryScanStatus['trigger'] = 'request',
  ): Promise<MediaItem[]> {
    const settings = await this.settingsService.getSettings();
    const ttlMs = settings.scanCacheTtlMinutes * 60_000;
    const now = Date.now();

    if (!forceRescan && this.cache && this.cache.expiresAt > now) {
      return this.cache.items;
    }

    if (!forceRescan && this.cache) {
      if (!this.scanPromise) {
        this.logger.log('Library cache expired, refreshing in background');
        void this.startScan(settings, ttlMs, 'cache-refresh').catch((err) => {
          this.logger.error(`Background cache refresh failed: ${err}`);
        });
      }
      return this.cache.items;
    }

    if (this.scanPromise) {
      return this.scanPromise;
    }

    return this.startScan(settings, ttlMs, trigger);
  }

  async rescan(): Promise<MediaItem[]> {
    this.logger.log('Manual library rescan requested');
    return this.getLibrary(true, 'manual');
  }

  requestRescan(): { accepted: boolean; state: 'queued' | 'running' } {
    if (this.scanPromise) {
      return { accepted: false, state: 'running' };
    }
    void this.getLibrary(true, 'manual').catch((err) => {
      this.logger.error(`Background rescan failed: ${err}`);
    });
    return { accepted: true, state: 'queued' };
  }

  getScanStatus(): LibraryScanStatus {
    return { ...this.scanStatus };
  }

  getCachedItemCount(): number | null {
    if (this.cache) {
      return this.cache.items.length;
    }
    return this.scanStatus.lastItemCount;
  }

  async getById(id: string): Promise<MediaItem> {
    const items = await this.getLibrary(false);
    const match = items.find((item) => item.id === id);
    if (!match) {
      throw new NotFoundException(`Media item not found: ${id}`);
    }

    return match;
  }

  private startScan(
    settings: RuntimeSettings,
    ttlMs: number,
    trigger: LibraryScanStatus['trigger'],
  ): Promise<MediaItem[]> {
    const startedAt = Date.now();
    this.scanStatus = {
      ...this.scanStatus,
      state: 'running',
      trigger,
      startedAt,
      finishedAt: null,
      lastError: null,
    };

    this.scanPromise = this.performScan(settings)
      .then((items) => {
        const finishedAt = Date.now();
        this.cache = { items, expiresAt: finishedAt + ttlMs };
        this.scanStatus = {
          ...this.scanStatus,
          state: 'completed',
          finishedAt,
          lastSuccessAt: finishedAt,
          lastDurationMs: finishedAt - startedAt,
          lastItemCount: items.length,
          lastError: null,
        };
        return items;
      })
      .catch((error: unknown) => {
        const finishedAt = Date.now();
        const message = error instanceof Error ? error.message : String(error);
        this.scanStatus = {
          ...this.scanStatus,
          state: 'failed',
          finishedAt,
          lastDurationMs: finishedAt - startedAt,
          lastError: message,
        };
        throw error;
      })
      .finally(() => {
        this.scanPromise = null;
      });

    return this.scanPromise;
  }

  private async performScan(settings: RuntimeSettings): Promise<MediaItem[]> {
    const startTime = Date.now();
    const allFiles: string[] = [];
    const exclusions = settings.pathContainsExclusions;

    for (const mediaRoot of settings.mediaDirs) {
      this.logger.log(`Scanning directory: ${mediaRoot}`);
      try {
        const files = await this.walkDirectory(mediaRoot, exclusions);
        this.logger.log(`Found ${files.length} media files in ${mediaRoot}`);
        allFiles.push(...files);
      } catch (err) {
        this.logger.error(`Failed to scan directory ${mediaRoot}: ${err}`);
      }
    }

    const items = await this.buildAllMediaItems(allFiles, {
      fileTooLargeBytes: settings.fileTooLargeBytes,
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.log(
      `Library scan complete. ${items.length} items in ${elapsed}s`,
    );

    return items;
  }

  private async walkDirectory(
    root: string,
    exclusions: readonly string[],
  ): Promise<string[]> {
    const result: string[] = [];
    if (this.isExcludedPath(root, exclusions)) {
      return result;
    }

    let entries: Dirent[] = [];

    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      this.logger.warn(`Unable to read directory: ${root}`);
      return result;
    }

    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      if (this.isExcludedPath(fullPath, exclusions)) {
        continue;
      }
      if (entry.isDirectory()) {
        result.push(...(await this.walkDirectory(fullPath, exclusions)));
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (MEDIA_EXTENSIONS.has(extension)) {
        result.push(fullPath);
      }
    }

    return result;
  }

  private async buildAllMediaItems(
    files: string[],
    options: {
      fileTooLargeBytes?: number;
    },
  ): Promise<MediaItem[]> {
    const results: MediaItem[] = [];
    const directoryEntriesCache = new Map<string, Dirent[]>();
    const probeConcurrency = this.getProbeConcurrency();

    for (let i = 0; i < files.length; i += probeConcurrency) {
      const batch = files.slice(i, i + probeConcurrency);
      const settled = await Promise.allSettled(
        batch.map((file) =>
          this.buildMediaItem(file, {
            fileTooLargeBytes: options.fileTooLargeBytes,
            directoryEntriesCache,
          }),
        ),
      );
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          this.logger.error(`Failed to build media item: ${result.reason}`);
        }
      }
    }

    return results;
  }

  private async buildMediaItem(
    filePath: string,
    options: {
      fileTooLargeBytes?: number;
      directoryEntriesCache: Map<string, Dirent[]>;
    },
  ): Promise<MediaItem> {
    const stats = await fs.stat(filePath);
    const subtitleTracks =
      options.fileTooLargeBytes != null &&
      stats.size > options.fileTooLargeBytes
        ? []
        : await this.probeSubtitleTracks(filePath);
    const externalSubtitles = await this.findExternalSubtitles(
      filePath,
      options.directoryEntriesCache,
    );

    return {
      id: createHash('sha256').update(filePath).digest('hex'),
      path: filePath,
      name: path.parse(filePath).name,
      type: this.guessMediaType(path.parse(filePath).name),
      subtitleTracks,
      externalSubtitles,
      size: stats.size,
      lastModified: stats.mtime,
    };
  }

  private guessMediaType(name: string): MediaType {
    if (/S\d{2}E\d{2}/i.test(name)) {
      return 'episode';
    }

    if (/\b(19|20)\d{2}\b/.test(name)) {
      return 'movie';
    }

    return 'unknown';
  }

  private async probeSubtitleTracks(
    filePath: string,
  ): Promise<SubtitleTrack[]> {
    const raw = await this.execFfprobe(filePath);
    const parsed = JSON.parse(raw) as FfprobeOutput;

    return (parsed.streams ?? [])
      .filter((stream) => stream.codec_type === 'subtitle')
      .map((stream) => ({
        index: stream.index ?? -1,
        language: canonicalizeLanguage(stream.tags?.language ?? 'und'),
        title: stream.tags?.title,
        codec: stream.codec_name ?? 'unknown',
      }));
  }

  private execFfprobe(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };

      const child = spawn('ffprobe', [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_streams',
        filePath,
      ]);

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        settle(() =>
          reject(
            new Error(
              `ffprobe timed out after ${FFPROBE_TIMEOUT_MS}ms for ${filePath}`,
            ),
          ),
        );
      }, FFPROBE_TIMEOUT_MS);

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        settle(() =>
          reject(
            new Error(`ffprobe spawn error for ${filePath}: ${err.message}`),
          ),
        );
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          settle(() =>
            reject(
              new Error(
                `ffprobe failed for ${filePath}: ${stderr || `exit ${code}`}`,
              ),
            ),
          );
          return;
        }
        settle(() => resolve(stdout));
      });
    });
  }

  private async findExternalSubtitles(
    mediaPath: string,
    directoryEntriesCache: Map<string, Dirent[]>,
  ): Promise<ExternalSubtitle[]> {
    const directory = path.dirname(mediaPath);
    const stem = path.parse(mediaPath).name;

    let entries = directoryEntriesCache.get(directory);
    if (!entries) {
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        entries = [];
      }
      directoryEntriesCache.set(directory, entries);
    }

    return entries
      .filter((entry) => entry.isFile())
      .filter((entry) =>
        EXTERNAL_SUB_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
      )
      .filter((entry) => entry.name.startsWith(stem + '.'))
      .map((entry) => {
        const fullPath = path.join(directory, entry.name);
        const extension = path.extname(entry.name);
        const forced = entry.name.endsWith(`.forced${extension}`);
        let base = entry.name.slice(0, -extension.length);
        if (forced) {
          base = base.slice(0, -'.forced'.length);
        }
        const tokens = base.split('.');
        const tokensLang = [...tokens];
        while (
          tokensLang.length >= 2 &&
          /^\d+$/.test(tokensLang[tokensLang.length - 1] ?? '')
        ) {
          tokensLang.pop();
        }
        const language =
          tokensLang.length >= 2
            ? (tokensLang[tokensLang.length - 1] ?? 'und')
            : 'und';

        return {
          path: fullPath,
          language: canonicalizeLanguage(language),
          forced,
        };
      });
  }

  private isExcludedPath(
    targetPath: string,
    exclusions: readonly string[],
  ): boolean {
    if (exclusions.length === 0) {
      return false;
    }
    const normalized = targetPath.replaceAll('\\', '/').toLowerCase();
    return exclusions.some((entry) => {
      const token = entry.trim().toLowerCase();
      return token.length > 0 && normalized.includes(token);
    });
  }

  private getProbeConcurrency(): number {
    const config = this.configService.get<SubsyncEnvConfig>('subsync');
    const value = config?.probeConcurrency ?? DEFAULT_PROBE_CONCURRENCY;
    return Math.max(1, value);
  }
}
