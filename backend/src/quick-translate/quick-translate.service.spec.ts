/// <reference lib="es2024.promise" />
jest.mock('franc-min', () => ({ franc: jest.fn(() => 'spa') }));

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { QuickTranslateService } from './quick-translate.service';
import { QuickTranslateController } from './quick-translate.controller';
import { SubtitleTranslationService } from '../translation/subtitle-translation.service';
import { SettingsService } from '../settings/settings.service';
import { TokenUsageService } from '../settings/token-usage.service';
import { QUICK_LIMITS } from './quick-translate.internal';

const flush = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
};
const input = (name = 'episode.srt', size = 40) => ({
  originalname: name,
  buffer: Buffer.alloc(size, 'a'),
});
const options = { targetLanguage: 'spa', provider: 'deepseek' as const };
const translated = {
  content: 'translated subtitle',
  extension: 'srt' as const,
  cueCount: 1,
  warnings: [],
  usage: {},
  tierUsed: 'paid',
};

function fixture() {
  const documents = {
    inspectDocument: jest
      .fn()
      .mockReturnValue({ extension: 'srt', cueCount: 1 }),
    translateDocument: jest.fn().mockResolvedValue(translated),
  };
  const settings = {
    assertTranslationBudget: jest.fn().mockResolvedValue(undefined),
  };
  const usage = { addProviderUsage: jest.fn().mockResolvedValue(undefined) };
  const service = new QuickTranslateService(
    documents as unknown as SubtitleTranslationService,
    settings as unknown as SettingsService,
    usage as unknown as TokenUsageService,
  );
  return { service, documents, settings, usage };
}

describe('QuickTranslateService in-memory lifecycle', () => {
  const services: QuickTranslateService[] = [];
  function setup() {
    const f = fixture();
    services.push(f.service);
    return f;
  }
  afterEach(() => {
    for (const service of services.splice(0)) service.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns queued IDs without waiting for translation and makes duplicate submissions idempotent', async () => {
    const { service, documents } = setup();
    const first = await service.create(
      [input()],
      options,
      'request_unique_0001',
    );
    expect(first.files[0].state).toBe('queued');
    expect(documents.translateDocument).not.toHaveBeenCalled();
    const duplicate = await service.create(
      [input()],
      options,
      'request_unique_0001',
    );
    expect(duplicate.id).toBe(first.id);
    await flush();
    expect(documents.translateDocument).toHaveBeenCalledTimes(1);
    expect(service.requestSnapshot('request_unique_0001').files[0].state).toBe(
      'completed',
    );
  });

  it('deduplicates simultaneous accepted uploads across the asynchronous budget check', async () => {
    const { service, documents } = setup();
    const [first, second] = await Promise.all([
      service.create([input()], options, 'request_unique_0006'),
      service.create([input()], options, 'request_unique_0006'),
    ]);
    expect(first.id).toBe(second.id);
    await flush();
    expect(documents.translateDocument).toHaveBeenCalledTimes(1);
  });

  it('uses the shared document inspector before enqueue and rejects invalid content and hard input limits', async () => {
    const { service, documents } = setup();
    await expect(
      service.create(
        [input('huge.srt', QUICK_LIMITS.fileBytes + 1)],
        options,
        'request_unique_0002',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(
        Array.from({ length: 21 }, () => input()),
        options,
        'request_unique_0003',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(
        Array.from({ length: 11 }, () =>
          input('a.srt', QUICK_LIMITS.fileBytes),
        ),
        options,
        'request_unique_0004',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    documents.inspectDocument.mockImplementation(() => {
      throw new Error('More than 10000 cues');
    });
    await expect(
      service.create([input()], options, 'request_unique_0005'),
    ).rejects.toThrow('More than 10000 cues');
    expect(documents.translateDocument).not.toHaveBeenCalled();
  });

  it('bounds global pending bytes and releases cancelled queued input immediately', async () => {
    const { service } = setup();
    const files = Array.from({ length: 10 }, () =>
      input('a.srt', QUICK_LIMITS.fileBytes),
    );
    const first = await service.create(files, options, 'request_unique_0010');
    const second = await service.create(files, options, 'request_unique_0011');
    await expect(
      service.create([input()], options, 'request_unique_0012'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    service.cancel(first.id);
    const third = await service.create(
      [input()],
      options,
      'request_unique_0013',
    );
    expect(third.files[0].state).toBe('queued');
    service.cancel(second.id);
    service.cancel(third.id);
  });

  it('runs FIFO with one active file and never publishes a late result after cancellation', async () => {
    const { service, documents } = setup();
    const pending = Promise.withResolvers<typeof translated>();
    const release = pending.resolve;
    documents.translateDocument.mockImplementationOnce(() => pending.promise);
    const batch = await service.create(
      [input('first.srt'), input('second.srt')],
      options,
      'request_unique_0020',
    );
    await flush();
    expect(documents.translateDocument).toHaveBeenCalledTimes(1);
    const signal = (
      documents.translateDocument.mock.calls[0] as unknown as [
        Buffer,
        string,
        { signal: AbortSignal },
      ]
    )[2].signal;
    service.cancel(batch.id, batch.files[0].id);
    expect(signal.aborted).toBe(true);
    release(translated);
    await flush();
    const snapshot = service.snapshot(batch.id);
    expect(snapshot.files.map((file) => file.state)).toEqual([
      'cancelled',
      'completed',
    ]);
    expect(
      documents.translateDocument.mock.calls.map((call: unknown[]) => call[1]),
    ).toEqual(['first.srt', 'second.srt']);
    expect(() => service.download(batch.id, batch.files[0].id)).toThrow(
      ConflictException,
    );
  });

  it('expires completed results, completes subscribers and removes idempotency records', async () => {
    const { service, documents } = setup();
    const batch = await service.create(
      [input()],
      options,
      'request_unique_0030',
    );
    await flush();
    expect(
      service.download(batch.id, batch.files[0].id).content.toString(),
    ).toBe(translated.content);
    const complete = jest.fn();
    service.changes(batch.id).subscribe({ complete });
    const expiresAt = service.snapshot(batch.id).expiresAt;
    expect(expiresAt).not.toBeNull();
    service.expire(Date.parse(expiresAt!) + 1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(() => service.snapshot(batch.id)).toThrow(NotFoundException);
    expect(() => service.requestSnapshot('request_unique_0030')).toThrow(
      NotFoundException,
    );
    expect(documents.translateDocument).toHaveBeenCalledTimes(1);
  });

  it('creates cleanup timers only on initialization and clears heartbeat timers on disconnect', async () => {
    jest.useFakeTimers();
    const { service } = setup();
    expect(jest.getTimerCount()).toBe(0);
    service.onModuleInit();
    service.onModuleInit();
    expect(jest.getTimerCount()).toBe(1);
    const batch = await service.create(
      [input()],
      options,
      'request_unique_0040',
    );
    const controller = new QuickTranslateController(service);
    const events: unknown[] = [];
    const subscription = controller
      .events(batch.id)
      .subscribe((event) => events.push(event));
    expect(events).toHaveLength(1);
    jest.advanceTimersByTime(15_000);
    expect(events.length).toBeGreaterThan(1);
    subscription.unsubscribe();
    expect(jest.getTimerCount()).toBe(1);
    service.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('retries failed files only, enforces budget override and persists each response through onUsage', async () => {
    const { service, documents, settings, usage } = setup();
    const attempt = {
      provider: 'deepseek',
      model: 'deepseek-chat',
      tier: 'paid',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cacheHitTokens: 0,
      cacheMissTokens: 10,
    };
    documents.translateDocument.mockImplementationOnce(
      async (
        _buffer: Buffer,
        _name: string,
        opts: { onUsage: (value: unknown) => Promise<void> },
      ) => {
        await opts.onUsage(attempt);
        throw new Error('Rejected provider output');
      },
    );
    const batch = await service.create(
      [input('failed.srt'), input('ok.srt')],
      options,
      'request_unique_0050',
    );
    await flush();
    expect(usage.addProviderUsage).toHaveBeenCalledWith(attempt);
    expect(service.snapshot(batch.id).files.map((file) => file.state)).toEqual([
      'failed',
      'completed',
    ]);
    settings.assertTranslationBudget.mockRejectedValueOnce(
      new ConflictException('Budget exceeded'),
    );
    await expect(service.retry(batch.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await service.retry(batch.id, true);
    await flush();
    expect(documents.translateDocument).toHaveBeenCalledTimes(3);
    expect(
      service
        .snapshot(batch.id)
        .files.every((file) => file.state === 'completed'),
    ).toBe(true);
    expect(settings.assertTranslationBudget).toHaveBeenLastCalledWith({
      provider: 'deepseek',
      automatic: false,
      allowBudgetOverride: true,
    });
  });

  it('exposes fallback-time budget409 so a failed file can be retried with explicit manual consent', async () => {
    const { service, documents } = setup();
    documents.translateDocument.mockRejectedValueOnce(
      new ConflictException('Budget override required'),
    );
    const batch = await service.create(
      [input()],
      options,
      'request_unique_0055',
    );
    await flush();
    expect(service.snapshot(batch.id).files[0]).toMatchObject({
      state: 'failed',
      errorCode: 'BUDGET_OVERRIDE_REQUIRED',
    });
    await service.retry(batch.id, true);
    await flush();
    expect(documents.translateDocument).toHaveBeenLastCalledWith(
      expect.any(Buffer),
      'episode.srt',
      expect.objectContaining({ automatic: false, allowBudgetOverride: true }),
    );
    expect(service.snapshot(batch.id).files[0].state).toBe('completed');
  });

  it('keeps queued and translating work alive past one hour and starts retention at terminal completion', async () => {
    const { service, documents } = setup();
    const start = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(start);
    const pending = Promise.withResolvers<typeof translated>();
    documents.translateDocument.mockImplementationOnce(() => pending.promise);
    const batch = await service.create(
      [input('active.srt'), input('queued.srt')],
      options,
      'request_unique_0051',
    );
    expect(batch.expiresAt).toBeNull();
    await flush();
    const signal = (
      documents.translateDocument.mock.calls[0] as unknown as [
        Buffer,
        string,
        { signal: AbortSignal },
      ]
    )[2].signal;
    clock.mockReturnValue(start + 2 * QUICK_LIMITS.ttlMs);
    service.expire();
    expect(signal.aborted).toBe(false);
    expect(service.snapshot(batch.id).files.map((file) => file.state)).toEqual([
      'translating',
      'queued',
    ]);
    expect(service.snapshot(batch.id).expiresAt).toBeNull();
    pending.resolve(translated);
    await flush();
    const completed = service.snapshot(batch.id);
    expect(completed.files.every((file) => file.state === 'completed')).toBe(
      true,
    );
    expect(completed.expiresAt).toBe(
      new Date(start + 3 * QUICK_LIMITS.ttlMs).toISOString(),
    );
    service.expire(start + 3 * QUICK_LIMITS.ttlMs - 1);
    expect(service.snapshot(batch.id).files[0].state).toBe('completed');
    service.expire(start + 3 * QUICK_LIMITS.ttlMs);
    expect(() => service.snapshot(batch.id)).toThrow(NotFoundException);
  });

  it('aborts active work and completes streams on shutdown without starting queued files', async () => {
    const { service, documents } = setup();
    const pending = Promise.withResolvers<typeof translated>();
    documents.translateDocument.mockImplementationOnce(() => pending.promise);
    const batch = await service.create(
      [input('working.srt'), input('queued.srt')],
      options,
      'request_unique_0057',
    );
    await flush();
    const signal = (
      documents.translateDocument.mock.calls[0] as unknown as [
        Buffer,
        string,
        { signal: AbortSignal },
      ]
    )[2].signal;
    const complete = jest.fn();
    service.changes(batch.id).subscribe({ complete });
    service.onModuleDestroy();
    expect(signal.aborted).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(() => service.snapshot(batch.id)).toThrow(NotFoundException);
    pending.resolve(translated);
    await flush();
    expect(documents.translateDocument).toHaveBeenCalledTimes(1);
    await expect(
      service.create([input()], options, 'request_unique_0058'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('preserves existing batch budget consent and refreshes terminal retention after retry', async () => {
    const { service, documents, settings } = setup();
    const start = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(start);
    documents.translateDocument.mockRejectedValueOnce(
      new Error('Transient provider failure'),
    );
    const batch = await service.create(
      [input()],
      { ...options, allowBudgetOverride: true },
      'request_unique_0056',
    );
    await flush();
    expect(service.snapshot(batch.id).expiresAt).toBe(
      new Date(start + QUICK_LIMITS.ttlMs).toISOString(),
    );
    clock.mockReturnValue(start + QUICK_LIMITS.ttlMs - 1);
    const retried = await service.retry(batch.id);
    expect(retried.expiresAt).toBeNull();
    expect(settings.assertTranslationBudget).toHaveBeenLastCalledWith({
      provider: 'deepseek',
      automatic: false,
      allowBudgetOverride: true,
    });
    await flush();
    expect(service.snapshot(batch.id).expiresAt).toBe(
      new Date(start + 2 * QUICK_LIMITS.ttlMs - 1).toISOString(),
    );
    expect(documents.translateDocument).toHaveBeenLastCalledWith(
      expect.any(Buffer),
      'episode.srt',
      expect.objectContaining({ allowBudgetOverride: true }),
    );
  });

  it('rejects oversized results without retaining a downloadable buffer', async () => {
    const { service, documents } = setup();
    documents.translateDocument.mockResolvedValueOnce({
      ...translated,
      content: 'x'.repeat(QUICK_LIMITS.resultFileBytes + 1),
    });
    const batch = await service.create(
      [input()],
      options,
      'request_unique_0052',
    );
    await flush();
    const result = service.snapshot(batch.id).files[0];
    expect(result.state).toBe('failed');
    expect(result.error).toContain('memory limit');
    expect(() => service.download(batch.id, batch.files[0].id)).toThrow(
      ConflictException,
    );
  });

  it('bounds total retained results and frees that capacity on expiry', async () => {
    const { service, documents } = setup();
    documents.translateDocument.mockResolvedValue({
      ...translated,
      content: 'x'.repeat(QUICK_LIMITS.resultFileBytes),
    });
    const batch = await service.create(
      Array.from({ length: 6 }, () => input()),
      options,
      'request_unique_0053',
    );
    await flush();
    const snapshot = service.snapshot(batch.id);
    expect(
      snapshot.files.filter((file) => file.state === 'completed'),
    ).toHaveLength(5);
    expect(snapshot.files[5].state).toBe('failed');
    expect(documents.translateDocument).toHaveBeenCalledTimes(5);
    service.expire(Date.parse(snapshot.expiresAt!));
    const next = await service.create(
      [input()],
      options,
      'request_unique_0054',
    );
    await flush();
    expect(service.snapshot(next.id).files[0].state).toBe('completed');
  });

  it('preserves safe basenames and assigns case-insensitive unique ZIP entry names', async () => {
    const { service } = setup();
    const batch = await service.create(
      [input('../Episode.srt'), input('episode.srt'), input('bad\nname.srt')],
      options,
      'request_unique_0060',
    );
    expect(batch.files.map((file) => file.downloadName)).toEqual([
      'Episode.spa.srt',
      'episode (2).spa.srt',
      'bad_name.spa.srt',
    ]);
    await flush();
    expect(service.downloads(batch.id)).toHaveLength(3);
  });
});
