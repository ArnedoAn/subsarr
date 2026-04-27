import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import { Dirent } from 'fs';
import * as path from 'path';

export interface RenameVariation {
  id: string;
  label: string;
  newPath: string;
}

export interface RenamePreviewItem {
  originalPath: string;
  originalName: string;
  variations: RenameVariation[];
}

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
      } catch (err) {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (this.allowedExtensions.has(ext)) {
            const item = this.generateVariations(
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

  private generateVariations(
    fullPath: string,
    filename: string,
    dir: string,
    baseDir: string,
  ): RenamePreviewItem | null {
    const ext = path.extname(filename);
    const basename = path.basename(filename, ext);

    // Matchear formato de serie estilo Radarr/Sonarr
    const showRegex =
      /^(.*?)(?:\s+-\s+)?\bS(\d{1,2})E(\d{1,2})\b(?:[-\sA-Z0-9]*E\d{1,2})?(?:\s*-\s*(.*?))?$/i;
    const tvMatch = basename.match(showRegex);

    // Extraer año de las películas
    const yearMatch = basename.match(/\b(19|20)\d{2}\b/);

    const variations: RenameVariation[] = [];

    if (tvMatch) {
      const seriesTitleRaw =
        tvMatch[1]?.trim() ||
        this.extractTitleHintFromPath(dir, baseDir) ||
        basename;
      const seriesTitle =
        this.cleanReleaseName(seriesTitleRaw) || seriesTitleRaw;

      const s = parseInt(tvMatch[2], 10).toString().padStart(2, '0');
      const e = parseInt(tvMatch[3], 10).toString().padStart(2, '0');

      const episodeTitleRaw = tvMatch[4] || '';
      const episodeTitle = this.cleanReleaseName(episodeTitleRaw);

      let newNameDash = `${seriesTitle} - S${s}E${e}`;
      let newNameSpace = `${seriesTitle} S${s}E${e}`;

      if (episodeTitle) {
        newNameDash += ` - ${episodeTitle}`;
        newNameSpace += ` - ${episodeTitle}`;
      }

      variations.push({
        id: 'series-dash',
        label: episodeTitle
          ? '{Title} - S{season:00}E{episode:00} - {EpisodeTitle}'
          : '{Title} - S{season:00}E{episode:00}',
        newPath: path.join(dir, `${newNameDash}${ext}`),
      });
      variations.push({
        id: 'series-space',
        label: episodeTitle
          ? '{Title} S{season:00}E{episode:00} - {EpisodeTitle}'
          : '{Title} S{season:00}E{episode:00}',
        newPath: path.join(dir, `${newNameSpace}${ext}`),
      });
    } else if (yearMatch) {
      const year = yearMatch[0];
      const movieTitleRaw = basename.substring(0, yearMatch.index).trim();
      let movieTitle = this.cleanReleaseName(movieTitleRaw);

      if (!movieTitle)
        movieTitle = this.extractTitleHintFromPath(dir, baseDir) || basename;

      variations.push({
        id: 'movie-parens',
        label: '{Title} ({Year})',
        newPath: path.join(dir, `${movieTitle} (${year})${ext}`),
      });
      variations.push({
        id: 'movie-dash',
        label: '{Title} - {Year}',
        newPath: path.join(dir, `${movieTitle} - ${year}${ext}`),
      });
    } else {
      const clean = this.cleanReleaseName(basename);
      variations.push({
        id: 'clean-name',
        label: 'Clean release name',
        newPath: path.join(dir, `${clean}${ext}`),
      });
    }

    return {
      originalPath: fullPath,
      originalName: filename,
      variations,
    };
  }

  private extractTitleHintFromPath(dir: string, baseDir: string): string {
    if (path.resolve(dir) === path.resolve(baseDir)) {
      return path.basename(dir);
    }

    const parts = dir.replace(baseDir, '').split(path.sep).filter(Boolean);

    for (const part of parts) {
      if (!/season\s*\d+/i.test(part)) {
        return part;
      }
    }
    return path.basename(baseDir);
  }

  private cleanReleaseName(name: string): string {
    if (!name) return '';
    let cleaned = name;

    // 1. Puntos y guiones bajos a espacios
    cleaned = cleaned.replace(/[\._]/g, ' ');

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

  async executeRename(
    operations: { originalPath: string; newPath: string }[],
  ): Promise<{ success: number; failed: number; errors: any[] }> {
    let success = 0;
    let failed = 0;
    const errors: any[] = [];

    for (const op of operations) {
      try {
        if (op.originalPath !== op.newPath) {
          const dir = path.dirname(op.newPath);
          await fs.mkdir(dir, { recursive: true });

          await fs.rename(op.originalPath, op.newPath);
          success++;
        }
      } catch (e: any) {
        failed++;
        errors.push({ originalPath: op.originalPath, error: e.message });
      }
    }

    return { success, failed, errors };
  }
}
