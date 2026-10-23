import { BadRequestException, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { JobLogRowEntity } from '../database/entities/job-log.entity';
import { LogsQueryDto } from './dto/logs-query.dto';
import { encodeLogCursor, JobLogsService } from './job-logs.service';

describe('JobLogsService SQL queries and retention', () => {
  let source: DataSource;
  let repository: Repository<JobLogRowEntity>;
  let service: JobLogsService;
  let now: number;

  beforeEach(async () => {
    now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    source = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [JobLogRowEntity],
      synchronize: true,
    });
    await source.initialize();
    repository = source.getRepository(JobLogRowEntity);
    service = new JobLogsService(repository);
  });

  afterEach(async () => {
    if (source?.isInitialized) await source.destroy();
    jest.restoreAllMocks();
  });

  async function seed(rows: Partial<JobLogRowEntity>[]): Promise<void> {
    await repository.save(
      rows.map((row) =>
        repository.create({
          jobId: 'job-a',
          level: 'info',
          phase: 'translating',
          message: 'Translation running',
          detailsJson: null,
          timestamp: new Date(now).toISOString(),
          ...row,
        }),
      ),
    );
  }

  it('applies inclusive SQL date bounds and all filters before offset and limit', async () => {
    const from = new Date(now - 3000).toISOString();
    const to = new Date(now - 1000).toISOString();
    await seed([
      { id: 'new', timestamp: new Date(now).toISOString(), level: 'warn' },
      { id: 'a', timestamp: from, level: 'warn' },
      { id: 'b', timestamp: new Date(now - 2000).toISOString(), level: 'warn' },
      { id: 'c', timestamp: to, level: 'warn' },
      {
        id: 'old',
        timestamp: new Date(now - 4000).toISOString(),
        level: 'warn',
      },
      { id: 'wrong-level', timestamp: to },
      { id: 'wrong-job', timestamp: to, level: 'warn', jobId: 'job-b' },
      {
        id: 'wrong-search',
        timestamp: to,
        level: 'warn',
        message: 'Other',
        phase: 'Other',
      },
    ]);
    const query = {
      level: 'warn' as const,
      jobId: 'job-a',
      q: 'TRANSLATION',
      from,
      to,
      limit: 1,
      offset: 1,
    };
    expect((await service.query(query)).map((row) => row.id)).toEqual(['b']);
    expect(
      await service.queryCount({ ...query, cursor: 'not used by counts' }),
    ).toBe(3);
  });

  it('supports search alias, phase matches, and literal SQL wildcard characters', async () => {
    await seed([
      { id: 'literal', message: 'Progress 50%_\\done' },
      { id: 'wildcard', message: 'Progress 50000done' },
      { id: 'phase', phase: 'EXTRACTING', message: 'Started' },
    ]);
    expect(
      (await service.query({ search: '50%_\\' })).map((row) => row.id),
    ).toEqual(['literal']);
    expect(
      (await service.query({ q: 'extracting' })).map((row) => row.id),
    ).toEqual(['phase']);
    expect(await service.queryCount({ search: 'extracting' })).toBe(1);
    expect(
      (await service.query({ q: 'extracting', search: 'missing' })).map(
        (row) => row.id,
      ),
    ).toEqual(['phase']);
  });

  it('uses timestamp and ID keysets without skipping equal-time rows or new inserts', async () => {
    await seed(['a', 'b', 'c', 'd', 'e'].map((id) => ({ id })));
    const first = await service.query({ limit: 2 });
    expect(first.map((row) => row.id)).toEqual(['e', 'd']);
    await seed([{ id: 'z', timestamp: new Date(now + 1000).toISOString() }]);
    const cursor = encodeLogCursor(first[1]);
    const second = await service.query({ limit: 2, cursor });
    const third = await service.query({
      limit: 2,
      cursor: encodeLogCursor(second[1]),
    });
    expect(second.map((row) => row.id)).toEqual(['c', 'b']);
    expect(third.map((row) => row.id)).toEqual(['a']);
    expect(await service.queryCount({ cursor, limit: 2, offset: 100 })).toBe(6);
    await expect(service.query({ cursor: 'invalid' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.query({
        cursor: Buffer.from('["bad-date","id"]').toString('base64url'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('caps queries and per-job history, retaining the newest job rows in ascending order', async () => {
    await seed(
      Array.from({ length: 510 }, (_, index) => ({
        id: String(index).padStart(4, '0'),
      })),
    );
    expect(await service.query({})).toHaveLength(100);
    expect(await service.query({ limit: 10000 })).toHaveLength(500);
    const history = await service.getByJob('job-a');
    expect(history).toHaveLength(500);
    expect(history[0].id).toBe('0010');
    expect(history[499].id).toBe('0509');
    expect(await service.getByJob('missing')).toEqual([]);
  });

  it('counts in SQL without materializing matching log entities', async () => {
    await seed([{ id: 'one' }, { id: 'two' }]);
    const getMany = jest.spyOn(SelectQueryBuilder.prototype, 'getMany');
    expect(await service.queryCount({})).toBe(2);
    expect(getMany).not.toHaveBeenCalled();
  });

  it('prunes old logs of every level including system rows at startup', async () => {
    const cutoff = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    await seed([
      {
        id: 'old-info',
        jobId: null,
        timestamp: new Date(Date.parse(cutoff) - 1).toISOString(),
      },
      {
        id: 'old-warn',
        level: 'warn',
        timestamp: new Date(Date.parse(cutoff) - 1).toISOString(),
      },
      {
        id: 'old-error',
        level: 'error',
        jobId: null,
        timestamp: new Date(Date.parse(cutoff) - 1).toISOString(),
      },
      { id: 'at-cutoff', jobId: null, timestamp: cutoff },
      { id: 'recent', jobId: null },
    ]);
    await service.onModuleInit();
    expect((await service.query({})).map((row) => row.id)).toEqual([
      'recent',
      'at-cutoff',
    ]);
  });

  it('enforces the global 50000-row cap with a deterministic tie-break including system rows', async () => {
    await repository.query(
      `WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 50002)
       INSERT INTO job_logs (id, jobId, level, phase, message, detailsJson, timestamp)
       SELECT printf('%06d', n), CASE WHEN n % 2 = 0 THEN NULL ELSE 'job-a' END,
       'info', 'test', 'retention', NULL, ? FROM numbers`,
      [new Date(now).toISOString()],
    );
    await service.onModuleInit();
    expect(await repository.count()).toBe(50000);
    expect(await repository.findOneBy({ id: '000001' })).toBeNull();
    expect(await repository.findOneBy({ id: '000002' })).toBeNull();
    expect(await repository.findOneBy({ id: '050002' })).not.toBeNull();
  });

  it('throttles append maintenance but runs again after elapsed time or 500 writes without timers', async () => {
    const maintenance = jest.spyOn(repository, 'query');
    await service.onModuleInit();
    for (let index = 0; index < 499; index += 1) {
      await service.append({
        level: 'info',
        phase: 'test',
        message: 'system event',
      });
    }
    expect(maintenance).toHaveBeenCalledTimes(1);
    await service.append({
      level: 'warn',
      phase: 'test',
      message: '500th event',
    });
    expect(maintenance).toHaveBeenCalledTimes(2);
    await seed([
      {
        id: 'expired-system',
        jobId: null,
        timestamp: new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ]);
    now += 60_001;
    await service.append({
      level: 'error',
      phase: 'test',
      message: 'time-triggered maintenance',
    });
    expect(maintenance).toHaveBeenCalledTimes(3);
    expect(await repository.findOneBy({ id: 'expired-system' })).toBeNull();
  });

  it('transforms and validates HTTP pagination while accepting q and search', async () => {
    const valid = plainToInstance(LogsQueryDto, {
      q: 'text',
      search: 'alias',
      limit: '500',
      offset: '12',
    });
    expect(await validate(valid)).toEqual([]);
    expect(valid.limit).toBe(500);
    expect(valid.offset).toBe(12);
    for (const input of [
      { limit: 501 },
      { limit: 0 },
      { offset: -1 },
      { offset: 1.5 },
    ]) {
      expect(
        (await validate(plainToInstance(LogsQueryDto, input))).length,
      ).toBeGreaterThan(0);
    }
  });
});
