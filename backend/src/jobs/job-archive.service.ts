import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type SubsyncEnvConfig } from '../config/subsync.config';
import { type JobLogEntry } from './job-logs.service';
import { type JobReturnValue, type TranslationJobPayload } from './jobs.types';

const ARCHIVE_FILENAME = 'jobs-archive.jsonl';

export type ArchivedJobState = 'completed' | 'failed' | 'cancelled';

export interface ArchivedJobSnapshot {
  id: string;
  state: ArchivedJobState;
  data: TranslationJobPayload;
  createdAt: number;
  processedAt?: number;
  finishedAt: number;
  progress: number;
  returnValue?: JobReturnValue;
  failedReason?: string;
  logs: JobLogEntry[];
}

@Injectable()
export class JobArchiveService {
  private readonly logger = new Logger(JobArchiveService.name);
  private readonly archivePath: string;

  constructor(private readonly configService: ConfigService) {
    const config = this.configService.get<SubsyncEnvConfig>('subsync');
    const dataDir = config?.dataDir ?? '/data';
    this.archivePath = path.join(dataDir, ARCHIVE_FILENAME);
  }

  getArchivePath(): string {
    return this.archivePath;
  }

  async appendSnapshot(snapshot: ArchivedJobSnapshot): Promise<void> {
    const dir = path.dirname(this.archivePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(
      this.archivePath,
      `${JSON.stringify(snapshot)}\n`,
      'utf8',
    );
  }

  /**
   * Reads all snapshots; if the same job id appears more than once, keeps the newest by finishedAt.
   */
  async readSnapshots(): Promise<ArchivedJobSnapshot[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.archivePath, 'utf8');
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return [];
      }
      this.logger.warn(
        `Could not read job archive at ${this.archivePath}: ${error}`,
      );
      return [];
    }

    const byId = new Map<string, ArchivedJobSnapshot>();
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const snap = JSON.parse(trimmed) as ArchivedJobSnapshot;
        const prev = byId.get(snap.id);
        if (!prev || snap.finishedAt >= prev.finishedAt) {
          byId.set(snap.id, snap);
        }
      } catch {
        this.logger.warn('Skipping invalid line in job archive');
      }
    }

    return Array.from(byId.values());
  }

  async getSnapshot(id: string): Promise<ArchivedJobSnapshot | undefined> {
    const all = await this.readSnapshots();
    return all.find((s) => s.id === id);
  }
}
