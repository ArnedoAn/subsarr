import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as path from 'node:path';
import { LibraryScanRunEntity } from './scan-run.entity';
import type { LibraryScanPage, LibraryScanRun } from './scan-history.types';

@Injectable()
export class ScanHistoryService {
  constructor(
    @InjectRepository(LibraryScanRunEntity)
    private readonly repository: Repository<LibraryScanRunEntity>,
  ) {}

  async record(report: LibraryScanRun): Promise<void> {
    const bounded = {
      ...report,
      error: report.error?.slice(0, 4096) ?? null,
      failures: report.failures.slice(0, 50),
      slowFiles: report.slowFiles.slice(0, 20),
    };
    await this.repository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(LibraryScanRunEntity);
      await repository.save({
        id: report.id,
        startedAt: report.startedAt,
        reportJson: JSON.stringify(bounded),
      });
      const expired = await repository.find({
        order: { startedAt: 'DESC', id: 'DESC' },
        skip: 100,
        select: { id: true },
      });
      if (expired.length) await repository.delete(expired.map((row) => row.id));
    });
  }

  async list(offset = 0, limit = 20): Promise<LibraryScanPage> {
    const [rows, total] = await this.repository.findAndCount({
      order: { startedAt: 'DESC', id: 'DESC' },
      skip: offset,
      take: limit,
    });
    return {
      items: rows.map((row) => JSON.parse(row.reportJson) as LibraryScanRun),
      total,
      offset,
      limit,
    };
  }

  async get(id: string): Promise<LibraryScanRun> {
    const row = await this.repository.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Scan run not found');
    return JSON.parse(row.reportJson) as LibraryScanRun;
  }

  async export(id: string, redact = true): Promise<LibraryScanRun> {
    const report = await this.get(id);
    if (!redact) return report;
    // Freeform errors can embed arbitrary paths (including stderr). Omit their
    // text in safe exports rather than attempting an incomplete path regex.
    report.error = report.error ? 'Scan failed (details redacted)' : null;
    report.failures = report.failures.map((failure) => ({
      event: failure.event,
      ...(failure.path
        ? { path: path.win32.basename(path.posix.basename(failure.path)) }
        : {}),
      ...(failure.error ? { error: 'Details redacted' } : {}),
    }));
    report.metrics.roots = report.metrics.roots.map((root) => ({
      ...root,
      path: path.win32.basename(path.posix.basename(root.path)),
    }));
    report.slowFiles = report.slowFiles.map((file) => ({
      ...file,
      path: path.win32.basename(path.posix.basename(file.path)),
    }));
    report.watcher.errors = report.watcher.errors.map(() => 'Details redacted');
    if (report.metrics.watcher) {
      report.metrics.watcher.errors = report.metrics.watcher.errors.map(
        () => 'Details redacted',
      );
    }
    return report;
  }
}
