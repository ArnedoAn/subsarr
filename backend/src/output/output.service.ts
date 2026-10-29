import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs, constants } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { type SubtitleOutputExtension } from '../translation/subtitle-format';
import { type SubsyncEnvConfig } from '../config/subsync.config';
import {
  assertWithinMediaRoots,
  validateLanguageCode,
} from '../common/path-safety';

export type SubtitlePathVariant = 'default' | 'alternate';
export interface SubtitleWriteOptions {
  signal?: AbortSignal;
  overwrite?: boolean;
  itemId?: string;
}

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
    if (
      !path.isAbsolute(mediaPath) ||
      !parsed.name ||
      parsed.name.includes('\0')
    )
      throw new Error('Invalid media path');
    if (!['srt', 'ass', 'ssa', 'vtt'].includes(extension))
      throw new Error('Invalid subtitle extension');
    if (variant !== 'default' && variant !== 'alternate')
      throw new Error('Invalid subtitle variant');
    const lang = validateLanguageCode(targetLanguage);
    const suffix =
      variant === 'alternate'
        ? `${lang}.2.${extension}`
        : forced
          ? `${lang}.forced.${extension}`
          : `${lang}.${extension}`;
    return path.join(parsed.dir, `${parsed.name}.${suffix}`);
  }

  async writeSubtitle(
    mediaPath: string,
    targetLanguage: string,
    content: string,
    forced = false,
    extension: SubtitleOutputExtension = 'srt',
    variant: SubtitlePathVariant = 'default',
    options: SubtitleWriteOptions = {},
  ): Promise<string> {
    const config = this.configService.getOrThrow<SubsyncEnvConfig>('subsync');
    const safeMedia = await assertWithinMediaRoots(mediaPath, config.mediaDirs);
    const requested = this.buildSubtitlePath(
      safeMedia,
      targetLanguage,
      forced,
      extension,
      variant,
    );
    const outputPath = await assertWithinMediaRoots(
      requested,
      config.mediaDirs,
      { allowMissing: true },
    );
    // Do not follow a destination symlink or unexpectedly overwrite another file.
    try {
      const existing = await fs.lstat(requested);
      if (existing.isSymbolicLink() || !existing.isFile())
        throw new Error('Subtitle destination is not a regular file');
      if (!options.overwrite)
        throw new ConflictException('Subtitle destination already exists');
      if (!options.itemId)
        throw new Error('Replacing a subtitle requires its history item ID');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const tempPath = path.join(
      path.dirname(outputPath),
      `.subsarr-${randomUUID()}.tmp`,
    );
    try {
      options.signal?.throwIfAborted();
      await fs.writeFile(tempPath, content, {
        encoding: 'utf8',
        flag: 'wx',
        signal: options.signal,
      });
      if (options.overwrite && options.itemId)
        await this.snapshotExistingIfAny(outputPath, options.itemId);
      await assertWithinMediaRoots(requested, config.mediaDirs, {
        allowMissing: true,
      });
      options.signal?.throwIfAborted();
      if (options.overwrite) await fs.rename(tempPath, outputPath);
      else await fs.link(tempPath, outputPath); // Atomic no-clobber publication.
      return outputPath;
    } finally {
      await fs.rm(tempPath, { force: true });
    }
  }

  async snapshotExistingIfAny(
    outputPath: string,
    itemId: string,
  ): Promise<void> {
    const config = this.configService.getOrThrow<SubsyncEnvConfig>('subsync');
    const source = await assertWithinMediaRoots(outputPath, config.mediaDirs, {
      allowMissing: true,
    });
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(itemId))
      throw new Error('Invalid history item ID');
    const historyRoot = path.join(config.dataDir, 'history');
    await fs.mkdir(historyRoot, { recursive: true });
    const dir = await assertWithinMediaRoots(
      path.join(historyRoot, itemId),
      [historyRoot],
      { allowMissing: true },
    );
    await fs.mkdir(dir, { recursive: true });
    const dest = path.join(
      dir,
      `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}${path.extname(source) || '.srt'}`,
    );
    try {
      await fs.copyFile(source, dest, constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async listTranslationHistory(itemId: string): Promise<string[]> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(itemId))
      throw new Error('Invalid history item ID');
    const config = this.configService.getOrThrow<SubsyncEnvConfig>('subsync');
    const historyRoot = path.join(config.dataDir, 'history');
    try {
      const dir = await assertWithinMediaRoots(path.join(historyRoot, itemId), [
        historyRoot,
      ]);
      return (await fs.readdir(dir))
        .filter((entry) => /\.(srt|ass|ssa|vtt)$/.test(entry))
        .sort()
        .reverse();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}
