import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { assertWithinMediaRoots } from '../common/path-safety';
import { type SubsyncEnvConfig } from '../config/subsync.config';

export interface FileSystemEntry {
  name: string;
  isDirectory: boolean;
  path: string;
}

@Injectable()
export class SystemService {
  constructor(private readonly configService: ConfigService) {}

  async listDirectory(dirPath?: string): Promise<FileSystemEntry[]> {
    const roots =
      this.configService.getOrThrow<SubsyncEnvConfig>('subsync').mediaDirs;
    try {
      if (!dirPath) {
        return await Promise.all(
          roots.map(async (root) => {
            const safe = await assertWithinMediaRoots(root, roots);
            return {
              name: safe,
              isDirectory: true,
              path: safe.replace(/\\/g, '/'),
            };
          }),
        );
      }
      if (dirPath.length > 4096) throw new Error('Directory path is too long');
      const safePath = await assertWithinMediaRoots(dirPath, roots);
      const entries = await fs.readdir(safePath, { withFileTypes: true });
      const visible: FileSystemEntry[] = [];
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        visible.push({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          path: path.join(safePath, entry.name).replace(/\\/g, '/'),
        });
      }
      return visible.sort(
        (a, b) =>
          Number(b.isDirectory) - Number(a.isDirectory) ||
          a.name.localeCompare(b.name),
      );
    } catch (error) {
      throw new BadRequestException(
        `Cannot browse directory: ${error instanceof Error ? error.message : 'filesystem unavailable'}`,
      );
    }
  }
}
