import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobSnapshotEntity } from '../database/entities/job-snapshot.entity';
import { TokenUsageService } from '../settings/token-usage.service';
import { JobsService } from '../jobs/jobs.service';
import { LibraryService } from '../library/library.service';

const STATS_CACHE_TTL_MS = 30_000;

@Injectable()
export class StatsService {
  private statsCache: { data: object; expiresAt: number } | null = null;

  constructor(
    @InjectRepository(JobSnapshotEntity)
    private readonly snapshotRepo: Repository<JobSnapshotEntity>,
    private readonly tokenUsageService: TokenUsageService,
    private readonly jobsService: JobsService,
    private readonly libraryService: LibraryService,
  ) {}

  async getDashboardStats() {
    const now = Date.now();
    if (this.statsCache && this.statsCache.expiresAt > now) {
      return this.statsCache.data;
    }
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const weekStartMs = now - 7 * 24 * 60 * 60 * 1000;
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const todayStartMs = dayStart.getTime();

    const [stateCounts, summaries, dailyCounts] = await Promise.all([
      this.snapshotRepo
        .createQueryBuilder('snapshot')
        .select('snapshot.state', 'state')
        .addSelect('COUNT(*)', 'count')
        .groupBy('snapshot.state')
        .getRawMany<{ state: string; count: number | string }>(),
      this.snapshotRepo
        .createQueryBuilder('snapshot')
        .select('COUNT(*)', 'total')
        .addSelect(
          'SUM(CASE WHEN snapshot.finishedAt >= :today THEN 1 ELSE 0 END)',
          'todayTotal',
        )
        .addSelect(
          'SUM(CASE WHEN snapshot.finishedAt >= :today AND snapshot.state = :completed THEN 1 ELSE 0 END)',
          'todayCompleted',
        )
        .addSelect(
          'SUM(CASE WHEN snapshot.finishedAt >= :today AND snapshot.state = :failed THEN 1 ELSE 0 END)',
          'todayFailed',
        )
        .addSelect(
          'SUM(CASE WHEN snapshot.finishedAt >= :today AND snapshot.state = :cancelled THEN 1 ELSE 0 END)',
          'todayCancelled',
        )
        .addSelect(
          'SUM(CASE WHEN snapshot.finishedAt >= :week THEN 1 ELSE 0 END)',
          'weekTotal',
        )
        .addSelect(
          'SUM(CASE WHEN snapshot.finishedAt >= :week AND snapshot.state = :completed THEN 1 ELSE 0 END)',
          'weekCompleted',
        )
        .addSelect(
          'SUM(CASE WHEN snapshot.finishedAt >= :week AND snapshot.state = :failed THEN 1 ELSE 0 END)',
          'weekFailed',
        )
        .addSelect(
          'SUM(CASE WHEN snapshot.finishedAt >= :week AND snapshot.state = :cancelled THEN 1 ELSE 0 END)',
          'weekCancelled',
        )
        .setParameters({
          today: todayStartMs,
          week: weekStartMs,
          completed: 'completed',
          failed: 'failed',
          cancelled: 'cancelled',
        })
        .getRawOne<Record<string, number | string | null>>(),
      this.snapshotRepo
        .createQueryBuilder('snapshot')
        .select("date(snapshot.finishedAt / 1000, 'unixepoch')", 'date')
        .addSelect('snapshot.state', 'state')
        .addSelect('COUNT(*)', 'count')
        .where('snapshot.finishedAt >= :start', { start: thirtyDaysAgo })
        .groupBy("date(snapshot.finishedAt / 1000, 'unixepoch')")
        .addGroupBy('snapshot.state')
        .getRawMany<{ date: string; state: string; count: number | string }>(),
    ]);
    const jobsByState = Object.fromEntries(
      stateCounts.map((row) => [row.state, Number(row.count)]),
    );
    const summary = (prefix: 'today' | 'week') => ({
      completed: Number(summaries?.[`${prefix}Completed`] ?? 0),
      failed: Number(summaries?.[`${prefix}Failed`] ?? 0),
      cancelled: Number(summaries?.[`${prefix}Cancelled`] ?? 0),
      total: Number(summaries?.[`${prefix}Total`] ?? 0),
    });

    const dayMap = new Map<
      string,
      { completed: number; failed: number; cancelled: number }
    >();
    const endDay = new Date(now);
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
    for (const row of dailyCounts) {
      const bucket = dayMap.get(row.date);
      if (
        bucket &&
        (row.state === 'completed' ||
          row.state === 'failed' ||
          row.state === 'cancelled')
      ) {
        bucket[row.state] = Number(row.count);
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

    const result = {
      libraryItemCount: library,
      libraryScan: scanStatus,
      jobsByState,
      jobsSummary: {
        today: summary('today'),
        week: summary('week'),
        archiveTotal: Number(summaries?.total ?? 0),
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
    this.statsCache = {
      data: result,
      expiresAt: Date.now() + STATS_CACHE_TTL_MS,
    };
    return result;
  }
}
