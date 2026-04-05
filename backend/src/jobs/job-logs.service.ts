import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { JobLogRowEntity } from '../database/entities/job-log.entity';

export type JobLogLevel = 'info' | 'warn' | 'error';

export interface JobLogEntry {
  id: string;
  jobId?: string;
  level: JobLogLevel;
  phase: string;
  message: string;
  timestamp: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface LogsQuery {
  level?: JobLogLevel;
  jobId?: string;
  search?: string;
  from?: string;
  to?: string;
  /** Cursor: ISO timestamp of last item from previous page (exclusive) */
  cursor?: string;
  limit?: number;
}

function rowToEntry(row: JobLogRowEntity): JobLogEntry {
  return {
    id: row.id,
    jobId: row.jobId ?? undefined,
    level: row.level as JobLogLevel,
    phase: row.phase,
    message: row.message,
    timestamp: row.timestamp,
    details: row.detailsJson
      ? (JSON.parse(row.detailsJson) as Record<
          string,
          string | number | boolean | null
        >)
      : undefined,
  };
}

@Injectable()
export class JobLogsService {
  private readonly logger = new Logger('JobLogs');

  constructor(
    @InjectRepository(JobLogRowEntity)
    private readonly logRepo: Repository<JobLogRowEntity>,
  ) {}

  async append(
    input: Omit<JobLogEntry, 'id' | 'timestamp'>,
  ): Promise<JobLogEntry> {
    const log: JobLogEntry = {
      ...input,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    const prefix = log.jobId ? `[Job ${log.jobId}]` : '[System]';
    const text = `${prefix} [${log.phase}] ${log.message}`;
    if (log.level === 'error') {
      this.logger.error(text);
    } else if (log.level === 'warn') {
      this.logger.warn(text);
    } else {
      this.logger.log(text);
    }

    try {
      const row = new JobLogRowEntity();
      row.id = log.id;
      row.jobId = log.jobId ?? null;
      row.level = log.level;
      row.phase = log.phase;
      row.message = log.message;
      row.detailsJson = log.details ? JSON.stringify(log.details) : null;
      row.timestamp = log.timestamp;
      await this.logRepo.save(row);
    } catch (e) {
      this.logger.warn(
        `Could not persist log: ${e instanceof Error ? e.message : e}`,
      );
    }

    return log;
  }

  async getByJob(jobId: string): Promise<JobLogEntry[]> {
    const rows = await this.logRepo.find({
      where: { jobId },
      order: { timestamp: 'ASC' },
    });
    return rows.map(rowToEntry);
  }

  /**
   * Borra logs de un jobId concreto.
   * Útil al inicio de un job nuevo: si Bull reutiliza el mismo ID numérico
   * (counter reiniciado en Redis tras un restart), evitamos mezclar logs
   * del job anterior con los del nuevo.
   */
  async clearByJob(jobId: string): Promise<void> {
    try {
      await this.logRepo.delete({ jobId });
    } catch (e) {
      this.logger.warn(
        `clearByJob(${jobId}) failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  async query(query: LogsQuery): Promise<JobLogEntry[]> {
    const from = query.from ? Date.parse(query.from) : Number.NEGATIVE_INFINITY;
    const to = query.to ? Date.parse(query.to) : Number.POSITIVE_INFINITY;
    const limit = Math.min(Math.max(query.limit ?? 5000, 1), 10000);

    const qb = this.logRepo.createQueryBuilder('l');

    if (query.level) {
      qb.andWhere('l.level = :level', { level: query.level });
    }
    if (query.jobId) {
      qb.andWhere('l.jobId = :jobId', { jobId: query.jobId });
    }
    if (query.search) {
      const s = `%${query.search.toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(l.message) LIKE :s OR LOWER(l.phase) LIKE :s)',
        { s },
      );
    }
    if (query.cursor) {
      qb.andWhere('l.timestamp < :cursor', { cursor: query.cursor });
    }

    qb.orderBy('l.timestamp', 'DESC').take(limit);

    const rows = await qb.getMany();
    return rows
      .filter((entry) => {
        const ts = Date.parse(entry.timestamp);
        return ts >= from && ts <= to;
      })
      .map(rowToEntry);
  }

  async queryCount(query: Omit<LogsQuery, 'cursor' | 'limit'>): Promise<number> {
    const from = query.from ? Date.parse(query.from) : Number.NEGATIVE_INFINITY;
    const to = query.to ? Date.parse(query.to) : Number.POSITIVE_INFINITY;

    const qb = this.logRepo.createQueryBuilder('l');

    if (query.level) {
      qb.andWhere('l.level = :level', { level: query.level });
    }
    if (query.jobId) {
      qb.andWhere('l.jobId = :jobId', { jobId: query.jobId });
    }
    if (query.search) {
      const s = `%${query.search.toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(l.message) LIKE :s OR LOWER(l.phase) LIKE :s)',
        { s },
      );
    }

    const rows = await qb.getMany();
    return rows.filter((entry) => {
      const ts = Date.parse(entry.timestamp);
      return ts >= from && ts <= to;
    }).length;
  }
}
