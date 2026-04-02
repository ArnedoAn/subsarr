import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type SubtitleOutputExtension } from '../translation/subtitle-format';

/** `alternate` → `Movie.spa.2.srt` / `Movie.spa.2.ass` (second translation slot). */
export type SubtitlePathVariant = 'default' | 'alternate';

@Injectable()
export class OutputService {
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
    const suffix = forced
      ? `${lang}.forced.${ext}`
      : `${lang}.${ext}`;
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
}
