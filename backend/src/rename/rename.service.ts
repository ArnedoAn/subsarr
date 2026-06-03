import { Injectable, Logger } from '@nestjs/common';
import { Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type RenameStatus = 'safe' | 'unchanged' | 'collision' | 'ambiguous';
export type RenameMediaKind = 'episode' | 'movie' | 'unknown';

export interface RenameVariation {
  id: string;
  label: string;
  newPath: string;
  status: RenameStatus;
  reason?: string;
}

export interface RenamePreviewItem {
  originalPath: string;
  originalName: string;
  mediaKind: RenameMediaKind;
  variations: RenameVariation[];
}

export interface RenameError {
  originalPath: string;
  error: string;
  code:
    | 'duplicate_target'
    | 'destination_exists'
    | 'source_missing'
    | 'rename_failed';
}

export interface RenameResult {
  success: number;
  failed: number;
  errors: RenameError[];
}

interface ParsedEpisode {
  kind: 'episode';
  title: string;
  season: number;
  episode: number;
  episodeTitle?: string;
}

interface ParsedMovie {
  kind: 'movie';
  title: string;
  year: string;
}

type ParsedName =
  | ParsedEpisode
  | ParsedMovie
  | { kind: 'unknown'; title: string };

@Injectable()
export class RenameService {
  private readonly logger = new Logger(RenameService.name);

  private readonly allowedExtensions = new Set([
    '.mkv',
    '.mp4',
    '.avi',
    '.srt',
    '.ass',
    '.vtt',
  ]);

  async getPreview(baseDir: string): Promise<RenamePreviewItem[]> {
    const results: RenamePreviewItem[] = [];

    const walk = async (dir: string) => {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (this.allowedExtensions.has(ext)) {
            const item = await this.generateVariations(
              fullPath,
              entry.name,
              dir,
              baseDir,
            );
            if (item) {
              results.push(item);
            }
          }
        }
      }
    };

    try {
      await walk(baseDir);
    } catch (e) {
      this.logger.error(`Error walking directory ${baseDir}:`, e);
      throw new Error(`Failed to read directory: ${baseDir}`);
    }

    results.sort((a, b) => a.originalPath.localeCompare(b.originalPath));
    return results;
  }

  private async generateVariations(
    fullPath: string,
    filename: string,
    dir: string,
    baseDir: string,
  ): Promise<RenamePreviewItem | null> {
    const ext = path.extname(filename);
    const basename = path.basename(filename, ext);
    const variations: RenameVariation[] = [];
    const parsed = this.parseName(basename, dir, baseDir);

    if (parsed.kind === 'episode') {
      const s = parsed.season.toString().padStart(2, '0');
      const e = parsed.episode.toString().padStart(2, '0');

      let newNameDash = `${parsed.title} - S${s}E${e}`;
      let newNameSpace = `${parsed.title} S${s}E${e}`;

      if (parsed.episodeTitle) {
        newNameDash += ` - ${parsed.episodeTitle}`;
        newNameSpace += ` - ${parsed.episodeTitle}`;
      }

      variations.push(
        await this.buildVariation(fullPath, dir, ext, {
          id: 'series-dash',
          label: parsed.episodeTitle
            ? '{Title} - S{season:00}E{episode:00} - {EpisodeTitle}'
            : '{Title} - S{season:00}E{episode:00}',
          newName: newNameDash,
        }),
      );
      variations.push(
        await this.buildVariation(fullPath, dir, ext, {
          id: 'series-space',
          label: parsed.episodeTitle
            ? '{Title} S{season:00}E{episode:00} - {EpisodeTitle}'
            : '{Title} S{season:00}E{episode:00}',
          newName: newNameSpace,
        }),
      );
    } else if (parsed.kind === 'movie') {
      variations.push(
        await this.buildVariation(fullPath, dir, ext, {
          id: 'movie-parens',
          label: '{Title} ({Year})',
          newName: `${parsed.title} (${parsed.year})`,
        }),
      );
      variations.push(
        await this.buildVariation(fullPath, dir, ext, {
          id: 'movie-dash',
          label: '{Title} - {Year}',
          newName: `${parsed.title} - ${parsed.year}`,
        }),
      );
    } else {
      variations.push(
        await this.buildVariation(fullPath, dir, ext, {
          id: 'clean-name',
          label: 'Clean release name',
          newName: parsed.title,
        }),
      );
    }

    if (variations.some((variation) => variation.status === 'unchanged')) {
      return null;
    }

    const actionable = variations.filter(
      (variation) => variation.status !== 'unchanged',
    );
    if (actionable.length === 0) {
      return null;
    }

    return {
      originalPath: fullPath,
      originalName: filename,
      mediaKind: parsed.kind,
      variations: actionable,
    };
  }

  private parseName(
    basename: string,
    dir: string,
    baseDir: string,
  ): ParsedName {
    const normalized = basename.replace(/[._]+/g, ' ').replace(/\s+/g, ' ');
    const episodePatterns = [
      /^(.*?)\bS(\d{1,2})\s*E(\d{1,3})(?:\s*E\d{1,3})?\b(.*)$/i,
      /^(.*?)\b(\d{1,2})x(\d{1,3})\b(.*)$/i,
      /^(.*?)\bSeason\s*(\d{1,2})\s*Episode\s*(\d{1,3})\b(.*)$/i,
      /^Episode\s*(\d{1,3})\b(.*)$/i,
    ];

    for (const pattern of episodePatterns) {
      const match = normalized.match(pattern);
      if (!match) {
        continue;
      }

      const pathHint = this.extractTitleHintFromPath(dir, baseDir);
      const titleRaw = pattern.source.startsWith('^Episode')
        ? pathHint
        : match[1]?.trim() || pathHint || basename;
      const season = pattern.source.startsWith('^Episode')
        ? (this.extractSeasonHintFromPath(dir) ?? 1)
        : Number.parseInt(match[2] ?? '1', 10);
      const episode = Number.parseInt(
        pattern.source.startsWith('^Episode')
          ? (match[1] ?? '0')
          : (match[3] ?? '0'),
        10,
      );
      const episodeTitleRaw = pattern.source.startsWith('^Episode')
        ? (match[2] ?? '')
        : (match[4] ?? '');

      return {
        kind: 'episode',
        title: this.cleanReleaseName(titleRaw) || titleRaw,
        season,
        episode,
        episodeTitle: this.cleanEpisodeTitle(episodeTitleRaw),
      };
    }

    const yearMatch = normalized.match(
      /(?:^|[\s([])((?:19|20)\d{2})(?=$|[\s)\]])/,
    );
    if (yearMatch) {
      const movieTitleRaw = normalized.slice(0, yearMatch.index).trim();
      const movieTitle =
        this.cleanReleaseName(movieTitleRaw) ||
        this.extractTitleHintFromPath(dir, baseDir) ||
        basename;
      return {
        kind: 'movie',
        title: movieTitle,
        year: yearMatch[1],
      };
    }

    return {
      kind: 'unknown',
      title: this.cleanReleaseName(basename) || basename,
    };
  }

  private async buildVariation(
    originalPath: string,
    dir: string,
    ext: string,
    input: { id: string; label: string; newName: string },
  ): Promise<RenameVariation> {
    const newPath = path.join(
      dir,
      `${this.sanitizeFilename(input.newName)}${ext}`,
    );
    const originalResolved = path.resolve(originalPath).toLowerCase();
    const targetResolved = path.resolve(newPath).toLowerCase();

    if (originalResolved === targetResolved) {
      return {
        id: input.id,
        label: input.label,
        newPath,
        status: 'unchanged',
        reason: 'Name is already normalized',
      };
    }

    if (await this.pathExists(newPath)) {
      return {
        id: input.id,
        label: input.label,
        newPath,
        status: 'collision',
        reason: 'Destination already exists',
      };
    }

    return {
      id: input.id,
      label: input.label,
      newPath,
      status: 'safe',
    };
  }

  private extractTitleHintFromPath(dir: string, baseDir: string): string {
    if (path.resolve(dir) === path.resolve(baseDir)) {
      return path.basename(dir);
    }

    const relative = path.relative(baseDir, dir);
    const parts = relative.split(path.sep).filter(Boolean);

    for (const part of parts) {
      if (!/season\s*\d+/i.test(part)) {
        return part;
      }
    }
    return path.basename(baseDir);
  }

  private extractSeasonHintFromPath(dir: string): number | null {
    const parts = dir.split(path.sep).reverse();
    for (const part of parts) {
      const match = part.match(/season\s*(\d{1,2})/i);
      if (match) {
        return Number.parseInt(match[1], 10);
      }
    }
    return null;
  }

  private cleanReleaseName(name: string): string {
    if (!name) return '';
    let cleaned = name;

    // 1. Puntos y guiones bajos a espacios
    cleaned = cleaned.replace(/[._]/g, ' ');

    // 2. Metadatos entre corchetes
    cleaned = cleaned.replace(/\[.*?\]/g, '');

    // 3. Resolución, codec, calidades globales
    const qualityTokens = [
      '1080p',
      '720p',
      '2160p',
      '4k',
      '8k',
      '480p',
      '360p',
      'WEB-DL',
      'WEBRip',
      'BluRay',
      'BRRip',
      'BDRip',
      'HDRip',
      'DVDRip',
      'HDTV',
      'PDTV',
      'x264',
      'h264',
      'x265',
      'h265',
      'HEVC',
      'AVC',
      '10bit',
      'SDR',
      'HDR',
      'Remux',
      'DD5\\.?1',
      'DTS-HD',
      'TrueHD',
      'EAC3',
      'AAC',
      'AC3',
      'FLAC',
      'Dual',
      'Multi',
      'Latino',
      'Castellano',
      'Subbed',
      'Dubbed',
      'Proper',
      'Repack',
      'NF',
      'AMZN',
      'DSNP',
      'MAX',
    ];

    const regex = new RegExp(`\\b(${qualityTokens.join('|')})\\b`, 'gi');
    cleaned = cleaned.replace(regex, '');

    // 4. Remover sufijo de grupo (ej: -FLUX)
    cleaned = cleaned.replace(/-\s*[a-zA-Z0-9]+$/, '');

    // 5. Espacios múltiples y guiones huérfanos
    cleaned = cleaned.replace(/\s+/g, ' ');
    cleaned = cleaned.replace(/^[-\s]+|[-\s]+$/g, '');

    return cleaned.trim();
  }

  private cleanEpisodeTitle(name: string): string | undefined {
    const cleaned = this.cleanReleaseName(name.replace(/^[-\s]+/, ''));
    return cleaned || undefined;
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async executeRename(
    operations: { originalPath: string; newPath: string }[],
  ): Promise<RenameResult> {
    const errors = await this.validateOperations(operations);
    if (errors.length > 0) {
      return {
        success: 0,
        failed: operations.length,
        errors,
      };
    }

    let success = 0;
    let failed = 0;
    const executionErrors: RenameError[] = [];

    for (const op of operations) {
      try {
        if (op.originalPath !== op.newPath) {
          const dir = path.dirname(op.newPath);
          await fs.mkdir(dir, { recursive: true });

          await fs.rename(op.originalPath, op.newPath);
          success++;
        }
      } catch (e: unknown) {
        failed++;
        executionErrors.push({
          originalPath: op.originalPath,
          error: e instanceof Error ? e.message : 'Rename failed',
          code: 'rename_failed',
        });
      }
    }

    return { success, failed, errors: executionErrors };
  }

  private async validateOperations(
    operations: { originalPath: string; newPath: string }[],
  ): Promise<RenameError[]> {
    const errors: RenameError[] = [];
    const targetCounts = new Map<string, number>();

    for (const op of operations) {
      const normalizedTarget = path.resolve(op.newPath).toLowerCase();
      targetCounts.set(
        normalizedTarget,
        (targetCounts.get(normalizedTarget) ?? 0) + 1,
      );
    }

    for (const op of operations) {
      const normalizedSource = path.resolve(op.originalPath).toLowerCase();
      const normalizedTarget = path.resolve(op.newPath).toLowerCase();

      if ((targetCounts.get(normalizedTarget) ?? 0) > 1) {
        errors.push({
          originalPath: op.originalPath,
          error: 'Duplicate target path in rename batch',
          code: 'duplicate_target',
        });
        continue;
      }

      if (!(await this.pathExists(op.originalPath))) {
        errors.push({
          originalPath: op.originalPath,
          error: 'Source file does not exist',
          code: 'source_missing',
        });
        continue;
      }

      if (
        normalizedSource !== normalizedTarget &&
        (await this.pathExists(op.newPath))
      ) {
        errors.push({
          originalPath: op.originalPath,
          error: 'Destination already exists',
          code: 'destination_exists',
        });
      }
    }

    return errors;
  }
}
