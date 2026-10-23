import { DataSource } from 'typeorm';
import { TokenUsageService } from './token-usage.service';
import { TokenUsageRowEntity } from '../database/entities/token-usage-row.entity';
import { SettingEntity } from '../database/entities/setting.entity';
import { InitialSchema1738700000000 } from '../migrations/1738700000000-InitialSchema';
import { SettingsSecretsAndUsage1738700000005 } from '../migrations/1738700000005-SettingsSecretsAndUsage';
import type { ProviderUsage } from '../translation/translation.service';

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
    expect(await service.getTodayTotals()).toEqual({ free: 0, paid: 24000 });
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
    expect(await service.getTodayTotals()).toEqual({ free: 1200, paid: 0 });
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
