import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
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
  details?: unknown;
}

export interface LogsQuery {
  level?: JobLogLevel;
  jobId?: string;
  q?: string;
  search?: string;
  from?: string;
  to?: string;
  /** Opaque timestamp and ID pair from encodeLogCursor (exclusive). */
  cursor?: string;
  limit?: number;
  offset?: number;
}

export function encodeLogCursor(
  entry: Pick<JobLogEntry, 'timestamp' | 'id'>,
): string {
  return Buffer.from(JSON.stringify([entry.timestamp, entry.id])).toString(
    'base64url',
  );
}

function decodeLogCursor(cursor: string): { timestamp: string; id: string } {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== 'string' ||
      typeof value[1] !== 'string' ||
      !value[1] ||
      !Number.isFinite(Date.parse(value[0]))
    ) {
      throw new Error('Invalid cursor');
    }
    return { timestamp: new Date(value[0]).toISOString(), id: value[1] };
  } catch {
    throw new BadRequestException('Invalid logs cursor');
  }
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
      ? (JSON.parse(row.detailsJson) as unknown)
      : undefined,
  };
}

@Injectable()
export class JobLogsService implements OnModuleInit {
  private readonly logger = new Logger('JobLogs');
  private nextRetentionAt = 0;
  private appendsSinceRetention = 0;
  private retentionPromise?: Promise<void>;

  constructor(
    @InjectRepository(JobLogRowEntity)
    private readonly logRepo: Repository<JobLogRowEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.enforceRetention();
  }

  private async enforceRetention(): Promise<void> {
    if (this.retentionPromise) return this.retentionPromise;
    const now = Date.now();
    if (now < this.nextRetentionAt && this.appendsSinceRetention < 500) return;
    this.appendsSinceRetention = 0;
    const retention = async () => {
      // All log kinds, including system rows without jobId, share these bounds.
      await this.logRepo
        .createQueryBuilder()
        .delete()
        .where('timestamp < :cutoff', {
          cutoff: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .execute();
      await this.logRepo.query(
        'DELETE FROM job_logs WHERE id IN (SELECT id FROM job_logs ORDER BY timestamp DESC, id DESC LIMIT -1 OFFSET 50000)',
      );
      this.nextRetentionAt = now + 60_000;
    };
    this.retentionPromise = retention();
    try {
      await this.retentionPromise;
    } finally {
      this.retentionPromise = undefined;
    }
  }

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
      this.appendsSinceRetention += 1;
      await this.enforceRetention();
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
      order: { timestamp: 'DESC', id: 'DESC' },
      take: 500,
    });
    return rows.reverse().map(rowToEntry);
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

  private filteredQuery(query: LogsQuery): SelectQueryBuilder<JobLogRowEntity> {
    const qb = this.logRepo.createQueryBuilder('l');
    if (query.level) qb.andWhere('l.level = :level', { level: query.level });
    if (query.jobId) qb.andWhere('l.jobId = :jobId', { jobId: query.jobId });
    const search = query.q ?? query.search;
    if (search) {
      const pattern = `%${search.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
      qb.andWhere(
        "(LOWER(l.message) LIKE :pattern ESCAPE '\\' OR LOWER(l.phase) LIKE :pattern ESCAPE '\\')",
        { pattern },
      );
    }
    if (query.from) {
      qb.andWhere('l.timestamp >= :from', {
        from: this.boundTimestamp(query.from),
      });
    }
    if (query.to) {
      qb.andWhere('l.timestamp <= :to', { to: this.boundTimestamp(query.to) });
    }
    return qb;
  }

  private boundTimestamp(value: string): string {
    if (!Number.isFinite(Date.parse(value))) {
      throw new BadRequestException('Invalid logs date bound');
    }
    return new Date(value).toISOString();
  }

  async query(query: LogsQuery): Promise<JobLogEntry[]> {
    const qb = this.filteredQuery(query);
    if (query.cursor) {
      const cursor = decodeLogCursor(query.cursor);
      qb.andWhere(
        '(l.timestamp < :timestamp OR (l.timestamp = :timestamp AND l.id < :id))',
        cursor,
      );
    }
    const offset = Number.isFinite(query.offset)
      ? Math.max(0, Math.trunc(query.offset!))
      : 0;
    const limit = Number.isFinite(query.limit)
      ? Math.min(Math.max(Math.trunc(query.limit!), 1), 500)
      : 100;
    const rows = await qb
      .orderBy('l.timestamp', 'DESC')
      .addOrderBy('l.id', 'DESC')
      .skip(offset)
      .take(limit)
      .getMany();
    return rows.map(rowToEntry);
  }

  async queryCount(query: LogsQuery): Promise<number> {
    // Count the complete filtered result, independent of cursor and pagination.
    return this.filteredQuery(query).getCount();
  }
}
