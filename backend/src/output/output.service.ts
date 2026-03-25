import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

@Injectable()
export class OutputService {
  buildSubtitlePath(
    mediaPath: string,
    targetLanguage: string,
    forced = false,
  ): string {
    const parsed = path.parse(mediaPath);
    const suffix = forced
      ? `${targetLanguage.toLowerCase()}.forced.srt`
      : `${targetLanguage.toLowerCase()}.srt`;
    return path.join(parsed.dir, `${parsed.name}.${suffix}`);
  }

  async writeSubtitle(
    mediaPath: string,
    targetLanguage: string,
    content: string,
    forced = false,
  ): Promise<string> {
    const outputPath = this.buildSubtitlePath(
      mediaPath,
      targetLanguage,
      forced,
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
