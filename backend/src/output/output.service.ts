import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type SubtitleOutputExtension } from '../translation/subtitle-format';
import { type SubsyncEnvConfig } from '../config/subsync.config';

/** `alternate` → `Movie.spa.2.srt` / `Movie.spa.2.ass` (second translation slot). */
export type SubtitlePathVariant = 'default' | 'alternate';

@Injectable()
export class OutputService {
  constructor(private readonly configService: ConfigService) {}

  buildSubtitlePath(
    mediaPath: string,
    targetLanguage: string,
    forced = false,
    extension: SubtitleOutputExtension = 'srt',
    variant: SubtitlePathVariant = 'default',
  ): string {
    const parsed = path.parse(mediaPath);
    const ext = extension === 'ass' ? 'ass' : 'srt';
    const lang = targetLanguage.toLowerCase();
    if (variant === 'alternate') {
      return path.join(parsed.dir, `${parsed.name}.${lang}.2.${ext}`);
    }
    const suffix = forced ? `${lang}.forced.${ext}` : `${lang}.${ext}`;
    return path.join(parsed.dir, `${parsed.name}.${suffix}`);
  }

  async writeSubtitle(
    mediaPath: string,
    targetLanguage: string,
    content: string,
    forced = false,
    extension: SubtitleOutputExtension = 'srt',
    variant: SubtitlePathVariant = 'default',
  ): Promise<string> {
    const outputPath = this.buildSubtitlePath(
      mediaPath,
      targetLanguage,
      forced,
      extension,
      variant,
    );
    try {
      await fs.writeFile(outputPath, content, 'utf8');
      return outputPath;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(
          `Failed to write subtitle to ${outputPath}: ${error.message}`,
        );
      }

      throw error;
    }
  }

  /** Copy existing subtitle to history before overwrite (replace mode). */
  async snapshotExistingIfAny(
    outputPath: string,
    itemId: string,
  ): Promise<void> {
    try {
      await fs.access(outputPath);
    } catch {
      return;
    }
    const config = this.configService.get<SubsyncEnvConfig>('subsync');
    if (!config) {
      return;
    }
    const dir = path.join(config.dataDir, 'history', itemId);
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = path.extname(outputPath) || '.srt';
    const dest = path.join(dir, `${stamp}${ext}`);
    await fs.copyFile(outputPath, dest);
  }

  async listTranslationHistory(itemId: string): Promise<string[]> {
    const config = this.configService.get<SubsyncEnvConfig>('subsync');
    if (!config) {
      return [];
    }
    const dir = path.join(config.dataDir, 'history', itemId);
    try {
      const entries = await fs.readdir(dir);
      return entries
        .filter((e) => e.endsWith('.srt') || e.endsWith('.ass'))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }
}
