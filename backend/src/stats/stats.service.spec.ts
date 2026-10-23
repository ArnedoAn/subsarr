import { DataSource, Repository } from 'typeorm';
import { JobSnapshotEntity } from '../database/entities/job-snapshot.entity';
import { TokenUsageService } from '../settings/token-usage.service';
import { JobsService } from '../jobs/jobs.service';
import { LibraryService } from '../library/library.service';
import { StatsService } from './stats.service';

describe('StatsService SQL aggregation', () => {
  let database: DataSource;
  let repository: Repository<JobSnapshotEntity>;
  const now = Date.parse('2026-10-23T12:00:00Z');
  let service: StatsService;
  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(now);
    database = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [JobSnapshotEntity],
      synchronize: true,
    });
    await database.initialize();
    repository = database.getRepository(JobSnapshotEntity);
    service = new StatsService(
      repository,
      {
        getSummary: jest.fn().mockResolvedValue({}),
        getDailyTokenSeries: jest.fn().mockResolvedValue([]),
      } as unknown as TokenUsageService,
      {
        getQueueHealth: jest
          .fn()
          .mockResolvedValue({ ok: false, error: 'Redis unavailable' }),
      } as unknown as JobsService,
      {
        getCachedItemCount: jest.fn().mockReturnValue(4),
        getScanStatus: jest.fn().mockReturnValue({ state: 'idle' }),
      } as unknown as LibraryService,
    );
  });
  afterEach(async () => {
    if (database?.isInitialized) await database.destroy();
    jest.restoreAllMocks();
  });
  const insert = async (id: string, state: string, finishedAt: number) =>
    repository.insert({
      id,
      state,
      finishedAt,
      createdAt: finishedAt - 1000,
      dataJson: '{}',
      progress: 100,
      logsJson: '[]',
    });

  it('returns numeric zeros on an empty archive and preserves queue failures', async () => {
    const result = await service.getDashboardStats();
    expect(result).toMatchObject({
      jobsByState: {},
      jobsSummary: {
        archiveTotal: 0,
        today: { completed: 0, failed: 0, cancelled: 0, total: 0 },
        week: { completed: 0, failed: 0, cancelled: 0, total: 0 },
      },
      queue: { ok: false, error: 'Redis unavailable' },
    });
  });

  it('aggregates UTC days and inclusive rolling boundaries without loading snapshot payloads', async () => {
    const midnight = Date.parse('2026-10-23T00:00:00Z');
    const week = now - 7 * 86400000;
    await insert('today', 'completed', midnight);
    await insert('yesterday', 'failed', midnight - 1);
    await insert('week-boundary', 'cancelled', week);
    await insert('outside-week', 'failed', week - 1);
    await insert('old', 'completed', now - 40 * 86400000);
    const find = jest.spyOn(repository, 'find');
    const result = await service.getDashboardStats();
    expect(result).toMatchObject({
      jobsByState: { completed: 2, failed: 2, cancelled: 1 },
      jobsSummary: {
        archiveTotal: 5,
        today: { completed: 1, failed: 0, cancelled: 0, total: 1 },
        week: { completed: 1, failed: 1, cancelled: 1, total: 3 },
      },
    });
    expect(result).toHaveProperty('jobsByDay.length', 31);
    expect(result).toHaveProperty('jobsByDay.30', {
      date: '2026-10-23',
      completed: 1,
      failed: 0,
      cancelled: 0,
    });
    expect(result).toHaveProperty('jobsByDay.29', {
      date: '2026-10-22',
      completed: 0,
      failed: 1,
      cancelled: 0,
    });
    expect(find).not.toHaveBeenCalled();
  });

  it('reuses the bounded cache and refreshes after expiration', async () => {
    const first = await service.getDashboardStats();
    await insert('new', 'completed', now);
    expect(await service.getDashboardStats()).toBe(first);
    jest.mocked(Date.now).mockReturnValue(now + 30001);
    expect(await service.getDashboardStats()).toMatchObject({
      jobsSummary: { archiveTotal: 1 },
    });
  });
});
