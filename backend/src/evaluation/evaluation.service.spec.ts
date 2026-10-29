jest.mock('../settings/settings.service', () => ({
  SettingsService: class {},
}));
jest.mock('../settings/token-usage.service', () => ({
  TokenUsageService: class {},
}));
jest.mock('../translation/subtitle-translation.service', () => ({
  SubtitleTranslationService: class {},
}));

import { ConflictException } from '@nestjs/common';
import { once } from 'node:events';
import { setImmediate as flush } from 'node:timers/promises';
import { EvaluationService } from './evaluation.service';
import { loadEvaluationCase, loadEvaluationCorpus } from './evaluation-scoring';
import type { SettingsService } from '../settings/settings.service';
import type { TokenUsageService } from '../settings/token-usage.service';
import type {
  DocumentTranslationOptions,
  DocumentTranslationResult,
  SubtitleTranslationService,
} from '../translation/subtitle-translation.service';
import type { ProviderUsage } from '../translation/translation.service';

const request = {
  caseId: 'humor',
  provider: 'deepseek' as const,
  model: 'deepseek-chat',
};
const reference = loadEvaluationCase(
  loadEvaluationCorpus().cases.find((entry) => entry.id === 'humor')!,
).reference;
const response: ProviderUsage = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  tier: 'paid',
  promptTokens: 10,
  completionTokens: 8,
  totalTokens: 18,
  cacheHitTokens: 0,
  cacheMissTokens: 10,
  costUsd: 0.003,
};

function setup() {
  const translateDocument = jest.fn<
    Promise<DocumentTranslationResult>,
    [Buffer | string, string, DocumentTranslationOptions]
  >();
  const assertTranslationBudget = jest.fn().mockResolvedValue(undefined);
  const addProviderUsage = jest.fn().mockResolvedValue(undefined);
  const service = new EvaluationService(
    { translateDocument } as unknown as SubtitleTranslationService,
    { assertTranslationBudget } as unknown as SettingsService,
    { addProviderUsage } as unknown as TokenUsageService,
  );
  return {
    service,
    translateDocument,
    assertTranslationBudget,
    addProviderUsage,
  };
}

describe('evaluation lifecycle boundaries', () => {
  it('rejects budget admission before scheduling provider work', async () => {
    const context = setup();
    context.assertTranslationBudget.mockRejectedValue(
      new ConflictException('Budget reached'),
    );
    await expect(context.service.run(request)).rejects.toThrow(
      'Budget reached',
    );
    expect(context.translateDocument).not.toHaveBeenCalled();
  });

  it('records actual response usage durably before completing the report', async () => {
    const context = setup();
    context.translateDocument.mockImplementation(
      async (_input, _filename, options) => {
        expect(options.automatic).toBe(false);
        expect(options.persistence).toBe('ephemeral');
        expect(options.qualityMode).toBe('review');
        await options.onUsage!(response);
        return { content: reference } as DocumentTranslationResult;
      },
    );
    const created = await context.service.run({
      ...request,
      qualityMode: 'review',
      allowBudgetOverride: true,
    });
    expect(context.service.get(created.id).status).toBe('queued');
    await flush();
    expect(context.service.get(created.id).status).toBe('completed');
    expect(context.addProviderUsage).toHaveBeenCalledWith(response);
    expect(context.assertTranslationBudget).toHaveBeenCalledWith(
      expect.objectContaining({ allowBudgetOverride: true, automatic: false }),
    );
    const report = context.service.report(created.id);
    expect(report.score.passed).toBe(true);
    expect(report.actual.responseCostUsd).toBe(0.003);
    expect(report.actual.latencyMs).toBeGreaterThanOrEqual(0);
    expect(
      report.humanReview.every((criterion) => criterion.score === null),
    ).toBe(true);
    expect(report.humanReview.map((criterion) => criterion.dimension)).toEqual([
      'fidelity',
      'naturalness',
      'voice',
      'humor',
      'consistency',
    ]);
  });

  it.each(['subscription', 'unknown'] as const)(
    'does not invent monetary cost for %s responses',
    async (kind) => {
      const context = setup();
      context.translateDocument.mockImplementation(
        async (_input, _filename, options) => {
          await options.onUsage!({
            ...response,
            tier: kind === 'subscription' ? 'subscription' : 'paid',
            costUsd: kind === 'subscription' ? 0.08 : undefined,
          });
          return { content: reference } as DocumentTranslationResult;
        },
      );
      const created = await context.service.run(request);
      await flush();
      expect(
        context.service.report(created.id).actual.responseCostUsd,
      ).toBeNull();
    },
  );

  it('retains recorded usage when translation fails after a response', async () => {
    const context = setup();
    context.translateDocument.mockImplementation(
      async (_input, _filename, options) => {
        await options.onUsage!(response);
        throw new Error('Provider output malformed');
      },
    );
    const created = await context.service.run(request);
    await flush();
    expect(context.service.get(created.id)).toMatchObject({
      status: 'failed',
      providerResponses: [response],
    });
    expect(context.addProviderUsage).toHaveBeenCalledTimes(1);
    expect(() => context.service.report(created.id)).toThrow(ConflictException);
  });

  it('cancels a queued run before calling translation', async () => {
    const context = setup();
    const created = await context.service.run(request);
    context.service.cancel(created.id);
    await flush();
    expect(context.service.get(created.id).status).toBe('cancelled');
    expect(context.translateDocument).not.toHaveBeenCalled();
  });

  it('aborts in-flight translation through its signal', async () => {
    const context = setup();
    context.translateDocument.mockImplementation(
      async (_input, _filename, options) => {
        await once(options.signal!, 'abort');
        throw new Error('Aborted');
      },
    );
    const created = await context.service.run(request);
    await flush();
    expect(context.service.get(created.id).status).toBe('running');
    context.service.cancel(created.id);
    await flush();
    expect(context.service.get(created.id).status).toBe('cancelled');
  });

  it('caps active evaluations and cancels them on shutdown', async () => {
    const context = setup();
    context.translateDocument.mockImplementation(
      async (_input, _filename, options) => {
        await once(options.signal!, 'abort');
        throw new Error('Shutdown');
      },
    );
    const first = await context.service.run(request);
    const second = await context.service.run(request);
    await expect(context.service.run(request)).rejects.toThrow(
      ConflictException,
    );
    await flush();
    context.service.onModuleDestroy();
    await flush();
    expect(context.service.get(first.id).status).toBe('cancelled');
    expect(context.service.get(second.id).status).toBe('cancelled');
  });
});
