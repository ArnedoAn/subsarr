import { DataSource } from 'typeorm';
import { TokenUsageService } from './token-usage.service';
import { TokenUsageRowEntity } from '../database/entities/token-usage-row.entity';
import { SettingEntity } from '../database/entities/setting.entity';
import { InitialSchema1738700000000 } from '../migrations/1738700000000-InitialSchema';
import { SettingsSecretsAndUsage1738700000005 } from '../migrations/1738700000005-SettingsSecretsAndUsage';
import type { ProviderUsage } from '../translation/translation.service';
import { AddOpenCodeGo1738700000007 } from '../migrations/1738700000007-AddOpenCodeGo';
import { SUBSCRIPTION_PRICING_SOURCE } from './provider-pricing';

const attempt: ProviderUsage = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  tier: 'paid',
  promptTokens: 1000,
  completionTokens: 200,
  totalTokens: 1200,
  cacheHitTokens: 800,
  cacheMissTokens: 200,
};

describe('TokenUsageService atomic response ledger', () => {
  let database: DataSource;
  let service: TokenUsageService;
  beforeEach(async () => {
    database = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [SettingEntity, TokenUsageRowEntity],
      migrations: [
        InitialSchema1738700000000,
        SettingsSecretsAndUsage1738700000005,
        AddOpenCodeGo1738700000007,
      ],
      synchronize: false,
    });
    await database.initialize();
    await database.runMigrations();
    service = new TokenUsageService(
      database.getRepository(TokenUsageRowEntity),
    );
  });
  afterEach(async () => {
    if (database?.isInitialized) await database.destroy();
  });

  it('counts every concurrent response once with cache-aware historical cost snapshots', async () => {
    await Promise.all(
      Array.from({ length: 20 }, () => service.addProviderUsage(attempt)),
    );
    expect(await service.getTodayTotals()).toEqual({
      free: 0,
      paid: 24000,
      subscription: 0,
    });
    const row = await database
      .getRepository(TokenUsageRowEntity)
      .findOneByOrFail({ tier: 'paid' });
    expect(row).toMatchObject({
      promptTokens: 20000,
      completionTokens: 4000,
      cacheHitTokens: 16000,
      cacheMissTokens: 4000,
    });
    expect(row.costUsd).toBeCloseTo(
      (20 * (800 * 0.028 + 200 * 0.28 + 200 * 0.42)) / 1e6,
      12,
    );
    const ledger = await database.query<Array<Record<string, unknown>>>(
      'SELECT * FROM provider_usage_attempts',
    );
    expect(ledger).toHaveLength(20);
    expect(ledger[0]).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-chat',
      pricingUpdatedAt: '2025-09-05',
    });
    expect(await service.getMonthPaidCostEstimateUsd()).toBeCloseTo(
      row.costUsd,
      12,
    );
  });

  it('rolls back the ledger if aggregation fails, reports failure, then permits recovery', async () => {
    await database.query(
      `CREATE TRIGGER reject_usage BEFORE INSERT ON token_usage BEGIN SELECT RAISE(ABORT, 'accounting failure'); END`,
    );
    await expect(service.addProviderUsage(attempt)).rejects.toThrow(
      'accounting failure',
    );
    expect(
      await database.query('SELECT * FROM provider_usage_attempts'),
    ).toEqual([]);
    await database.query('DROP TRIGGER reject_usage');
    await service.addProviderUsage({
      ...attempt,
      provider: 'openrouter',
      model: 'openrouter/free',
      tier: 'free',
    });
    expect(await service.getTodayTotals()).toEqual({
      free: 1200,
      paid: 0,
      subscription: 0,
    });
    expect(
      (
        await database
          .getRepository(TokenUsageRowEntity)
          .findOneByOrFail({ tier: 'free' })
      ).costUsd,
    ).toBe(0);
  });

  it('records actual paid OpenRouter cost and never silently treats unknown models as free', async () => {
    await service.addProviderUsage({
      ...attempt,
      provider: 'openrouter',
      model: 'vendor/paid-model',
      tier: 'free',
      costUsd: 0.075,
    });
    let row = await database
      .getRepository(TokenUsageRowEntity)
      .findOneByOrFail({ tier: 'paid' });
    expect(row.costUsd).toBe(0.075);
    await service.addProviderUsage({
      ...attempt,
      provider: 'openrouter',
      model: 'vendor/another-model',
      tier: 'free',
    });
    row = await database
      .getRepository(TokenUsageRowEntity)
      .findOneByOrFail({ tier: 'paid' });
    expect(row.costUsd).toBeGreaterThan(0.075);
    await service.addProviderUsage({
      ...attempt,
      provider: 'openrouter',
      model: 'vendor/model:free',
      tier: 'free',
      costUsd: 0.01,
    });
    const ledger = await database.query<
      Array<{ tier: string; pricingSource: string; costUsd: number }>
    >(
      'SELECT tier,pricingSource,costUsd FROM provider_usage_attempts ORDER BY id',
    );
    expect(ledger[0]).toMatchObject({
      tier: 'paid',
      costUsd: 0.075,
      pricingSource: 'openrouter response usage.cost (actual USD)',
    });
    expect(ledger[1].pricingSource).toContain('DeepSeek-rate estimate');
    expect(ledger[2]).toMatchObject({ tier: 'paid', costUsd: 0.01 });
    expect((await service.getSummary()).estimatedCostUsd).toBeCloseTo(
      row.costUsd + 0.01,
      12,
    );
  });

  it('records Go subscription tokens and cache metadata without converting quota cost into USD', async () => {
    await service.addProviderUsage({
      ...attempt,
      provider: 'opencode-go',
      model: 'glm-5.2',
      tier: 'subscription',
      costUsd: 42.75,
    });
    await service.addProviderUsage({
      ...attempt,
      provider: 'opencode-go',
      model: 'kimi-k3',
      tier: 'subscription',
    });
    const row = await database
      .getRepository(TokenUsageRowEntity)
      .findOneByOrFail({ tier: 'subscription' });
    expect(row).toMatchObject({
      promptTokens: 2000,
      completionTokens: 400,
      totalTokens: 2400,
      cacheHitTokens: 1600,
      cacheMissTokens: 400,
      costUsd: 0,
    });
    const ledger = await database.query<Array<Record<string, unknown>>>(
      'SELECT * FROM provider_usage_attempts ORDER BY id',
    );
    expect(ledger).toHaveLength(2);
    for (const entry of ledger) {
      expect(entry).toMatchObject({
        provider: 'opencode-go',
        tier: 'subscription',
        promptTokens: 1000,
        completionTokens: 200,
        totalTokens: 1200,
        cacheHitTokens: 800,
        cacheMissTokens: 200,
        costUsd: 0,
        pricingSource: SUBSCRIPTION_PRICING_SOURCE,
        pricingUpdatedAt: new Date().toISOString().slice(0, 10),
      });
      expect(String(entry.pricingSource)).not.toContain('DeepSeek');
    }
    expect(ledger.map((entry) => entry.model)).toEqual(['glm-5.2', 'kimi-k3']);
    expect(await service.getTodayTotals()).toEqual({
      free: 0,
      paid: 0,
      subscription: 2400,
    });
    expect(await service.getMonthPaidCostEstimateUsd()).toBe(0);
    expect(TokenUsageService.estimateCostUsd('subscription', 1e6, 1e6)).toBe(0);
  });

  it('aggregates subscription history separately and leaves paid and free rows and budgets unchanged', async () => {
    await service.addProviderUsage({ ...attempt, costUsd: 0.25 });
    await service.addProviderUsage({
      ...attempt,
      provider: 'openrouter',
      model: 'openrouter/free',
      tier: 'free',
    });
    const repository = database.getRepository(TokenUsageRowEntity);
    const previous = await repository.find({ order: { id: 'ASC' } });
    await repository.save(
      repository.create({
        tier: 'subscription',
        date: '2000-01-01',
        promptTokens: 50,
        completionTokens: 10,
        totalTokens: 60,
        cacheHitTokens: 0,
        cacheMissTokens: 50,
        costUsd: 0,
      }),
    );
    await service.addProviderUsage({
      ...attempt,
      provider: 'opencode-go',
      model: 'glm-5.2',
      tier: 'subscription',
      costUsd: 500,
    });
    expect(
      await repository.find({
        where: [{ tier: 'free' }, { tier: 'paid' }],
        order: { id: 'ASC' },
      }),
    ).toEqual(previous);
    const paidAndFree = {
      promptTokens: 1000,
      completionTokens: 200,
      totalTokens: 1200,
    };
    expect(await service.getSummary()).toEqual({
      free: paidAndFree,
      paid: paidAndFree,
      subscription: {
        promptTokens: 1050,
        completionTokens: 210,
        totalTokens: 1260,
      },
      estimatedCostUsd: 0.25,
      today: {
        free: paidAndFree,
        paid: paidAndFree,
        subscription: paidAndFree,
        estimatedCostUsd: 0.25,
      },
    });
    expect(await service.getMonthPaidCostEstimateUsd()).toBe(0.25);
    expect(await service.getDailyTokenSeries(1)).toEqual([
      {
        date: new Date().toISOString().slice(0, 10),
        free: 1200,
        paid: 1200,
        subscription: 1200,
      },
    ]);
  });

  it('rejects invalid provider token counts before accounting writes', async () => {
    await expect(
      service.addProviderUsage({ ...attempt, totalTokens: NaN }),
    ).rejects.toThrow('Invalid provider token');
    await expect(
      service.addProviderUsage({ ...attempt, cacheHitTokens: -1 }),
    ).rejects.toThrow('Invalid provider token');
    expect(
      await database.query('SELECT * FROM provider_usage_attempts'),
    ).toEqual([]);
  });
});
