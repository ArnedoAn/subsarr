import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { JobSnapshotEntity } from '../database/entities/job-snapshot.entity';
import { JobLogRowEntity } from '../database/entities/job-log.entity';
import { type JobLogEntry } from './job-logs.service';
import { type JobReturnValue, type TranslationJobPayload } from './jobs.types';

const MAX_ARCHIVED_JOBS = 500;

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

  constructor(
    @InjectRepository(JobSnapshotEntity)
    private readonly snapshotRepo: Repository<JobSnapshotEntity>,
    @InjectRepository(JobLogRowEntity)
    private readonly logRepo: Repository<JobLogRowEntity>,
  ) {}

  private rowToSnapshot(row: JobSnapshotEntity): ArchivedJobSnapshot {
    return {
      id: row.id,
      state: row.state as ArchivedJobState,
      data: JSON.parse(row.dataJson) as TranslationJobPayload,
      createdAt: row.createdAt,
      processedAt: row.processedAt ?? undefined,
      finishedAt: row.finishedAt,
      progress: row.progress,
      returnValue: row.returnValueJson
        ? (JSON.parse(row.returnValueJson) as JobReturnValue)
        : undefined,
      failedReason: row.failedReason ?? undefined,
      logs: JSON.parse(row.logsJson || '[]') as JobLogEntry[],
    };
  }

  async appendSnapshot(snapshot: ArchivedJobSnapshot): Promise<void> {
    const row = new JobSnapshotEntity();
    row.id = snapshot.id;
    row.state = snapshot.state;
    row.dataJson = JSON.stringify(snapshot.data);
    row.progress = snapshot.progress;
    row.returnValueJson = snapshot.returnValue
      ? JSON.stringify(snapshot.returnValue)
      : null;
    row.failedReason = snapshot.failedReason ?? null;
    row.createdAt = snapshot.createdAt;
    row.processedAt = snapshot.processedAt ?? null;
    row.finishedAt = snapshot.finishedAt;
    row.logsJson = JSON.stringify(snapshot.logs ?? []);
    await this.snapshotRepo.save(row);
    await this.compactArchiveIfNeeded();
  }

  private async compactArchiveIfNeeded(): Promise<void> {
    try {
      const count = await this.snapshotRepo.count();
      if (count <= MAX_ARCHIVED_JOBS) {
        return;
      }
      const keep = await this.snapshotRepo.find({
        order: { finishedAt: 'DESC' },
        take: MAX_ARCHIVED_JOBS,
        select: ['id'],
      });
      const keepIds = new Set(keep.map((k) => k.id));
      const all = await this.snapshotRepo.find({ select: ['id'] });
      const removeIds = all.map((a) => a.id).filter((id) => !keepIds.has(id));
      if (removeIds.length === 0) {
        return;
      }
      await this.logRepo
        .createQueryBuilder()
        .delete()
        .from(JobLogRowEntity)
        .where('jobId IN (:...ids)', { ids: removeIds })
        .execute();
      await this.snapshotRepo.delete({ id: In(removeIds) });
      this.logger.log(
        `Job archive compacted: removed ${removeIds.length} old snapshots`,
      );
    } catch (e) {
      this.logger.warn(
        `Archive compaction skipped: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  async readSnapshots(): Promise<ArchivedJobSnapshot[]> {
    const rows = await this.snapshotRepo.find({
      order: { finishedAt: 'DESC' },
    });
    return rows.map((r) => this.rowToSnapshot(r));
  }

  async getSnapshot(id: string): Promise<ArchivedJobSnapshot | undefined> {
    const row = await this.snapshotRepo.findOne({ where: { id } });
    return row ? this.rowToSnapshot(row) : undefined;
  }
}
