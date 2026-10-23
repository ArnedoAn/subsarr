import {
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
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
  type ProbeStatus,
  type SubtitleTrack,
} from './media-item.entity';
import { ProbeCacheEntity } from '../database/entities/probe-cache.entity';
import { canonicalizeLanguage } from '../common/language.utils';
import { assertWithinMediaRoots } from '../common/path-safety';
import { MediaInventoryEntity } from '../database/entities/media-inventory.entity';
import {
  deriveMetadata,
  inventoryQuery,
  inventoryRow,
  readInventoryItem,
} from './inventory';
import { type LibraryQueryDto } from './dto/library-query.dto';
import { escapeLike } from '../common/search.utils';
import type { LibraryScanMetrics, LibraryScanStatus } from '../contracts/api';
export type { LibraryScanMetrics, LibraryScanStatus } from '../contracts/api';

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

const MEDIA_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.avi',
  '.mov',
  '.ts',
  '.m2ts',
  '.wmv',
]);
const EXTERNAL_SUB_EXTENSIONS: Record<string, true> = {
  '.srt': true,
  '.ass': true,
  '.ssa': true,
  '.vtt': true,
};
const FFPROBE_TIMEOUT_MS = 15_000;
const DEFAULT_PROBE_CONCURRENCY = 10;
const PROBE_FAILURE_RETRY_MS = 5 * 60_000;
const STDERR_LIMIT_BYTES = 4096;

class ProbeTimeoutError extends Error {
  override name = 'ProbeTimeoutError';
}

@Injectable()
export class LibraryService implements OnModuleInit {
  private readonly logger = new Logger(LibraryService.name);
  private cache: CachedLibrary | null = null;
  private scanPromise: Promise<MediaItem[]> | null = null;
  private probeDurations: number[] = [];
  private scanProbeCache: Map<string, ProbeCacheEntity> | null = null;
  private pendingProbeWrites: ProbeCacheEntity[] | null = null;
  private probeWritePromise: Promise<void> | null = null;
  private readonly failedSidecarDirectories = new Set<string>();
  private scanStatus: LibraryScanStatus = {
    state: 'idle',
    trigger: null,
    startedAt: null,
    finishedAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastDurationMs: null,
    lastItemCount: null,
    metrics: null,
  };

  constructor(
    @InjectRepository(ProbeCacheEntity)
    private readonly probeCacheRepo: Repository<ProbeCacheEntity>,
    private readonly settingsService: SettingsService,
    private readonly configService: ConfigService,
    @Optional()
    @InjectRepository(MediaInventoryEntity)
    private readonly inventoryRepo?: Repository<MediaInventoryEntity>,
  ) {}

  async onModuleInit() {
    await this.restoreLibraryCacheFromDisk();
    this.logger.log('Warming up library cache on startup...');
    this.getLibrary(false, 'startup').catch((err) =>
      this.logger.error(`Library warm-up failed: ${err}`),
    );
  }

  private getLibraryCachePath(): string {
    const config = this.configService.get<SubsyncEnvConfig>('subsync');
    const dataDir = config?.dataDir ?? '/data';
    return path.join(dataDir, 'library-cache.json');
  }

  private async restoreLibraryCacheFromDisk(): Promise<void> {
    if (this.inventoryRepo) {
      const rows = await this.inventoryRepo.find();
      if (rows.length) {
        this.cache = { expiresAt: 0, items: rows.map(readInventoryItem) };
        this.scanStatus.lastItemCount = rows.length;
        return;
      }
    }
    const cachePath = this.getLibraryCachePath();
    try {
      const raw = await fs.readFile(cachePath, 'utf8');
      const parsed = JSON.parse(raw) as CachedLibrary;
      if (
        typeof parsed.expiresAt === 'number' &&
        Array.isArray(parsed.items) &&
        parsed.items.every(
          (item) =>
            item != null &&
            ['ok', 'failed', 'skipped'].includes(item.probeStatus),
        )
      ) {
        parsed.items = parsed.items.map((item) => ({
          ...item,
          lastModified: new Date(item.lastModified),
        }));
        await this.persistInventory(parsed.items);
        this.cache = parsed;
        this.logger.log(
          `Restored ${parsed.items.length} library items from disk cache`,
        );
      } else {
        this.logger.log('Disk library cache expired or incompatible, ignoring');
      }
    } catch {
      // No cache file or corrupt — proceed with empty cache
    }
  }

  private async persistLibraryCacheToDisk(cache: CachedLibrary): Promise<void> {
    const cachePath = this.getLibraryCachePath();
    const startedAt = Date.now();
    try {
      await fs.writeFile(cachePath, JSON.stringify(cache), 'utf8');
    } catch (err) {
      if (this.scanStatus.metrics) this.scanStatus.metrics.cacheWriteErrors++;
      this.logScanEvent('library_cache_write_failed', {
        path: cachePath,
        error: String(err),
      });
    } finally {
      if (this.scanStatus.metrics)
        this.scanStatus.metrics.cacheWriteDurationMs += Date.now() - startedAt;
    }
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
    const metrics = this.scanStatus.metrics;
    return {
      ...this.scanStatus,
      metrics: metrics
        ? { ...metrics, roots: metrics.roots.map((root) => ({ ...root })) }
        : null,
    };
  }

  getCachedItems(): MediaItem[] | null {
    return this.cache ? [...this.cache.items] : null;
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
  async queryInventory(query: LibraryQueryDto, all = false) {
    await this.getLibrary(false);
    if (!this.inventoryRepo)
      throw new Error('Persistent library inventory is unavailable');
    if (query.missingTarget !== undefined && !query.targetLanguage) {
      query = {
        ...query,
        targetLanguage: (await this.settingsService.getSettings())
          .targetLanguage,
      };
    }
    const builder = inventoryQuery(this.inventoryRepo, query);
    const total = await builder.getCount();
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    if (!all) builder.skip(offset).take(limit);
    return {
      items: (await builder.getMany()).map(readInventoryItem),
      total,
      offset,
      limit,
    };
  }

  async getGroups(query: LibraryQueryDto) {
    await this.getLibrary(false);
    if (!this.inventoryRepo)
      throw new Error('Persistent library inventory is unavailable');
    const targetLanguage = canonicalizeLanguage(
      query.targetLanguage ??
        (await this.settingsService.getSettings()).targetLanguage,
    );
    if (query.missingTarget !== undefined && !query.targetLanguage)
      query = { ...query, targetLanguage };
    const rows = await inventoryQuery(this.inventoryRepo, query)
      .select('media.groupKey', 'key')
      .addSelect('media.groupLabel', 'label')
      .addSelect('media.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .addSelect('GROUP_CONCAT(DISTINCT media.season)', 'seasons')
      .addSelect(
        "SUM(CASE WHEN media.languages LIKE :groupTarget ESCAPE '\\' THEN 1 ELSE 0 END)",
        'targetPresent',
      )
      .setParameter('groupTarget', `%|${escapeLike(targetLanguage)}|%`)
      .orderBy('media.groupLabel', 'ASC')
      .groupBy('media.groupKey')
      .getRawMany<{
        key: string;
        label: string;
        type: MediaType;
        count: number;
        seasons: string | null;
        targetPresent: number;
      }>();
    const folders = await this.inventoryRepo
      .createQueryBuilder('media')
      .select('DISTINCT media.folder', 'folder')
      .orderBy('media.folder', 'ASC')
      .getRawMany<{ folder: string }>();
    return {
      targetLanguage,
      groups: rows.map((row) => ({
        ...row,
        count: Number(row.count),
        targetPresent: Number(row.targetPresent),
        missingTarget: Number(row.count) - Number(row.targetPresent),
        seasons: row.seasons
          ? row.seasons
              .split(',')
              .map(Number)
              .sort((a, b) => a - b)
          : [],
      })),
      folders: folders.map((row) => row.folder),
    };
  }

  private async persistInventory(items: MediaItem[]): Promise<void> {
    if (!this.inventoryRepo) return;
    await this.inventoryRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(MediaInventoryEntity);
      const previous = new Map(
        (await repo.find({ select: { id: true, discoveredAt: true } })).map(
          (row) => [row.id, row.discoveredAt],
        ),
      );
      const rows = items.map((item) =>
        inventoryRow(item, previous.get(item.id) ?? Date.now()),
      );
      for (let index = 0; index < rows.length; index += 40) {
        await repo.upsert(rows.slice(index, index + 40), ['id']);
      }
      const currentIds = new Set(items.map((item) => item.id));
      const removed = [...previous.keys()].filter((id) => !currentIds.has(id));
      for (let index = 0; index < removed.length; index += 400) {
        await repo.delete(removed.slice(index, index + 400));
      }
    });
  }

  private startScan(
    settings: RuntimeSettings,
    ttlMs: number,
    trigger: LibraryScanStatus['trigger'],
  ): Promise<MediaItem[]> {
    const startedAt = Date.now();
    const metrics: LibraryScanMetrics = {
      scanId: randomUUID(),
      concurrency: this.getProbeConcurrency(),
      discoveredFiles: 0,
      processedFiles: 0,
      itemCount: 0,
      cacheHits: 0,
      negativeCacheHits: 0,
      cacheMisses: 0,
      cacheReadErrors: 0,
      cacheWriteErrors: 0,
      cacheMalformedEntries: 0,
      probes: 0,
      probeErrors: 0,
      probeTimeouts: 0,
      skippedLargeFiles: 0,
      statFailures: 0,
      itemFailures: 0,
      directoryErrors: 0,
      sidecarReadErrors: 0,
      wallTimeMs: 0,
      discoveryWallTimeMs: 0,
      buildWallTimeMs: 0,
      statDurationMs: 0,
      cacheReadDurationMs: 0,
      cacheWriteDurationMs: 0,
      probeDurationMs: 0,
      sidecarReadDurationMs: 0,
      probeP50Ms: null,
      probeP95Ms: null,
      probeMaxMs: null,
      roots: [],
    };
    this.probeDurations = [];
    this.scanStatus = {
      ...this.scanStatus,
      state: 'running',
      trigger,
      startedAt,
      finishedAt: null,
      lastError: null,
      metrics,
    };
    this.logScanEvent('scan_started');
    const progressTimer = setInterval(() => {
      metrics.wallTimeMs = Date.now() - startedAt;
      this.logScanEvent('scan_progress');
    }, 5000);

    this.scanPromise = this.performScan(settings)
      .then(async (items) => {
        const newCache: CachedLibrary = {
          items,
          expiresAt: Date.now() + ttlMs,
        };
        await this.persistInventory(items);
        await this.persistLibraryCacheToDisk(newCache);
        this.cache = newCache;
        const finishedAt = Date.now();
        metrics.wallTimeMs = finishedAt - startedAt;
        metrics.itemCount = items.length;
        this.scanStatus = {
          ...this.scanStatus,
          state: 'completed',
          finishedAt,
          lastSuccessAt: finishedAt,
          lastDurationMs: metrics.wallTimeMs,
          lastItemCount: items.length,
          lastError: null,
        };
        this.logScanEvent('scan_completed');
        return items;
      })
      .catch((error: unknown) => {
        const finishedAt = Date.now();
        const message = error instanceof Error ? error.message : String(error);
        metrics.wallTimeMs = finishedAt - startedAt;
        this.scanStatus = {
          ...this.scanStatus,
          state: 'failed',
          finishedAt,
          lastDurationMs: metrics.wallTimeMs,
          lastError: message,
        };
        this.logScanEvent('scan_failed', { error: message });
        throw error;
      })
      .finally(() => {
        clearInterval(progressTimer);
        this.probeDurations = [];
        this.scanPromise = null;
      });

    return this.scanPromise;
  }

  private logScanEvent(
    event: string,
    details: Record<string, unknown> = {},
  ): void {
    const metrics = this.scanStatus.metrics;
    if (
      metrics &&
      (event === 'scan_progress' ||
        event === 'scan_completed' ||
        event === 'scan_failed')
    ) {
      const sorted = [...this.probeDurations].sort((a, b) => a - b);
      if (sorted.length > 0) {
        metrics.probeP50Ms = sorted[Math.ceil(sorted.length * 0.5) - 1];
        metrics.probeP95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1];
        metrics.probeMaxMs = sorted[sorted.length - 1];
      }
    }
    const message = JSON.stringify({
      event,
      trigger: this.scanStatus.trigger,
      ...(event === 'scan_started' ||
      event === 'scan_progress' ||
      event === 'scan_completed' ||
      event === 'scan_failed'
        ? metrics
        : { scanId: metrics?.scanId }),
      ...details,
    });
    if (event.endsWith('_failed') || event === 'cache_entry_invalid') {
      this.logger.warn(message);
    } else {
      this.logger.log(message);
    }
  }

  private async performScan(settings: RuntimeSettings): Promise<MediaItem[]> {
    this.failedSidecarDirectories.clear();
    const discoveryStartedAt = Date.now();
    const allFiles: string[] = [];
    const metrics = this.scanStatus.metrics;
    for (const mediaRoot of settings.mediaDirs) {
      const rootStartedAt = Date.now();
      const previousErrors = metrics?.directoryErrors ?? 0;
      const previousDiscoveredFiles = metrics?.discoveredFiles ?? 0;
      let files: string[] = [];
      let rootError: unknown;
      try {
        try {
          const config = this.configService.get<SubsyncEnvConfig>('subsync');
          if (!config)
            throw new Error('Media root configuration is unavailable');
          await assertWithinMediaRoots(mediaRoot, config.mediaDirs);
        } catch (error) {
          if (metrics) metrics.directoryErrors++;
          throw new Error(
            `Cannot read media root "${mediaRoot}": ${String(error)}`,
          );
        }
        files = await this.walkDirectory(
          mediaRoot,
          settings.pathContainsExclusions,
          true,
        );
        allFiles.push(...files);
      } catch (error) {
        rootError = error;
        throw error;
      } finally {
        const root = {
          path: mediaRoot,
          durationMs: Date.now() - rootStartedAt,
          discoveredFiles: metrics
            ? metrics.discoveredFiles - previousDiscoveredFiles
            : files.length,
          directoryErrors: (metrics?.directoryErrors ?? 0) - previousErrors,
        };
        metrics?.roots.push(root);
        if (metrics)
          metrics.discoveryWallTimeMs = Date.now() - discoveryStartedAt;
        this.logScanEvent(
          rootError === undefined ? 'scan_root_completed' : 'scan_root_failed',
          {
            ...root,
            ...(rootError === undefined
              ? {}
              : {
                  error:
                    rootError instanceof Error
                      ? rootError.message
                      : 'Unknown media root read failure',
                }),
          },
        );
      }
    }
    if (metrics) metrics.discoveryWallTimeMs = Date.now() - discoveryStartedAt;
    if (this.probeCacheRepo.manager) {
      this.scanProbeCache = new Map();
      const readStartedAt = Date.now();
      try {
        for (let index = 0; index < allFiles.length; index += 400) {
          const rows = await this.probeCacheRepo.find({
            where: { path: In(allFiles.slice(index, index + 400)) },
          });
          for (const row of rows) this.scanProbeCache.set(row.path, row);
        }
      } catch (error) {
        if (metrics) metrics.cacheReadErrors++;
        this.logScanEvent('cache_read_failed', { error: String(error) });
      } finally {
        if (metrics) metrics.cacheReadDurationMs += Date.now() - readStartedAt;
      }
      this.pendingProbeWrites = [];
    }
    const buildStartedAt = Date.now();
    let items: MediaItem[];
    try {
      items = await this.buildAllMediaItems(allFiles, {
        fileTooLargeBytes: settings.fileTooLargeBytes,
      });
      await this.flushProbeWrites(true);
    } finally {
      this.scanProbeCache = null;
      this.pendingProbeWrites = null;
    }
    if (metrics) metrics.buildWallTimeMs = Date.now() - buildStartedAt;
    // Keep prior entries on partial reads: absence is only evidence after a full traversal.
    if (
      metrics &&
      (metrics.directoryErrors ||
        metrics.statFailures ||
        metrics.itemFailures ||
        metrics.sidecarReadErrors)
    ) {
      const current = new Map(items.map((item) => [item.id, item]));
      for (const previous of this.cache?.items ?? []) {
        const updated = current.get(previous.id);
        if (!updated) current.set(previous.id, previous);
        else if (this.failedSidecarDirectories.has(path.dirname(updated.path)))
          updated.externalSubtitles = previous.externalSubtitles;
      }
      items = [...current.values()];
    }
    return items;
  }

  private async flushProbeWrites(drain = false): Promise<void> {
    if (
      !this.probeWritePromise &&
      this.pendingProbeWrites &&
      (this.pendingProbeWrites.length >= 100 ||
        (drain && this.pendingProbeWrites.length > 0))
    ) {
      this.probeWritePromise = (async () => {
        while (
          this.pendingProbeWrites &&
          (this.pendingProbeWrites.length >= 100 ||
            (drain && this.pendingProbeWrites.length > 0))
        ) {
          const batch = this.pendingProbeWrites.splice(0, 100);
          const startedAt = Date.now();
          try {
            await this.probeCacheRepo.manager.transaction(async (manager) => {
              await manager
                .getRepository(ProbeCacheEntity)
                .upsert(batch, ['path']);
            });
          } catch (error) {
            if (this.scanStatus.metrics)
              this.scanStatus.metrics.cacheWriteErrors++;
            this.logScanEvent('cache_write_failed', { error: String(error) });
          } finally {
            if (this.scanStatus.metrics)
              this.scanStatus.metrics.cacheWriteDurationMs +=
                Date.now() - startedAt;
          }
        }
      })().finally(() => {
        this.probeWritePromise = null;
      });
    }
    if (this.probeWritePromise) await this.probeWritePromise;
    if (drain && this.pendingProbeWrites?.length)
      await this.flushProbeWrites(true);
  }

  private async walkDirectory(
    root: string,
    exclusions: readonly string[],
    isConfiguredRoot = false,
  ): Promise<string[]> {
    const result: string[] = [];
    if (this.isExcludedPath(root, exclusions)) {
      return result;
    }

    let entries: Dirent[] = [];

    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      if (this.scanStatus.metrics) this.scanStatus.metrics.directoryErrors++;
      this.logScanEvent('directory_read_failed', {
        path: root,
        error: String(error),
      });
      if (isConfiguredRoot) {
        throw new Error(`Cannot read media root "${root}": ${String(error)}`);
      }
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
        if (this.scanStatus.metrics) this.scanStatus.metrics.discoveredFiles++;
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
    const results = new Array<MediaItem | undefined>(files.length);
    const directoryEntriesCache = new Map<string, Promise<Dirent[]>>();
    const probeConcurrency = this.getProbeConcurrency();
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < files.length) {
        const index = nextIndex++;
        try {
          results[index] = await this.buildMediaItem(files[index], {
            fileTooLargeBytes: options.fileTooLargeBytes,
            directoryEntriesCache,
          });
          if (this.scanStatus.metrics) this.scanStatus.metrics.itemCount++;
        } catch (error) {
          if (this.scanStatus.metrics) this.scanStatus.metrics.itemFailures++;
          this.logScanEvent('item_failed', {
            path: files[index],
            error: String(error),
          });
        } finally {
          if (this.scanStatus.metrics) this.scanStatus.metrics.processedFiles++;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(probeConcurrency, files.length) }, worker),
    );
    return results.filter((item): item is MediaItem => item !== undefined);
  }

  private async buildMediaItem(
    filePath: string,
    options: {
      fileTooLargeBytes?: number;
      directoryEntriesCache: Map<string, Promise<Dirent[]>>;
    },
  ): Promise<MediaItem> {
    const statStartedAt = Date.now();
    const metrics = this.scanStatus.metrics;
    const stats = await fs
      .stat(filePath)
      .catch((error: unknown) => {
        if (metrics) metrics.statFailures++;
        throw error;
      })
      .finally(() => {
        if (metrics) metrics.statDurationMs += Date.now() - statStartedAt;
      });
    const tooBig =
      options.fileTooLargeBytes != null &&
      stats.size > options.fileTooLargeBytes;
    let subtitleTracks: SubtitleTrack[];
    let probeStatus: ProbeStatus;
    if (tooBig) {
      subtitleTracks = [];
      probeStatus = 'skipped';
      if (metrics) metrics.skippedLargeFiles++;
    } else {
      const result = await this.probeSubtitleTracksCached(
        filePath,
        stats.mtimeMs,
        stats.size,
      );
      subtitleTracks = result.tracks;
      probeStatus = result.status;
    }
    const externalSubtitles = await this.findExternalSubtitles(
      filePath,
      options.directoryEntriesCache,
    );

    return {
      id: createHash('sha256').update(filePath).digest('hex'),
      path: filePath,
      name: path.parse(filePath).name,
      ...deriveMetadata(path.parse(filePath).name),
      probeStatus,
      subtitleTracks,
      externalSubtitles,
      size: stats.size,
      lastModified: stats.mtime,
    };
  }

  private async probeSubtitleTracksCached(
    filePath: string,
    mtimeMs: number,
    size: number,
  ): Promise<{ tracks: SubtitleTrack[]; status: 'ok' | 'failed' }> {
    const metrics = this.scanStatus.metrics;
    let cached: ProbeCacheEntity | null = null;
    const readStartedAt = Date.now();
    try {
      cached = this.scanProbeCache
        ? (this.scanProbeCache.get(filePath) ?? null)
        : await this.probeCacheRepo.findOne({ where: { path: filePath } });
    } catch (error) {
      if (metrics) metrics.cacheReadErrors++;
      this.logScanEvent('cache_read_failed', {
        path: filePath,
        error: String(error),
      });
    } finally {
      if (metrics) metrics.cacheReadDurationMs += Date.now() - readStartedAt;
    }
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
      try {
        const tracks: unknown = JSON.parse(cached.tracksJson);
        if (
          !Array.isArray(tracks) ||
          !tracks.every((track: unknown) => {
            if (typeof track !== 'object' || track === null) return false;
            const value = track as Partial<SubtitleTrack>;
            return (
              typeof value.index === 'number' &&
              typeof value.language === 'string' &&
              typeof value.codec === 'string' &&
              (value.title === undefined || typeof value.title === 'string')
            );
          })
        ) {
          throw new Error('Invalid cached subtitle tracks');
        }
        if (cached.error == null) {
          if (metrics) metrics.cacheHits++;
          return { tracks: tracks as SubtitleTrack[], status: 'ok' };
        }
        if (cached.retryAfter != null && cached.retryAfter > Date.now()) {
          if (metrics) metrics.negativeCacheHits++;
          return { tracks: [], status: 'failed' };
        }
      } catch (error) {
        if (metrics) metrics.cacheMalformedEntries++;
        this.logScanEvent('cache_entry_invalid', {
          path: filePath,
          error: String(error),
        });
      }
    }
    if (metrics) {
      metrics.cacheMisses++;
      metrics.probes++;
    }
    let tracks: SubtitleTrack[] = [];
    let error: string | null = null;
    let retryAfter: number | null = null;
    const probeStartedAt = Date.now();
    try {
      tracks = await this.probeSubtitleTracks(filePath);
    } catch (failure) {
      error = (
        failure instanceof Error ? failure.message : String(failure)
      ).slice(-STDERR_LIMIT_BYTES);
      retryAfter = Date.now() + PROBE_FAILURE_RETRY_MS;
      if (metrics) {
        metrics.probeErrors++;
        if (failure instanceof Error && failure.name === 'ProbeTimeoutError')
          metrics.probeTimeouts++;
      }
      this.logScanEvent('probe_failed', { path: filePath, error, retryAfter });
    } finally {
      const durationMs = Date.now() - probeStartedAt;
      if (metrics) metrics.probeDurationMs += durationMs;
      this.probeDurations.push(durationMs);
    }
    const writeStartedAt = Date.now();
    try {
      const row = {
        path: filePath,
        mtimeMs,
        size,
        tracksJson: JSON.stringify(tracks),
        error,
        retryAfter,
      };
      if (this.pendingProbeWrites) {
        this.pendingProbeWrites.push(row);
        // Backpressure bounds queued rows to one batch plus the active worker pool.
        await this.flushProbeWrites();
      } else await this.probeCacheRepo.save(row);
    } catch (failure) {
      if (metrics) metrics.cacheWriteErrors++;
      this.logScanEvent('cache_write_failed', {
        path: filePath,
        error: String(failure),
      });
    } finally {
      if (metrics && !this.pendingProbeWrites)
        metrics.cacheWriteDurationMs += Date.now() - writeStartedAt;
    }
    return { tracks, status: error === null ? 'ok' : 'failed' };
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
    // ES2023 does not expose Promise.withResolvers; keep the compatible executor API.
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          fn();
        }
      };
      const child = spawn('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        's',
        '-show_entries',
        'stream=index,codec_type,codec_name:stream_tags=language,title',
        '-print_format',
        'json',
        filePath,
      ]);
      const timer = setTimeout(() => {
        settle(() =>
          reject(
            new ProbeTimeoutError(
              `ffprobe timed out after ${FFPROBE_TIMEOUT_MS}ms for ${filePath}`,
            ),
          ),
        );
        child.kill('SIGKILL');
      }, FFPROBE_TIMEOUT_MS);

      let stdout = '';
      let stderr = Buffer.alloc(0);
      child.stdout.on('data', (chunk: Buffer) => {
        if (!settled) stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (settled) return;
        if (chunk.length >= STDERR_LIMIT_BYTES) {
          stderr = Buffer.from(
            chunk.subarray(chunk.length - STDERR_LIMIT_BYTES),
          );
        } else {
          const keep = Math.min(
            stderr.length,
            STDERR_LIMIT_BYTES - chunk.length,
          );
          stderr = Buffer.concat([
            stderr.subarray(stderr.length - keep),
            chunk,
          ]);
        }
      });
      child.on('error', (error) => {
        settle(() =>
          reject(
            new Error(`ffprobe spawn error for ${filePath}: ${error.message}`),
          ),
        );
      });
      child.on('close', (code) => {
        if (code !== 0) {
          settle(() =>
            reject(
              new Error(
                `ffprobe failed for ${filePath}: ${stderr.toString('utf8') || `exit ${code}`}`,
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
    directoryEntriesCache: Map<string, Promise<Dirent[]>>,
  ): Promise<ExternalSubtitle[]> {
    const directory = path.dirname(mediaPath);
    const stem = path.parse(mediaPath).name;

    let entriesPromise = directoryEntriesCache.get(directory);
    if (!entriesPromise) {
      const startedAt = Date.now();
      entriesPromise = fs
        .readdir(directory, { withFileTypes: true })
        .catch((error: unknown) => {
          this.failedSidecarDirectories.add(directory);
          if (this.scanStatus.metrics)
            this.scanStatus.metrics.sidecarReadErrors++;
          this.logScanEvent('sidecar_read_failed', {
            path: directory,
            error: String(error),
          });
          return [];
        })
        .finally(() => {
          if (this.scanStatus.metrics)
            this.scanStatus.metrics.sidecarReadDurationMs +=
              Date.now() - startedAt;
        });
      directoryEntriesCache.set(directory, entriesPromise);
    }
    const entries = await entriesPromise;

    return entries
      .filter((entry) => entry.isFile())
      .filter(
        (entry) =>
          EXTERNAL_SUB_EXTENSIONS[path.extname(entry.name).toLowerCase()],
      )
      .filter((entry) => entry.name.startsWith(stem + '.'))
      .map((entry) => {
        const fullPath = path.join(directory, entry.name);
        const extension = path.extname(entry.name);
        const suffix = entry.name.slice(stem.length, -extension.length);
        const tokens = suffix.split('.').filter(Boolean);
        const forced = tokens.some((token) => token.toLowerCase() === 'forced');
        const language =
          tokens.find((token) => !/^(?:forced|sdh|cc|\d+)$/i.test(token)) ??
          'und';

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
