import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { JobSnapshotEntity } from '../database/entities/job-snapshot.entity';
import { TokenUsageService } from '../settings/token-usage.service';
import { JobsService } from '../jobs/jobs.service';
import { LibraryService } from '../library/library.service';

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(JobSnapshotEntity)
    private readonly snapshotRepo: Repository<JobSnapshotEntity>,
    private readonly tokenUsageService: TokenUsageService,
    private readonly jobsService: JobsService,
    private readonly libraryService: LibraryService,
  ) {}

  async getDashboardStats() {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const weekStartMs = now - 7 * 24 * 60 * 60 * 1000;
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const todayStartMs = dayStart.getTime();

    const allForState = await this.snapshotRepo.find({ select: ['state'] });
    const jobsByState: Record<string, number> = {};
    for (const row of allForState) {
      jobsByState[row.state] = (jobsByState[row.state] ?? 0) + 1;
    }

    const [recent, todaySnaps, weekSnaps] = await Promise.all([
      this.snapshotRepo.find({
        where: { finishedAt: MoreThanOrEqual(thirtyDaysAgo) },
        select: ['finishedAt', 'state'],
      }),
      this.snapshotRepo.find({
        where: { finishedAt: MoreThanOrEqual(todayStartMs) },
        select: ['state'],
      }),
      this.snapshotRepo.find({
        where: { finishedAt: MoreThanOrEqual(weekStartMs) },
        select: ['state'],
      }),
    ]);

    const countStates = (rows: { state: string }[]) => {
      let completed = 0;
      let failed = 0;
      let cancelled = 0;
      for (const r of rows) {
        if (r.state === 'completed') {
          completed += 1;
        } else if (r.state === 'failed') {
          failed += 1;
        } else if (r.state === 'cancelled') {
          cancelled += 1;
        }
      }
      return {
        completed,
        failed,
        cancelled,
        total: rows.length,
      };
    };

    const dayMap = new Map<
      string,
      { completed: number; failed: number; cancelled: number }
    >();
    const endDay = new Date();
    const startDay = new Date(thirtyDaysAgo);
    for (
      let d = new Date(startDay);
      d <= endDay;
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      dayMap.set(d.toISOString().slice(0, 10), {
        completed: 0,
        failed: 0,
        cancelled: 0,
      });
    }
    for (const row of recent) {
      const key = dayKey(row.finishedAt);
      const bucket = dayMap.get(key);
      if (!bucket) {
        continue;
      }
      if (row.state === 'completed') {
        bucket.completed += 1;
      } else if (row.state === 'failed') {
        bucket.failed += 1;
      } else if (row.state === 'cancelled') {
        bucket.cancelled += 1;
      }
    }
    const jobsByDay = [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));

    const [tokenSummary, tokensByDay, queueHealth, library] = await Promise.all(
      [
        this.tokenUsageService.getSummary(),
        this.tokenUsageService.getDailyTokenSeries(30),
        this.jobsService.getQueueHealth(),
        Promise.resolve(this.libraryService.getCachedItemCount()),
      ],
    );
    const scanStatus = this.libraryService.getScanStatus();

    const mem = process.memoryUsage();

    return {
      libraryItemCount: library,
      libraryScan: scanStatus,
      jobsByState,
      jobsSummary: {
        today: countStates(todaySnaps),
        week: countStates(weekSnaps),
        archiveTotal: allForState.length,
      },
      jobsByDay,
      tokensByDay,
      tokenUsage: tokenSummary,
      queue: queueHealth,
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
      },
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
