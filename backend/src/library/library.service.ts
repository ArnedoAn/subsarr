import {
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { SettingsService } from '../settings/settings.service';
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
const PROBE_CONCURRENCY = 10;

@Injectable()
export class LibraryService implements OnModuleInit {
  private readonly logger = new Logger(LibraryService.name);
  private cache: CachedLibrary | null = null;
  private scanPromise: Promise<MediaItem[]> | null = null;

  constructor(private readonly settingsService: SettingsService) {}

  async onModuleInit() {
    this.logger.log('Warming up library cache on startup...');
    this.getLibrary(false).catch((err) =>
      this.logger.error(`Library warm-up failed: ${err}`),
    );
  }

  async getLibrary(forceRescan = false): Promise<MediaItem[]> {
    const settings = await this.settingsService.getSettings();
    const ttlMs = settings.scanCacheTtlMinutes * 60_000;
    const now = Date.now();

    this.logger.log(
      `getLibrary called. forceRescan=${forceRescan}, mediaDirs=${JSON.stringify(settings.mediaDirs)}`,
    );

    if (!forceRescan && this.cache && this.cache.expiresAt > now) {
      this.logger.log(
        `Returning cached library with ${this.cache.items.length} items`,
      );
      return this.cache.items;
    }

    if (this.scanPromise) {
      this.logger.log('Scan already in progress, waiting for it to finish...');
      return this.scanPromise;
    }

    this.scanPromise = this.performScan(settings.mediaDirs, ttlMs).finally(
      () => {
        this.scanPromise = null;
      },
    );
    return this.scanPromise;
  }

  private async performScan(
    mediaDirs: string[],
    ttlMs: number,
  ): Promise<MediaItem[]> {
    const startTime = Date.now();
    const allFiles: string[] = [];

    for (const mediaRoot of mediaDirs) {
      this.logger.log(`Scanning directory: ${mediaRoot}`);
      try {
        const files = await this.walkDirectory(mediaRoot);
        this.logger.log(`Found ${files.length} media files in ${mediaRoot}`);
        allFiles.push(...files);
      } catch (err) {
        this.logger.error(`Failed to scan directory ${mediaRoot}: ${err}`);
      }
    }

    const items = await this.buildAllMediaItems(allFiles);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.log(
      `Library scan complete. ${items.length} items in ${elapsed}s`,
    );

    this.cache = { items, expiresAt: Date.now() + ttlMs };
    return items;
  }

  private async buildAllMediaItems(files: string[]): Promise<MediaItem[]> {
    const results: MediaItem[] = [];

    for (let i = 0; i < files.length; i += PROBE_CONCURRENCY) {
      const batch = files.slice(i, i + PROBE_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map((file) => this.buildMediaItem(file)),
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

  async getById(id: string): Promise<MediaItem> {
    const items = await this.getLibrary(false);
    const match = items.find((item) => item.id === id);
    if (!match) {
      throw new NotFoundException(`Media item not found: ${id}`);
    }

    return match;
  }

  async rescan(): Promise<MediaItem[]> {
    this.logger.log('Manual library rescan requested');
    return this.getLibrary(true);
  }

  private async walkDirectory(root: string): Promise<string[]> {
    const result: string[] = [];
    let entries: Dirent[] = [];

    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      this.logger.warn(`Unable to read directory: ${root}`);
      return result;
    }

    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        result.push(...(await this.walkDirectory(fullPath)));
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (MEDIA_EXTENSIONS.has(extension)) {
        result.push(fullPath);
      }
    }

    return result;
  }

  private async buildMediaItem(filePath: string): Promise<MediaItem> {
    const stats = await fs.stat(filePath);
    const subtitleTracks = await this.probeSubtitleTracks(filePath);
    const externalSubtitles = await this.findExternalSubtitles(filePath);

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
  ): Promise<ExternalSubtitle[]> {
    const directory = path.dirname(mediaPath);
    const stem = path.parse(mediaPath).name;
    const entries = await fs.readdir(directory, { withFileTypes: true });

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
}
