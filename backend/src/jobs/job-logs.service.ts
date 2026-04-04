import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { JobArchiveService } from './job-archive.service';

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
}

const MAX_GLOBAL_LOGS = 5000;
const MAX_JOB_LOGS = 500;

@Injectable()
export class JobLogsService implements OnModuleInit {
  private readonly logger = new Logger('JobLogs');
  private readonly logsByJob = new Map<string, JobLogEntry[]>();
  private readonly globalLogs: JobLogEntry[] = [];

  constructor(private readonly jobArchiveService: JobArchiveService) {}

  async onModuleInit(): Promise<void> {
    try {
      const snaps = await this.jobArchiveService.readSnapshots();
      const seenIds = new Set<string>();
      const sorted = [...snaps].sort((a, b) => a.finishedAt - b.finishedAt);
      for (const snap of sorted) {
        for (const log of snap.logs ?? []) {
          if (!log?.id || seenIds.has(log.id)) {
            continue;
          }
          seenIds.add(log.id);
          this.ingestFromArchive(log);
        }
      }
      if (seenIds.size > 0) {
        this.logger.log(
          `Rehydrated ${seenIds.size} log entries from job archive`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `Log rehydration skipped: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  private ingestFromArchive(log: JobLogEntry): void {
    this.globalLogs.push(log);
    if (this.globalLogs.length > MAX_GLOBAL_LOGS) {
      this.globalLogs.shift();
    }
    if (log.jobId) {
      const existing = this.logsByJob.get(log.jobId) ?? [];
      existing.push(log);
      if (existing.length > MAX_JOB_LOGS) {
        existing.shift();
      }
      this.logsByJob.set(log.jobId, existing);
    }
  }

  append(input: Omit<JobLogEntry, 'id' | 'timestamp'>): JobLogEntry {
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

    this.globalLogs.push(log);
    if (this.globalLogs.length > MAX_GLOBAL_LOGS) {
      this.globalLogs.shift();
    }

    if (log.jobId) {
      const existing = this.logsByJob.get(log.jobId) ?? [];
      existing.push(log);
      if (existing.length > MAX_JOB_LOGS) {
        existing.shift();
      }
      this.logsByJob.set(log.jobId, existing);
    }

    return log;
  }

  getByJob(jobId: string): JobLogEntry[] {
    return [...(this.logsByJob.get(jobId) ?? [])].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );
  }

  query(query: LogsQuery): JobLogEntry[] {
    const from = query.from ? Date.parse(query.from) : Number.NEGATIVE_INFINITY;
    const to = query.to ? Date.parse(query.to) : Number.POSITIVE_INFINITY;

    return this.globalLogs
      .filter((entry) => (query.level ? entry.level === query.level : true))
      .filter((entry) => (query.jobId ? entry.jobId === query.jobId : true))
      .filter((entry) => {
        if (!query.search) {
          return true;
        }

        const search = query.search.toLowerCase();
        return (
          entry.message.toLowerCase().includes(search) ||
          entry.phase.toLowerCase().includes(search)
        );
      })
      .filter((entry) => {
        const timestamp = Date.parse(entry.timestamp);
        return timestamp >= from && timestamp <= to;
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }
}
