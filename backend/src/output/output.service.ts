import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type SubtitleOutputExtension } from '../translation/subtitle-format';

@Injectable()
export class OutputService {
  buildSubtitlePath(
    mediaPath: string,
    targetLanguage: string,
    forced = false,
    extension: SubtitleOutputExtension = 'srt',
  ): string {
    const parsed = path.parse(mediaPath);
    const ext = extension === 'ass' ? 'ass' : 'srt';
    const suffix = forced
      ? `${targetLanguage.toLowerCase()}.forced.${ext}`
      : `${targetLanguage.toLowerCase()}.${ext}`;
    return path.join(parsed.dir, `${parsed.name}.${suffix}`);
  }

  async writeSubtitle(
    mediaPath: string,
    targetLanguage: string,
    content: string,
    forced = false,
    extension: SubtitleOutputExtension = 'srt',
  ): Promise<string> {
    const outputPath = this.buildSubtitlePath(
      mediaPath,
      targetLanguage,
      forced,
      extension,
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
