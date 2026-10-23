import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { type SubtitleOutputExtension } from '../translation/subtitle-format';

export interface ExtractionResult {
  tempFilePath: string;
  sizeBytes: number;
}
export interface ExtractionOptions {
  signal?: AbortSignal;
  preview?: boolean;
}

@Injectable()
export class ExtractionService {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  async extractSubtitleTrack(
    mediaPath: string,
    streamIndex: number,
    outputExtension: SubtitleOutputExtension = 'srt',
    options: ExtractionOptions = {},
  ): Promise<ExtractionResult> {
    if (!path.isAbsolute(mediaPath) || mediaPath.includes('\0'))
      throw new Error('Extraction requires an absolute local file path');
    if (
      !Number.isSafeInteger(streamIndex) ||
      streamIndex < 0 ||
      streamIndex > 65535
    )
      throw new Error('Invalid subtitle stream index');
    if (!['srt', 'ass', 'ssa', 'vtt'].includes(outputExtension))
      throw new Error('Invalid subtitle output format');
    options.signal?.throwIfAborted();
    if (this.waiting.length >= 64)
      throw new Error('Subtitle extraction queue is full');
    if (this.active >= 2) {
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          options.signal?.removeEventListener('abort', abort);
          resolve();
        };
        const abort = () => {
          const index = this.waiting.indexOf(ready);
          if (index >= 0) this.waiting.splice(index, 1);
          const reason: unknown = options.signal?.reason;
          reject(
            reason instanceof Error
              ? reason
              : new Error('Extraction cancelled', { cause: reason }),
          );
        };
        this.waiting.push(ready);
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort();
      });
    } else this.active++;
    let tempFilePath: string | undefined;
    try {
      options.signal?.throwIfAborted();
      tempFilePath = path.join(
        os.tmpdir(),
        `subsarr-${randomUUID()}.${outputExtension}`,
      );
      await this.runFfmpeg(mediaPath, streamIndex, tempFilePath, options);
      const stats = await fs.stat(tempFilePath);
      if (stats.size === 0)
        throw new Error('Subtitle extraction produced an empty output file');
      if (!options.preview && stats.size >= 32 * 1024 * 1024)
        throw new Error('Extracted subtitle exceeds size limit');
      return { tempFilePath, sizeBytes: stats.size };
    } catch (error) {
      if (tempFilePath) await fs.rm(tempFilePath, { force: true });
      throw error;
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }

  private runFfmpeg(
    mediaPath: string,
    streamIndex: number,
    outputPath: string,
    options: ExtractionOptions,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-n',
        '-protocol_whitelist',
        'file',
        '-threads',
        '1',
        '-i',
        mediaPath,
        '-map',
        `0:${streamIndex}`,
        ...(options.preview ? ['-t', '120'] : []),
        '-fs',
        String(options.preview ? 1024 * 1024 : 32 * 1024 * 1024),
        outputPath,
      ];
      const child = spawn('ffmpeg', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });
      let stderr = '';
      let failure: Error | undefined;
      const stop = (error: Error) => {
        failure ??= error;
        child.kill('SIGKILL');
      };
      const abort = () => stop(new Error('Subtitle extraction cancelled'));
      const timer = setTimeout(
        () => stop(new Error('Subtitle extraction timed out')),
        options.preview ? 30_000 : 180_000,
      );
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-16_384);
      });
      child.once('error', (error) => {
        failure = error;
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        if (failure) reject(failure);
        else if (code !== 0)
          reject(
            new Error(`ffmpeg extraction failed: ${stderr || `exit ${code}`}`),
          );
        else resolve();
      });
    });
  }
}
