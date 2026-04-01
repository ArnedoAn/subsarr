import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { type SubtitleOutputExtension } from '../translation/subtitle-format';

export interface ExtractionResult {
  tempFilePath: string;
  sizeBytes: number;
}

@Injectable()
export class ExtractionService {
  async extractSubtitleTrack(
    mediaPath: string,
    streamIndex: number,
    outputExtension: SubtitleOutputExtension = 'srt',
  ): Promise<ExtractionResult> {
    const tempDir = path.join(os.tmpdir(), 'subsync');
    await fs.mkdir(tempDir, { recursive: true });
    const ext = outputExtension === 'ass' ? 'ass' : 'srt';
    const tempFilePath = path.join(tempDir, `${randomUUID()}.${ext}`);

    await this.runFfmpeg(mediaPath, streamIndex, tempFilePath);

    const stats = await fs.stat(tempFilePath);
    if (stats.size === 0) {
      throw new Error('Subtitle extraction produced an empty output file');
    }

    return {
      tempFilePath,
      sizeBytes: stats.size,
    };
  }

  private runFfmpeg(
    mediaPath: string,
    streamIndex: number,
    outputPath: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-y',
        '-i',
        mediaPath,
        '-map',
        `0:${streamIndex}`,
        outputPath,
      ];
      const child = spawn('ffmpeg', args);
      let stderr = '';

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(`ffmpeg extraction failed: ${stderr || `exit ${code}`}`),
          );
          return;
        }

        resolve();
      });
    });
  }
}
