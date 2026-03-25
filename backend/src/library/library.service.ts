import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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

@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);
  private cache: CachedLibrary | null = null;

  constructor(private readonly settingsService: SettingsService) {}

  async getLibrary(forceRescan = false): Promise<MediaItem[]> {
    const settings = await this.settingsService.getSettings();
    const ttlMs = settings.scanCacheTtlMinutes * 60_000;
    const now = Date.now();

    if (!forceRescan && this.cache && this.cache.expiresAt > now) {
      return this.cache.items;
    }

    const items: MediaItem[] = [];
    for (const mediaRoot of settings.mediaDirs) {
      const files = await this.walkDirectory(mediaRoot);
      for (const mediaFile of files) {
        items.push(await this.buildMediaItem(mediaFile));
      }
    }

    this.cache = {
      items,
      expiresAt: now + ttlMs,
    };

    return items;
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
        language: (stream.tags?.language ?? 'und').toLowerCase(),
        title: stream.tags?.title,
        codec: stream.codec_name ?? 'unknown',
      }));
  }

  private execFfprobe(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('ffprobe', [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_streams',
        filePath,
      ]);
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(
              `ffprobe failed for ${filePath}: ${stderr || `exit ${code}`}`,
            ),
          );
          return;
        }

        resolve(stdout);
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
        const nameWithoutExtension = entry.name.slice(0, -extension.length);
        const tokens = nameWithoutExtension.split('.');
        const language =
          tokens.length >= 2
            ? forced
              ? tokens[tokens.length - 2]
              : tokens[tokens.length - 1]
            : 'und';

        return {
          path: fullPath,
          language: language.toLowerCase(),
          forced,
        };
      });
  }
}
