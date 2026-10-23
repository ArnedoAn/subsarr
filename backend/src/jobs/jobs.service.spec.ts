jest.mock('../settings/settings.service', () => ({
  SettingsService: class {},
}));
jest.mock('../settings/token-usage.service', () => ({
  TokenUsageService: class {},
}));
jest.mock('../library/library.service', () => ({ LibraryService: class {} }));
jest.mock('../rules/rules.service', () => ({ RulesService: class {} }));
jest.mock('../output/output.service', () => ({ OutputService: class {} }));
jest.mock('../profiles/profiles.service', () => ({
  ProfilesService: class {},
}));

import { ConflictException } from '@nestjs/common';
import { JobsService } from './jobs.service';
import type { CreateJobDto } from './dto/create-job.dto';
import type { JobLogEntry } from './job-logs.service';

function fixture() {
  const redis = new Map<string, string>();
  const stored = new Map<
    string,
    {
      id: string;
      data: unknown;
      getState: jest.Mock<Promise<string>, []>;
      remove: jest.Mock<Promise<void>, []>;
    }
  >();
  const client = {
    set: jest.fn((key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && redis.has(key)) return Promise.resolve(null);
      redis.set(key, value);
      return Promise.resolve('OK');
    }),
    get: jest.fn((key: string) => Promise.resolve(redis.get(key) ?? null)),
    eval: jest.fn(
      (_script: string, _count: number, key: string, token: string) => {
        if (redis.get(key) === token) redis.delete(key);
        return Promise.resolve(1);
      },
    ),
  };
  const queue = {
    client,
    toKey: (key: string) => `translation:${key}`,
    getJob: jest.fn((id: string) => Promise.resolve(stored.get(id))),
    add: jest.fn((data: unknown, opts: { jobId: string }) => {
      const job = {
        id: opts.jobId,
        data,
        getState: jest.fn<Promise<string>, []>().mockResolvedValue('waiting'),
        remove: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
      };
      stored.set(job.id, job);
      return Promise.resolve(job);
    }),
  };
  const cancellation = {
    clear: jest.fn(),
    request: jest.fn(),
    isRequested: jest.fn().mockResolvedValue(false),
  };
  const archive = {
    appendSnapshot: jest.fn(),
    getSnapshot: jest.fn(),
    readSnapshots: jest.fn().mockResolvedValue([]),
  };
  const events = { publish: jest.fn(), complete: jest.fn() };
  const settings = {
    getSettings: jest.fn().mockResolvedValue({}),
    assertTranslationBudget: jest.fn(),
  };
  const logs = {
    append: jest.fn(),
    getByJob: jest.fn<Promise<JobLogEntry[]>, [string]>().mockResolvedValue([]),
  };
  const dependencies = [
    queue,
    { buildSubtitlePath: () => '/media/title.spa.srt' },
    {
      getById: jest.fn().mockResolvedValue({
        id: 'media',
        path: '/media/title.mkv',
        subtitleTracks: [{ index: 2, language: 'eng', codec: 'subrip' }],
      }),
    },
    { evaluate: jest.fn().mockResolvedValue({ skip: false }) },
    logs,
    archive,
    settings,
    { getTodayTotals: jest.fn().mockResolvedValue({ free: 0, paid: 0 }) },
    { list: jest.fn().mockResolvedValue([]) },
    cancellation,
    events,
  ];
  const service = Reflect.construct(JobsService, dependencies) as JobsService;
  const dto: CreateJobDto = {
    mediaItemId: 'media',
    sourceLanguage: 'eng',
    targetLanguage: 'spa',
    sourceTrackIndex: 2,
    triggeredBy: 'manual',
    respectProfiles: false,
  };
  return {
    service,
    queue,
    stored,
    cancellation,
    archive,
    events,
    settings,
    dto,
    logs,
  };
}

describe('JobsService historical log reads', () => {
  it('exposes archive-only history and merges canonical entries without duplicate ids', async () => {
    const { service, archive, logs } = fixture();
    const legacy: JobLogEntry = {
      id: 'legacy-only',
      jobId: 'legacy-job',
      level: 'warn',
      phase: 'verification',
      message: 'Imported warning',
      timestamp: '2025-02-01T00:00:00.000Z',
      details: { line: 3 },
    };
    const canonical: JobLogEntry = {
      ...legacy,
      id: 'canonical',
      message: 'Canonical entry',
      timestamp: '2025-02-02T00:00:00.000Z',
    };
    archive.getSnapshot.mockResolvedValue({ logs: [legacy, canonical] });
    logs.getByJob.mockResolvedValue([canonical]);
    await expect(service.getLogsByJob('legacy-job')).resolves.toEqual([
      legacy,
      canonical,
    ]);
  });
});

describe('JobsService output claims and cooperative cancellation', () => {
  it('permits one enqueue when simultaneous requests target the same output', async () => {
    const { service, dto, queue } = fixture();
    const results = await Promise.allSettled([
      service.enqueue(dto),
      service.enqueue(dto),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
    const rejected = results.find(
      (result) => result.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
  });
  it.each(['waiting', 'active', 'delayed', 'paused'])(
    'does not replace a %s output owner',
    async (state) => {
      const { service, dto, stored, queue } = fixture();
      await service.enqueue(dto);
      const previous = [...stored.values()][0];
      previous.getState.mockResolvedValue(state);
      await expect(service.enqueue(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(previous.remove).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledTimes(1);
    },
  );
  it('creates a new attempt without deleting previous terminal work', async () => {
    const { service, dto, stored, queue } = fixture();
    await service.enqueue(dto);
    const previous = [...stored.values()][0];
    previous.getState.mockResolvedValue('completed');
    await service.enqueue(dto);
    expect(stored.size).toBe(2);
    expect(previous.remove).not.toHaveBeenCalled();
    expect(queue.add.mock.calls[0][1].jobId).not.toBe(
      queue.add.mock.calls[1][1].jobId,
    );
  });
  it('signals active cancellation without failing, removing, or archiving a running job', async () => {
    const { service, dto, stored, cancellation, archive } = fixture();
    await service.enqueue(dto);
    const job = [...stored.values()][0];
    job.getState.mockResolvedValue('active');
    Object.assign(job, { progress: () => 42, moveToFailed: jest.fn() });
    await expect(service.cancel(job.id)).resolves.toMatchObject({
      state: 'cancelling',
      canceled: false,
    });
    expect(cancellation.request).toHaveBeenCalledWith(job.id);
    expect(job.remove).not.toHaveBeenCalled();
    expect(archive.appendSnapshot).not.toHaveBeenCalled();
  });
  it('handles waiting-to-active removal races as cancelling, not cancelled', async () => {
    const { service, dto, stored, archive } = fixture();
    await service.enqueue(dto);
    const job = [...stored.values()][0];
    job.getState.mockResolvedValueOnce('waiting').mockResolvedValue('active');
    job.remove.mockRejectedValue(new Error('locked'));
    Object.assign(job, { progress: () => 10 });
    await expect(service.cancel(job.id)).resolves.toMatchObject({
      state: 'cancelling',
    });
    expect(archive.appendSnapshot).not.toHaveBeenCalled();
  });
  it('changes priority atomically without removing or replacing the queued attempt', async () => {
    const { service, dto, queue, stored } = fixture();
    await service.enqueue(dto);
    const job = [...stored.values()][0];
    await expect(service.setJobPriority(job.id, 1)).resolves.toMatchObject({
      id: job.id,
      priority: 1,
    });
    expect(job.remove).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.client.eval).toHaveBeenLastCalledWith(
      expect.stringContaining('opts.priority'),
      6,
      `translation:${job.id}`,
      'translation:active',
      'translation:wait',
      'translation:paused',
      'translation:delayed',
      'translation:priority',
      job.id,
      1,
    );
    expect(queue.client.eval.mock.calls.at(-1)?.[0]).toContain(
      "redis.call('HSET',KEYS[1],'priority',ARGV[2])",
    );
  });
  it('resumes the same deterministic reservation after enqueue connection failure', async () => {
    const { service, dto, queue } = fixture();
    queue.add.mockRejectedValueOnce(new Error('connection dropped'));
    await expect(service.enqueue(dto)).rejects.toThrow('connection dropped');
    await service.enqueue(dto);
    expect(queue.add.mock.calls[1][1].jobId).toBe(
      queue.add.mock.calls[0][1].jobId,
    );
  });
  it('resets a pruned cancelled ID under the enqueue lease before insertion', async () => {
    const { service, dto, stored, cancellation, queue } = fixture();
    await service.enqueue(dto);
    const oldId = [...stored.keys()][0];
    stored.clear();
    cancellation.clear.mockClear();
    queue.add.mockClear();
    await service.enqueue(dto);
    expect(queue.add.mock.calls[0][1].jobId).toBe(oldId);
    expect(cancellation.clear).toHaveBeenCalledWith(oldId);
    expect(cancellation.clear.mock.invocationCallOrder[0]).toBeLessThan(
      queue.add.mock.invocationCallOrder[0],
    );
  });
  it('rejects cancellation of a terminal failure without rewriting its failure history', async () => {
    const { service, dto, stored, cancellation, archive } = fixture();
    await service.enqueue(dto);
    const job = [...stored.values()][0];
    job.getState.mockResolvedValue('failed');
    await expect(service.cancel(job.id)).rejects.toThrow(
      'Cannot cancel job in state: failed',
    );
    expect(cancellation.request).not.toHaveBeenCalled();
    expect(job.remove).not.toHaveBeenCalled();
    expect(archive.appendSnapshot).not.toHaveBeenCalled();
  });
  it('rejects oversized batches before checking any media or adding work', async () => {
    const { service, queue } = fixture();
    await expect(
      service.previewBatch({
        sourceLanguage: 'eng',
        targetLanguage: 'spa',
        forceBypassRules: false,
        items: Array.from({ length: 501 }, () => ({ mediaItemId: 'media' })),
      }),
    ).rejects.toThrow('1 to 500');
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('passes explicit manual budget consent and blocks before claiming output', async () => {
    const { service, dto, settings, queue } = fixture();
    settings.assertTranslationBudget.mockRejectedValue(
      new ConflictException('Budget exceeded'),
    );
    await expect(
      service.enqueue({ ...dto, allowBudgetOverride: true }),
    ).rejects.toThrow('Budget exceeded');
    expect(settings.assertTranslationBudget).toHaveBeenCalledWith({
      provider: undefined,
      automatic: false,
      allowBudgetOverride: true,
    });
    expect(queue.add).not.toHaveBeenCalled();
  });
});
