import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SettingsService } from './settings.service';
import { TokenUsageService } from './token-usage.service';
import { SettingEntity } from '../database/entities/setting.entity';
import { runtimeToEntity } from './settings.mapper';
import type { RuntimeSettings } from './settings.types';
import { SecretStore } from './secret-store';

jest.mock('../common/path-safety', () => ({
  validateLanguageCode: (value: string) => value.toLowerCase(),
  assertWithinMediaRoots: jest.fn((candidate: string, roots: string[]) => {
    if (
      !roots.some(
        (root) => candidate === root || candidate.startsWith(`${root}/`),
      )
    )
      return Promise.reject(new Error('Outside trusted roots'));
    return Promise.resolve(candidate);
  }),
}));

const defaults: RuntimeSettings = {
  mediaDirs: ['/media'],
  sourceLanguage: 'eng',
  targetLanguage: 'spa',
  openRouterApiKey: 'openrouter-secret',
  deepSeekApiKey: 'deepseek-secret',
  openRouterModel: 'openrouter/free',
  deepSeekModel: 'deepseek-chat',
  scanCacheTtlMinutes: 30,
  concurrency: 2,
  pathContainsExclusions: [],
  translationVerificationEnabled: false,
  rules: [],
  autoScanEnabled: false,
  autoScanCronExpression: '0 */6 * * *',
  autoTranslateNewItems: false,
  telegramBotToken: 'telegram-secret',
  telegramEnabled: false,
  telegramEvents: [],
  jellyfinUrl: 'http://jellyfin:8096',
  jellyfinApiKey: 'jellyfin-secret',
  tmdbApiKey: 'tmdb-secret',
};

describe('SettingsService encrypted persistence and budgets', () => {
  let directory: string;
  let persisted: SettingEntity;
  let spent: number;
  let service: SettingsService;
  let save: jest.Mock<Promise<SettingEntity>, [SettingEntity]>;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subsarr-settings-'));
    persisted = runtimeToEntity({ ...defaults });
    spent = 0;
    save = jest.fn((entity: SettingEntity) => {
      persisted = { ...entity };
      return Promise.resolve(entity);
    });
    const repo = {
      findOne: jest.fn(() => Promise.resolve({ ...persisted })),
      save,
    } as unknown as Repository<SettingEntity>;
    const config = {
      get: () => ({ ...defaults, pathExclusions: [], dataDir: directory }),
    } as unknown as ConfigService;
    const usage = {
      getMonthPaidCostEstimateUsd: jest.fn(() => Promise.resolve(spent)),
    } as unknown as TokenUsageService;
    service = new SettingsService(config, repo, usage);
  });
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('migrates plaintext before exposing runtime settings and masks every public key', async () => {
    const [runtime, concurrent] = await Promise.all([
      service.getSettings(),
      service.getSettings(),
    ]);
    expect(concurrent).toBe(runtime);
    expect(runtime.tmdbApiKey).toBe('tmdb-secret');
    for (const field of [
      'openRouterApiKey',
      'deepSeekApiKey',
      'telegramBotToken',
      'jellyfinApiKey',
      'tmdbApiKey',
    ] as const) {
      expect(persisted[field]).toMatch(/^enc:v1:/);
      expect((await service.getExportSettings())[field]).toBeUndefined();
      expect((await service.getExportSettings(true))[field]).toBe(
        defaults[field],
      );
    }
    const publicSettings = await service.getPublicSettings();
    expect(publicSettings.tmdbApiKeyMasked).toBe('••••••••');
    expect(JSON.stringify(publicSettings)).not.toContain('tmdb-secret');
  });

  it('preserves blank/masked keys and clears Jellyfin credentials when host changes', async () => {
    await service.updateSettings({
      ...defaults,
      openRouterApiKey: 'open****cret',
      deepSeekApiKey: '',
      telegramBotToken: '••••••••',
      jellyfinUrl: 'http://different:8096',
      jellyfinApiKey: '••••••••',
    });
    const runtime = await service.getSettings();
    expect(runtime.openRouterApiKey).toBe(defaults.openRouterApiKey);
    expect(runtime.deepSeekApiKey).toBe(defaults.deepSeekApiKey);
    expect(runtime.telegramBotToken).toBe(defaults.telegramBotToken);
    expect(runtime.jellyfinApiKey).toBeUndefined();
  });

  it('keeps one unreadable ciphertext intact during plaintext migration and unrelated saves', async () => {
    const ciphertext = 'enc:v1:AAAA';
    persisted.tmdbApiKey = ciphertext;
    const settings = await service.getPublicSettings();
    expect(settings.secretWarnings?.map(({ field }) => field)).toEqual([
      'tmdbApiKey',
    ]);
    expect(typeof settings.secretWarnings?.[0].message).toBe('string');
    expect(settings.tmdbApiKeyMasked).toBe('••••••••');
    expect((await service.getSettings()).tmdbApiKey).toBe('');
    expect((await service.getSettings()).deepSeekApiKey).toBe(
      defaults.deepSeekApiKey,
    );
    expect(persisted.tmdbApiKey).toBe(ciphertext);
    await expect(service.getExportSettings(true)).rejects.toMatchObject({
      status: 409,
    });
    expect((await service.getExportSettings()).tmdbApiKey).toBeUndefined();
    await service.updateSettings({
      ...defaults,
      tmdbApiKey: undefined,
      concurrency: 3,
    });
    expect(persisted.tmdbApiKey).toBe(ciphertext);
    expect((await service.getPublicSettings()).secretWarnings?.[0].field).toBe(
      'tmdbApiKey',
    );
  });

  it('clears unreadable state only after replacement has committed successfully', async () => {
    const ciphertext = 'enc:v1:AAAA';
    persisted.tmdbApiKey = ciphertext;
    await service.getSettings();
    save.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(
      service.updateSettings({ ...defaults, tmdbApiKey: 'replacement-key' }),
    ).rejects.toThrow('database unavailable');
    expect(persisted.tmdbApiKey).toBe(ciphertext);
    expect((await service.getPublicSettings()).secretWarnings?.[0].field).toBe(
      'tmdbApiKey',
    );
    expect((await service.getSettings()).tmdbApiKey).toBe('');
    await service.updateSettings({
      ...defaults,
      tmdbApiKey: 'replacement-key',
    });
    expect((await service.getPublicSettings()).secretWarnings).toBeUndefined();
    expect(
      await new SecretStore(directory).decrypt(
        persisted.tmdbApiKey ?? '',
        'tmdbApiKey',
      ),
    ).toBe('replacement-key');
    expect((await service.getExportSettings(true)).tmdbApiKey).toBe(
      'replacement-key',
    );
  });

  it('supports explicit clearing without treating blank inputs as a clear request', async () => {
    persisted.tmdbApiKey = 'enc:v1:AAAA';
    await service.getSettings();
    await service.updateSettings({
      ...defaults,
      tmdbApiKey: '',
      clearSecrets: ['tmdbApiKey'],
    });
    expect(persisted.tmdbApiKey).toBe('');
    const settings = await service.getPublicSettings();
    expect(settings.secretWarnings).toBeUndefined();
    expect(settings.tmdbApiKeyMasked).toBe('');
    expect((await service.getExportSettings(true)).tmdbApiKey).toBe('');
  });

  it.each(['*/5 * * * *', '0 */5 * * * *', 'invalid-disabled-cron'])(
    'loads and encrypts recoverable persisted settings (%s) before UI repair',
    async (cron) => {
      persisted = runtimeToEntity({
        ...defaults,
        scanCacheTtlMinutes: 20160,
        concurrency: 20,
        autoScanCronExpression: cron,
        autoScanEnabled: cron !== 'invalid-disabled-cron',
      });
      const publicSettings = await service.getPublicSettings();
      expect(publicSettings).toMatchObject({
        scanCacheTtlMinutes: 20160,
        concurrency: 20,
        autoScanCronExpression: cron,
      });
      expect(persisted.openRouterApiKey).toMatch(/^enc:v1:/);
      expect((await service.getSettings()).tmdbApiKey).toBe(
        defaults.tmdbApiKey,
      );
      await service.updateSettings({
        ...defaults,
        autoScanCronExpression: 'invalid-disabled-cron',
        autoScanEnabled: false,
      });
      expect((await service.getPublicSettings()).concurrency).toBe(2);
    },
  );

  it.each(['*/5 * * * *', '0 */5 * * * *'])(
    'accepts enabled five-minute schedules with supported field counts (%s)',
    async (cron) => {
      await expect(
        service.updateSettings({
          ...defaults,
          autoScanEnabled: true,
          autoScanCronExpression: cron,
        }),
      ).resolves.toMatchObject({ autoScanCronExpression: cron });
    },
  );

  it('enforces 80/100% thresholds, zero budgets, manual opt-in, and nullable clearing', async () => {
    await service.updateSettings({ ...defaults, monthlyBudgetUsd: 10 });
    spent = 8;
    expect((await service.getBudgetStatus()).level).toBe('warning');
    spent = 10;
    await expect(
      service.assertTranslationBudget({
        provider: 'deepseek',
        automatic: true,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.assertTranslationBudget({
        provider: 'deepseek',
        automatic: false,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.assertTranslationBudget({
        provider: 'deepseek',
        automatic: false,
        allowBudgetOverride: true,
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.assertTranslationBudget({
        provider: 'deepseek',
        automatic: true,
        allowBudgetOverride: true,
      }),
    ).rejects.toThrow();
    await expect(
      service.assertTranslationBudget({
        provider: 'openrouter',
        automatic: true,
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.assertTranslationBudget({ automatic: true }),
    ).resolves.toBeUndefined();
    await service.updateSettings({ ...defaults, monthlyBudgetUsd: 0 });
    spent = 0;
    expect((await service.getBudgetStatus()).level).toBe('exceeded');
    await service.updateSettings({ ...defaults, monthlyBudgetUsd: null });
    expect(await service.getBudgetStatus()).toMatchObject({
      budgetUsd: null,
      ratio: null,
      level: 'ok',
    });
    await service.updateSettings({ ...defaults, fileTooLargeBytes: 1024 });
    await service.updateSettings({ ...defaults, fileTooLargeBytes: null });
    expect((await service.getSettings()).fileTooLargeBytes).toBeUndefined();
    expect(persisted.fileTooLargeBytes).toBeNull();
  });

  it('normalizes observed floating-point warning boundaries without rounding recorded charges', async () => {
    const budget = 0.0010934000000000002;
    spent = 0.0008747200000000002;
    await service.updateSettings({ ...defaults, monthlyBudgetUsd: budget });
    expect(await service.getBudgetStatus()).toEqual({
      spentUsd: spent,
      budgetUsd: budget,
      ratio: 0.8,
      level: 'warning',
    });
    await service.updateSettings({
      ...defaults,
      monthlyBudgetUsd: 1.0000000000000002,
    });
    spent = 1;
    expect(await service.getBudgetStatus()).toEqual({
      spentUsd: 1,
      budgetUsd: 1.0000000000000002,
      ratio: 1,
      level: 'exceeded',
    });
    await expect(
      service.assertTranslationBudget({
        provider: 'deepseek',
        automatic: true,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.assertTranslationBudget({
        provider: 'deepseek',
        automatic: false,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.assertTranslationBudget({
        provider: 'deepseek',
        automatic: false,
        allowBudgetOverride: true,
      }),
    ).resolves.toBeUndefined();
    await service.updateSettings({ ...defaults, monthlyBudgetUsd: 1 });
    spent = 0.8 - 1e-10;
    expect((await service.getBudgetStatus()).level).toBe('ok');
    spent = 1 - 1e-10;
    expect((await service.getBudgetStatus()).level).toBe('warning');
    await expect(
      service.assertTranslationBudget({
        provider: 'deepseek',
        automatic: true,
      }),
    ).resolves.toBeUndefined();
  });

  it('exempts only explicit free OpenRouter models from paid-budget admission', async () => {
    await service.updateSettings({
      ...defaults,
      monthlyBudgetUsd: 1,
      openRouterModel: 'vendor/paid-model',
    });
    spent = 1;
    await expect(
      service.assertTranslationBudget({
        provider: 'openrouter',
        automatic: true,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.assertTranslationBudget({ automatic: true }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.assertTranslationBudget({
        provider: 'openrouter',
        automatic: false,
        allowBudgetOverride: true,
      }),
    ).resolves.toBeUndefined();
    await service.updateSettings({
      ...defaults,
      monthlyBudgetUsd: 1,
      openRouterModel: 'vendor/model:free',
    });
    await expect(
      service.assertTranslationBudget({
        provider: 'openrouter',
        automatic: true,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects unsafe roots, invalid bounds and frequent cron before writing', async () => {
    await expect(
      service.updateSettings({ ...defaults, mediaDirs: ['/etc'] }),
    ).rejects.toThrow('Outside trusted roots');
    await expect(
      service.updateSettings({ ...defaults, concurrency: 17 }),
    ).rejects.toThrow('concurrency');
    await expect(
      service.updateSettings({
        ...defaults,
        autoScanEnabled: true,
        autoScanCronExpression: '* * * * *',
      }),
    ).rejects.toThrow('5 minutes');
    await expect(
      service.updateSettings({
        ...defaults,
        jellyfinUrl: 'http://user:password@example.com',
      }),
    ).rejects.toThrow('jellyfinUrl');
    expect((await service.getSettings()).concurrency).toBe(2);
  });
});
