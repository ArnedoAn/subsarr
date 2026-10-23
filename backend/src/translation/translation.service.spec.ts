jest.mock('franc-min', () => ({ franc: jest.fn(() => 'spa') }));
const mockCreate = jest.fn<
  Promise<unknown>,
  [unknown, { signal?: AbortSignal }?]
>();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: (request: unknown, options?: { signal?: AbortSignal }) =>
          mockCreate(request, options),
      },
    },
  })),
}));
import OpenAI from 'openai';
import { TranslationService, type ProviderUsage } from './translation.service';
import { TranslationVerificationService } from './translation-verification.service';
import { type SettingsService } from '../settings/settings.service';
import { translationAbortError } from './provider-limiter';
const originalFetch = global.fetch;
const mockQuotaFetch = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function response(data: unknown) {
  return {
    choices: [
      { finish_reason: 'stop', message: { content: JSON.stringify(data) } },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_cache_hit_tokens: 4,
      prompt_cache_miss_tokens: 6,
    },
  };
}
describe('TranslationService shared SDK boundary', () => {
  const settingsService = {
    getSettings: jest.fn().mockResolvedValue({
      openRouterModel: 'test/openrouter:free',
      deepSeekModel: 'test/deepseek',
    }),
    assertTranslationBudget: jest.fn().mockResolvedValue(undefined),
  };
  let service: TranslationService;
  beforeEach(() => {
    global.fetch = mockQuotaFetch;
    mockQuotaFetch
      .mockReset()
      .mockRejectedValue(new Error('Quota lookup unavailable'));
    mockCreate.mockReset();
    jest.mocked(OpenAI).mockClear();
    settingsService.assertTranslationBudget.mockClear();
    service = new TranslationService(
      new TranslationVerificationService(),
      settingsService as unknown as SettingsService,
    );
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });
  it('repairs dropped SRT lines even with semantics disabled and charges rejected corrections', async () => {
    mockCreate
      .mockResolvedValueOnce(response({ data: ['Hola'] }))
      .mockResolvedValueOnce(response({ data: ['Todavia'] }))
      .mockResolvedValueOnce(response({ data: ['Hola\nAlli'] }));
    const attempts: ProviderUsage[] = [];
    const result = await service.translateLines(
      ['Hello\nThere'],
      'spa',
      'openrouter-key',
      'deepseek-key',
      {
        provider: 'openrouter',
        sourceLanguage: 'eng',
        verificationEnabled: false,
        subtitleFormat: 'srt',
        onUsage: (attempt) => {
          attempts.push(attempt);
        },
      },
    );
    expect(result.lines).toEqual(['Hola\nAlli']);
    expect(result.verification).toMatchObject({
      failedCount: 0,
      retriedLines: 1,
      fixedByRetry: 1,
    });
    expect(attempts).toHaveLength(3);
    expect(result.usage).toMatchObject({
      promptTokens: 30,
      totalTokens: 45,
      cacheHitTokens: 12,
      cacheMissTokens: 18,
    });
    expect(JSON.stringify(mockCreate.mock.calls[1])).toContain(
      'missing_segments',
    );
  });
  it('rejects malformed/nonstring data without silently returning source and accounts both responses', async () => {
    mockCreate.mockResolvedValue(response({ data: [3] }));
    const onUsage = jest.fn();
    await expect(
      service.translateLines(['Hello'], 'spa', 'key', 'paid', { onUsage }),
    ).rejects.toThrow('data:string[]');
    expect(onUsage).toHaveBeenCalledTimes(2);
  });
  it.each([
    { status: 429, code: 'insufficient_quota' },
    { status: 503 },
    new Error('network OpenRouter failed'),
  ])(
    'never cost-increases by guessing provider exhaustion: %s',
    async (error) => {
      mockCreate.mockRejectedValue(error);
      await expect(
        service.translateLines(['Hello'], 'spa', 'key', 'paid'),
      ).rejects.toBe(error);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(settingsService.assertTranslationBudget).not.toHaveBeenCalled();
    },
  );
  it('checks paid budget for structured exhaustion and uses one SDK for both endpoints', async () => {
    mockCreate
      .mockRejectedValueOnce({ status: 402, code: 'free_tier_exhausted' })
      .mockResolvedValueOnce(response({ data: ['Hola'] }));
    await service.translateLines(['Hello'], 'spa', 'key', 'paid', {
      automatic: false,
      allowBudgetOverride: true,
    });
    expect(settingsService.assertTranslationBudget).toHaveBeenCalledWith({
      provider: 'deepseek',
      automatic: false,
      allowBudgetOverride: true,
    });
    expect(OpenAI).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1][0]).toMatchObject({
      temperature: 1.3,
      response_format: { type: 'json_object' },
    });
  });
  it('falls back on unambiguous structured daily-free 429 and still checks paid budget', async () => {
    mockCreate
      .mockRejectedValueOnce({
        status: 429,
        error: {
          code: 429,
          message: 'Rate limit exceeded: free-models-per-day.',
        },
      })
      .mockResolvedValueOnce(response({ data: ['Hola'] }));
    await service.translateLines(['Hello'], 'spa', 'key', 'paid');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(settingsService.assertTranslationBudget).toHaveBeenCalledWith({
      provider: 'deepseek',
      automatic: true,
      allowBudgetOverride: undefined,
    });
    expect(mockQuotaFetch).not.toHaveBeenCalled();
  });
  it('verifies a generic 429 using authenticated daily quota before paid fallback', async () => {
    mockCreate
      .mockRejectedValueOnce({
        status: 429,
        error: { code: 429, message: 'Rate limit exceeded' },
      })
      .mockResolvedValueOnce(response({ data: ['Hola'] }));
    mockQuotaFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            free_model_daily_requests: { used: 50, limit: 50, remaining: 0 },
          },
        }),
      ),
    );
    await service.translateLines(['Hello'], 'spa', ' key ', 'paid');
    const [url, init] = mockQuotaFetch.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/key');
    expect(init?.headers).toEqual({ Authorization: 'Bearer key' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(mockQuotaFetch).toHaveBeenCalledTimes(1);
    expect(settingsService.assertTranslationBudget).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
  it('does not bypass the paid budget after daily quota confirmation', async () => {
    const quotaError = {
      status: 429,
      error: { code: 'free_model_daily_quota_exhausted' },
    };
    const conflict = new Error('budget requires override');
    mockCreate.mockRejectedValueOnce(quotaError);
    settingsService.assertTranslationBudget.mockRejectedValueOnce(conflict);
    await expect(
      service.translateLines(['Hello'], 'spa', 'key', 'paid'),
    ).rejects.toBe(conflict);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
  it.each([
    {
      status: 429,
      error: {
        code: 429,
        message: 'Rate limit exceeded: free-models-per-minute.',
      },
    },
    { status: 429, error: { code: 429, metadata: { provider_code: 429 } } },
    {
      status: 402,
      error: {
        code: 402,
        metadata: {
          limit_source: 'openrouter_in_flight_budget',
          reason: 'in_flight_budget_exhausted',
        },
      },
    },
    {
      status: 403,
      error: {
        code: 403,
        metadata: { limit_source: 'openrouter_guardrail_budget' },
      },
    },
    {
      status: 402,
      error: { code: 402, metadata: { limit_source: 'openrouter_key_limit' } },
    },
  ])(
    'does not cost-increase for explicit minute, provider, in-flight or administrative limits: %s',
    async (error) => {
      mockCreate.mockRejectedValueOnce(error);
      await expect(
        service.translateLines(['Hello'], 'spa', 'key', 'paid'),
      ).rejects.toBe(error);
      expect(mockQuotaFetch).not.toHaveBeenCalled();
      expect(settingsService.assertTranslationBudget).not.toHaveBeenCalled();
      expect(mockCreate).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    {},
    {
      data: {
        free_model_daily_requests: { used: 10, limit: 50, remaining: 40 },
      },
    },
    {
      data: {
        free_model_daily_requests: { used: '50', limit: 50, remaining: 0 },
      },
    },
    {
      data: { free_model_daily_requests: { used: 0, limit: 50, remaining: 0 } },
    },
  ])(
    'retains generic 429 without validated exhausted daily quota: %s',
    async (body) => {
      const error = {
        status: 429,
        error: { code: 429, message: 'Rate limit exceeded' },
      };
      mockCreate.mockRejectedValueOnce(error);
      mockQuotaFetch.mockResolvedValue(new Response(JSON.stringify(body)));
      await expect(
        service.translateLines(['Hello'], 'spa', 'key', 'paid'),
      ).rejects.toBe(error);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(settingsService.assertTranslationBudget).not.toHaveBeenCalled();
    },
  );
  it('recognizes real numeric 402 credit metadata without invented string codes', async () => {
    mockCreate
      .mockRejectedValueOnce({
        status: 402,
        error: { code: 402, metadata: { limit_source: 'openrouter_credits' } },
      })
      .mockResolvedValueOnce(response({ data: ['Hola'] }));
    await service.translateLines(['Hello'], 'spa', 'key', 'paid');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(settingsService.assertTranslationBudget).toHaveBeenCalledTimes(1);
  });
  it('never falls back when cancelled during quota verification', async () => {
    const controller = new AbortController();
    mockCreate.mockRejectedValueOnce({ status: 429, error: { code: 429 } });
    mockQuotaFetch.mockImplementation(() => {
      controller.abort();
      return Promise.reject(translationAbortError(controller.signal));
    });
    await expect(
      service.translateLines(['Hello'], 'spa', 'key', 'paid', {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(settingsService.assertTranslationBudget).not.toHaveBeenCalled();
  });
  it('caches SDK clients by provider and credential without reusing rotated credentials', async () => {
    mockCreate.mockResolvedValue(response({ data: ['Hola'] }));
    await service.translateLines(['Hello'], 'spa', 'key', 'paid');
    await service.translateLines(['Hello'], 'spa', 'key', 'paid');
    await service.translateLines(['Hello'], 'spa', 'rotated-key', 'paid');
    expect(OpenAI).toHaveBeenCalledTimes(2);
  });
  it('budget-checks paid OpenRouter models and uses actual response cost', async () => {
    settingsService.getSettings.mockResolvedValueOnce({
      openRouterModel: 'test/paid',
      deepSeekModel: 'test/deepseek',
    });
    const reply = response({ data: ['Hola'] });
    mockCreate.mockResolvedValue({
      ...reply,
      usage: { ...reply.usage, cost: 0.007 },
    });
    const onUsage = jest.fn();
    const onTokenUpdate = jest.fn();
    const result = await service.translateLines(
      ['Hello'],
      'spa',
      'key',
      'paid',
      { onUsage, onTokenUpdate },
    );
    expect(settingsService.assertTranslationBudget).toHaveBeenCalledWith({
      provider: 'openrouter',
      automatic: true,
      allowBudgetOverride: undefined,
    });
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openrouter',
        tier: 'paid',
        costUsd: 0.007,
      }),
    );
    expect(onTokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ estimatedCostUsd: 0.007 }),
    );
    expect(result.tierUsed).toBe('paid');
  });
  it('accounts actual positive cost as paid even if model name claimed free', async () => {
    const reply = response({ data: ['Hola'] });
    mockCreate.mockResolvedValue({
      ...reply,
      usage: { ...reply.usage, cost: 0.001 },
    });
    const onUsage = jest.fn();
    await service.translateLines(['Hello'], 'spa', 'key', 'paid', { onUsage });
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'paid', costUsd: 0.001 }),
    );
  });
  it('admits paid work once before HTTP without killing remaining document chunks at budget threshold', async () => {
    mockCreate.mockResolvedValue(response({ data: ['Hola'] }));
    await service.translateLines(
      ['a'.repeat(8000), 'b'.repeat(8000), 'c'.repeat(8000)],
      'spa',
      'key',
      'paid',
      { provider: 'deepseek' },
    );
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(settingsService.assertTranslationBudget).toHaveBeenCalledTimes(1);
  });
  it.each([
    { provider: 'deepseek', concurrency: 5 },
    { provider: 'openrouter', concurrency: 3 },
  ] as const)(
    'runs $provider chunks concurrently and keeps output ordered with bounded lazy workers',
    async ({ provider, concurrency }) => {
      const gates = Array.from({ length: 7 }, () => deferred<unknown>());
      const started = deferred<void>();
      const admissionEntered = deferred<void>();
      const admission = deferred<void>();
      if (provider === 'deepseek') {
        settingsService.assertTranslationBudget.mockImplementationOnce(() => {
          admissionEntered.resolve(undefined);
          return admission.promise;
        });
      }
      let next = 0;
      mockCreate.mockImplementation(() => {
        const index = next++;
        if (next === concurrency) started.resolve(undefined);
        return gates[index].promise;
      });
      const attempts: ProviderUsage[] = [];
      const pending = service.translateLines(
        Array.from({ length: 7 }, (_, i) => `${i}` + 'x'.repeat(8000)),
        'spa',
        'key',
        'paid',
        {
          provider,
          onUsage: (attempt) => {
            attempts.push(attempt);
          },
        },
      );
      if (provider === 'deepseek') {
        await admissionEntered.promise;
        expect(settingsService.assertTranslationBudget).toHaveBeenCalledTimes(
          1,
        );
        expect(mockCreate).not.toHaveBeenCalled();
        admission.resolve(undefined);
      }
      await started.promise;
      expect(mockCreate).toHaveBeenCalledTimes(concurrency);
      for (let i = gates.length - 1; i >= 0; i--)
        gates[i].resolve(response({ data: [`Hola ${i}`] }));
      const result = await pending;
      expect(result.lines).toEqual(
        Array.from({ length: 7 }, (_, i) => `Hola ${i}`),
      );
      expect(attempts).toHaveLength(7);
      expect(mockCreate).toHaveBeenCalledTimes(7);
      expect(settingsService.assertTranslationBudget).toHaveBeenCalledTimes(
        provider === 'deepseek' ? 1 : 0,
      );
    },
  );
  it('parallelizes grouped correction chunks with context through the same provider cap', async () => {
    const gates = Array.from({ length: 5 }, () => deferred<unknown>());
    const correcting = deferred<void>();
    let next = 0;
    mockCreate.mockImplementation(() => {
      const index = next++;
      if (index < 5) return Promise.resolve(response({ data: ['Hola'] }));
      if (next === 10) correcting.resolve(undefined);
      return gates[index - 5].promise;
    });
    const onUsage = jest.fn<void, [ProviderUsage]>();
    const pending = service.translateLines(
      Array.from({ length: 5 }, () => 'x'.repeat(8000) + '\nTail'),
      'spa',
      'key',
      'paid',
      {
        provider: 'deepseek',
        subtitleFormat: 'srt',
        verificationEnabled: false,
        onUsage,
      },
    );
    await correcting.promise;
    expect(mockCreate).toHaveBeenCalledTimes(10);
    expect(JSON.stringify(mockCreate.mock.calls[5])).toContain(
      'missing_segments',
    );
    expect(JSON.stringify(mockCreate.mock.calls[5])).toContain('contextAfter');
    for (const gate of gates) gate.resolve(response({ data: ['Hola\nAlli'] }));
    const result = await pending;
    expect(result.verification).toMatchObject({
      failedCount: 0,
      fixedByRetry: 5,
    });
    expect(onUsage).toHaveBeenCalledTimes(10);
    expect(settingsService.assertTranslationBudget).toHaveBeenCalledTimes(1);
  });
  it('stops unclaimed chunks on first failure, aborts siblings and drains completed response accounting', async () => {
    const gates = Array.from({ length: 5 }, () => deferred<unknown>());
    const started = deferred<void>();
    const cancelled = deferred<void>();
    const accountingStarted = deferred<void>();
    const accountingRelease = deferred<void>();
    const attempts: ProviderUsage[] = [];
    let next = 0;
    mockCreate.mockImplementation((_request, options) => {
      const index = next++;
      if (index === 0)
        options?.signal?.addEventListener(
          'abort',
          () => cancelled.resolve(undefined),
          { once: true },
        );
      if (next === 5) started.resolve(undefined);
      return gates[index].promise;
    });
    let settled = false;
    const pending = service.translateLines(
      Array.from({ length: 8 }, () => 'x'.repeat(8000)),
      'spa',
      'key',
      'paid',
      {
        provider: 'deepseek',
        onUsage: (attempt) => {
          attempts.push(attempt);
          if (attempts.length === 4) accountingStarted.resolve(undefined);
          return accountingRelease.promise;
        },
      },
    );
    const outcome = pending.then(
      () => {
        settled = true;
        return undefined;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    await started.promise;
    const failure = new Error('First batch failed');
    gates[0].reject(failure);
    await cancelled.promise;
    // Model already-completed HTTP responses whose usage still needs persistence.
    for (let i = 1; i < gates.length; i++)
      gates[i].resolve(response({ data: [`Hola ${i}`] }));
    await accountingStarted.promise;
    expect(settled).toBe(false);
    expect(mockCreate).toHaveBeenCalledTimes(5);
    accountingRelease.resolve(undefined);
    await expect(outcome).resolves.toBe(failure);
    expect(attempts).toHaveLength(4);
    expect(mockCreate).toHaveBeenCalledTimes(5);
    expect(settingsService.assertTranslationBudget).toHaveBeenCalledTimes(1);
  });
  it('preserves budget conflicts before any paid HTTP request', async () => {
    const conflict = new Error('budget exceeded');
    settingsService.assertTranslationBudget.mockRejectedValueOnce(conflict);
    await expect(
      service.translateLines(['Hello'], 'spa', 'key', 'paid', {
        provider: 'deepseek',
      }),
    ).rejects.toBe(conflict);
    expect(mockCreate).not.toHaveBeenCalled();
  });
  it('passes cancellation to in-flight SDK calls and does not retry or fallback', async () => {
    const controller = new AbortController();
    mockCreate.mockImplementation(
      (_request: unknown, options?: { signal?: AbortSignal }) => {
        controller.abort();
        return Promise.reject(translationAbortError(options?.signal));
      },
    );
    await expect(
      service.translateLines(['Hello'], 'spa', 'key', 'paid', {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(settingsService.assertTranslationBudget).not.toHaveBeenCalled();
  });
});
