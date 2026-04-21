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
    '.mkv', '.mp4', '.avi', '.srt', '.ass', '.vtt'
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
             const item = this.generateVariations(fullPath, entry.name, dir, baseDir);
             if (item) {
               results.push(item);
             }
           }
        }
      }
    }

    try {
      await walk(baseDir);
    } catch (e) {
      this.logger.error(`Error walking directory ${baseDir}:`, e);
      throw new Error(`Failed to read directory: ${baseDir}`);
    }

    results.sort((a, b) => a.originalPath.localeCompare(b.originalPath));
    return results;
  }

  private generateVariations(fullPath: string, filename: string, dir: string, baseDir: string): RenamePreviewItem | null {
    const ext = path.extname(filename);
    const basename = path.basename(filename, ext);
    
    let titleHint = this.extractTitleHintFromPath(dir, baseDir) || basename;
    
    titleHint = titleHint.replace(/season\s*\d+/i, '').trim();
    if (!titleHint) {
       titleHint = basename; 
    }
    titleHint = this.cleanReleaseName(titleHint);

    const variations: RenameVariation[] = [];

    const episodeMatch = basename.match(/s(\d{1,2})e(\d{1,2})/i);
    const yearMatch = basename.match(/\b(19|20)\d{2}\b/);

    if (episodeMatch) {
      const s = parseInt(episodeMatch[1], 10).toString().padStart(2, '0');
      const e = parseInt(episodeMatch[2], 10).toString().padStart(2, '0');
      variations.push({
        id: 'series-dash',
        label: '{Title} - S{season:00}E{episode:00}',
        newPath: path.join(dir, `${titleHint} - S${s}E${e}${ext}`)
      });
      variations.push({
        id: 'series-space',
        label: '{Title} S{season:00}E{episode:00}',
        newPath: path.join(dir, `${titleHint} S${s}E${e}${ext}`)
      });
    } else if (yearMatch) {
      const year = yearMatch[0];
      let movieTitle = basename.substring(0, yearMatch.index).trim();
      movieTitle = this.cleanReleaseName(movieTitle);
      
      if (!movieTitle) movieTitle = titleHint;

      variations.push({
         id: 'movie-parens',
         label: '{Title} ({Year})',
         newPath: path.join(dir, `${movieTitle} (${year})${ext}`)
      });
      variations.push({
         id: 'movie-dash',
         label: '{Title} - {Year}',
         newPath: path.join(dir, `${movieTitle} - ${year}${ext}`)
      });
    } else {
       const clean = this.cleanReleaseName(basename);
       variations.push({
         id: 'clean-name',
         label: 'Clean release name',
         newPath: path.join(dir, `${clean}${ext}`)
       });
    }

    return {
      originalPath: fullPath,
      originalName: filename,
      variations
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
    let cleaned = name.replace(/[\._]/g, ' ');
    cleaned = cleaned.replace(/(1080p|720p|2160p|4k|WEB-DL|WEBRip|BluRay|x264|H[.\s]?264|x265|HEVC)/i, '');
    cleaned = cleaned.replace(/-\s*$/, '').trim();
    return cleaned;
  }

  async executeRename(operations: { originalPath: string, newPath: string }[]): Promise<{ success: number; failed: number; errors: any[] }> {
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
