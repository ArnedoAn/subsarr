import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { type SubsyncEnvConfig } from '../config/subsync.config';
import { SettingEntity } from '../database/entities/setting.entity';
import {
  SETTINGS_ROW_ID,
  entityToRuntime,
  runtimeToEntity,
} from './settings.mapper';
import {
  type PublicSettings,
  type RuleToggleConfig,
  type RuntimeSettings,
  type UpdateSettingsInput,
} from './settings.types';
import {
  SecretStore,
  SECRET_FIELDS,
  isMaskedSecret,
  type SecretField,
} from './secret-store';
import { validateSettings } from './settings.validation';
import { TokenUsageService } from './token-usage.service';
import { isFreeOpenRouterModel } from './provider-pricing';

const DEFAULT_RULES: RuleToggleConfig[] = [
  { id: 'already-has-target-subtitle', enabled: true },
  { id: 'already-has-external-subtitle', enabled: true },
  { id: 'no-source-track', enabled: true },
  { id: 'image-based-subtitle', enabled: true },
  { id: 'file-too-large', enabled: false },
  { id: 'path-contains', enabled: true },
];

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private cachedSettings: RuntimeSettings | null = null;
  private loadingSettings?: Promise<RuntimeSettings>;
  private secretStore?: SecretStore;
  private readonly unreadableSecrets = new Map<SecretField, string>();

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(SettingEntity)
    private readonly settingsRepo: Repository<SettingEntity>,
    private readonly tokenUsageService: TokenUsageService,
  ) {}

  async getSettings(): Promise<RuntimeSettings> {
    if (this.cachedSettings) return this.cachedSettings;
    if (!this.loadingSettings)
      this.loadingSettings = this.loadSettings().catch((error: unknown) => {
        this.loadingSettings = undefined;
        throw error;
      });
    return this.loadingSettings;
  }

  private async loadSettings(): Promise<RuntimeSettings> {
    const base = this.loadFromEnv();
    const row = await this.settingsRepo.findOne({
      where: { id: SETTINGS_ROW_ID },
    });
    const runtime = row ? entityToRuntime(row) : base;
    const config = this.configService.get<SubsyncEnvConfig>('subsync')!;
    this.secretStore ??= new SecretStore(config.dataDir);
    let needsMigration = !row;
    for (const field of SECRET_FIELDS) {
      const value = runtime[field];
      if (value && !value.startsWith('enc:v1:')) needsMigration = true;
      if (!value) continue;
      try {
        runtime[field] = await this.secretStore.decrypt(value, field);
      } catch {
        // Preserve the original ciphertext for key restoration or replacement;
        // only this credential is unavailable, not the entire settings API.
        this.unreadableSecrets.set(field, value);
        runtime[field] = '';
        this.logger.warn(
          `Saved ${field} cannot be decrypted; restore the secret key or replace this credential in Settings`,
        );
      }
    }
    // Older releases accepted wider numeric bounds and cron schedules. Keep
    // persisted configuration readable so users can repair it; validate writes.
    if (!row) await validateSettings(runtime);
    // Safe plaintext migration: decrypt every field before any replacement write.
    if (needsMigration) await this.persist(runtime);
    this.cachedSettings = runtime;
    return runtime;
  }

  private async persist(
    runtime: RuntimeSettings,
    replacedSecrets: ReadonlySet<SecretField> = new Set(),
  ): Promise<void> {
    const encrypted = { ...runtime };
    const config = this.configService.get<SubsyncEnvConfig>('subsync')!;
    this.secretStore ??= new SecretStore(config.dataDir);
    for (const field of SECRET_FIELDS) {
      const unreadable = this.unreadableSecrets.get(field);
      if (unreadable !== undefined && !replacedSecrets.has(field)) {
        encrypted[field] = unreadable;
        continue;
      }
      const value = encrypted[field];
      if (value)
        encrypted[field] = await this.secretStore.encrypt(value, field);
    }
    await this.settingsRepo.save(runtimeToEntity(encrypted));
  }

  async getBudgetStatus(): Promise<{
    spentUsd: number;
    budgetUsd: number | null;
    ratio: number | null;
    level: 'ok' | 'warning' | 'exceeded';
  }> {
    const settings = await this.getSettings();
    const spentUsd = await this.tokenUsageService.getMonthPaidCostEstimateUsd();
    const budgetUsd = settings.monthlyBudgetUsd ?? null;
    let ratio =
      budgetUsd === null ? null : budgetUsd === 0 ? 1 : spentUsd / budgetUsd;
    // Accumulated IEEE-754 error must not hide a reached threshold. Normalize
    // only a few relative ULPs around policy boundaries, never currency values.
    if (ratio !== null) {
      for (const threshold of [0.8, 1]) {
        const tolerance =
          Number.EPSILON * 8 * Math.max(Math.abs(ratio), threshold);
        if (Math.abs(ratio - threshold) <= tolerance) ratio = threshold;
      }
    }
    const level =
      ratio !== null && ratio >= 1
        ? 'exceeded'
        : ratio !== null && ratio >= 0.8
          ? 'warning'
          : 'ok';
    return { spentUsd, budgetUsd, ratio, level };
  }

  async assertTranslationBudget(options: {
    provider?: 'deepseek' | 'openrouter';
    automatic: boolean;
    allowBudgetOverride?: boolean;
  }): Promise<void> {
    const settings = await this.getSettings();
    if (
      (options.provider ?? 'openrouter') === 'openrouter' &&
      isFreeOpenRouterModel(settings.openRouterModel)
    )
      return;
    const budget = await this.getBudgetStatus();
    if (
      budget.level === 'exceeded' &&
      (options.automatic || !options.allowBudgetOverride)
    ) {
      throw new ConflictException({
        code: 'TRANSLATION_BUDGET_EXCEEDED',
        message: options.automatic
          ? 'Automatic paid translations stopped: monthly budget reached'
          : 'Monthly budget reached; explicitly allow a budget override to continue',
        ...budget,
      });
    }
    if (budget.level === 'warning')
      this.logger.warn('Monthly translation budget is at least 80% spent');
  }

  async getExportSettings(
    includeSecrets = false,
  ): Promise<Partial<RuntimeSettings>> {
    const settings: Partial<RuntimeSettings> = {
      ...(await this.getSettings()),
    };
    if (includeSecrets && this.unreadableSecrets.size)
      throw new ConflictException(
        'Cannot export secrets: restore the original secret key or replace unreadable credentials first',
      );
    if (!includeSecrets)
      for (const field of SECRET_FIELDS) delete settings[field];
    return settings;
  }

  async fetchAvailableModels(): Promise<{
    openRouter: string[];
    deepSeek: string[];
  }> {
    const settings = await this.getSettings();
    const load = async (
      provider: string,
      url: string,
      key: string,
    ): Promise<string[]> => {
      if (!key.trim()) return [];
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(12_000),
          redirect: 'error',
        });
        if (!response.ok)
          throw new BadRequestException(
            `${provider} models failed (HTTP ${response.status})${response.status === 429 ? '; rate limited, try later' : ''}`,
          );
        const body = (await response.json()) as {
          data?: Array<{ id?: unknown }>;
        };
        if (!Array.isArray(body.data))
          throw new BadRequestException(
            `${provider} returned an invalid model list`,
          );
        return body.data
          .map((model) => model.id)
          .filter(
            (id): id is string => typeof id === 'string' && id.length <= 200,
          )
          .slice(0, 120);
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException(
          `${provider} model request failed or timed out`,
        );
      }
    };
    const [openRouter, deepSeek] = await Promise.all([
      load(
        'OpenRouter',
        'https://openrouter.ai/api/v1/models',
        settings.openRouterApiKey,
      ),
      load(
        'DeepSeek',
        'https://api.deepseek.com/v1/models',
        settings.deepSeekApiKey,
      ),
    ]);
    return { openRouter, deepSeek };
  }

  async getPublicSettings(): Promise<PublicSettings> {
    const settings = await this.getSettings();
    return {
      secretWarnings: this.unreadableSecrets.size
        ? [...this.unreadableSecrets.keys()].map((field) => ({
            field,
            message:
              'Saved credential cannot be decrypted. Restore the original secret key and restart, or replace/clear this credential.',
          }))
        : undefined,
      mediaDirs: settings.mediaDirs,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      openRouterApiKeyMasked: this.maskKey(
        settings.openRouterApiKey,
        'openRouterApiKey',
      ),
      deepSeekApiKeyMasked: this.maskKey(
        settings.deepSeekApiKey,
        'deepSeekApiKey',
      ),
      openRouterModel: settings.openRouterModel,
      deepSeekModel: settings.deepSeekModel,
      scanCacheTtlMinutes: settings.scanCacheTtlMinutes,
      concurrency: settings.concurrency,
      pathContainsExclusions: settings.pathContainsExclusions,
      fileTooLargeBytes: settings.fileTooLargeBytes,
      translationVerificationEnabled: settings.translationVerificationEnabled,
      rules: settings.rules,
      autoScanEnabled: settings.autoScanEnabled,
      autoScanCronExpression: settings.autoScanCronExpression,
      autoTranslateNewItems: settings.autoTranslateNewItems,
      telegramBotTokenMasked: this.maskKey(
        settings.telegramBotToken ?? '',
        'telegramBotToken',
      ),
      telegramChatId: settings.telegramChatId,
      telegramEnabled: settings.telegramEnabled,
      telegramEvents: settings.telegramEvents,
      dailyTokenLimitFree: settings.dailyTokenLimitFree,
      dailyTokenLimitPaid: settings.dailyTokenLimitPaid,
      monthlyBudgetUsd: settings.monthlyBudgetUsd,
      jellyfinUrl: settings.jellyfinUrl,
      jellyfinApiKeyMasked: this.maskKey(
        settings.jellyfinApiKey ?? '',
        'jellyfinApiKey',
      ),
      tmdbApiKeyMasked: this.maskKey(settings.tmdbApiKey ?? '', 'tmdbApiKey'),
      deepSeekInputCacheHitUsdPerMillion:
        settings.deepSeekInputCacheHitUsdPerMillion ?? 0.028,
      deepSeekInputCacheMissUsdPerMillion:
        settings.deepSeekInputCacheMissUsdPerMillion ?? 0.28,
      deepSeekOutputUsdPerMillion: settings.deepSeekOutputUsdPerMillion ?? 0.42,
      pricingUpdatedAt: settings.pricingUpdatedAt ?? '2025-09-05',
      pricingSource:
        settings.pricingSource ??
        'https://api-docs.deepseek.com/quick_start/pricing',
    };
  }

  async updateSettings(input: UpdateSettingsInput): Promise<PublicSettings> {
    const current = await this.getSettings();
    const { clearSecrets = [], ...updates } = input;
    if (
      !Array.isArray(clearSecrets) ||
      clearSecrets.some((field) => !SECRET_FIELDS.includes(field))
    )
      throw new BadRequestException('Invalid clearSecrets');
    const replacedSecrets = new Set<SecretField>(clearSecrets);
    const merged: RuntimeSettings = {
      ...current,
      ...updates,
      fileTooLargeBytes:
        input.fileTooLargeBytes === null
          ? undefined
          : (input.fileTooLargeBytes ?? current.fileTooLargeBytes),
      dailyTokenLimitFree:
        input.dailyTokenLimitFree === null
          ? undefined
          : (input.dailyTokenLimitFree ?? current.dailyTokenLimitFree),
      dailyTokenLimitPaid:
        input.dailyTokenLimitPaid === null
          ? undefined
          : (input.dailyTokenLimitPaid ?? current.dailyTokenLimitPaid),
      monthlyBudgetUsd:
        input.monthlyBudgetUsd === null
          ? undefined
          : (input.monthlyBudgetUsd ?? current.monthlyBudgetUsd),
    };
    for (const field of SECRET_FIELDS) {
      const value = input[field]?.trim();
      if (clearSecrets.includes(field)) merged[field] = '';
      else if (value && !isMaskedSecret(value)) {
        merged[field] = value;
        replacedSecrets.add(field);
      } else merged[field] = current[field] ?? '';
    }
    let oldHost = '';
    try {
      oldHost = current.jellyfinUrl ? new URL(current.jellyfinUrl).origin : '';
    } catch {
      /* Invalid legacy URLs remain repairable without forwarding old credentials. */
    }
    let newHost = '';
    try {
      newHost = merged.jellyfinUrl ? new URL(merged.jellyfinUrl).origin : '';
    } catch {
      throw new BadRequestException('Invalid Jellyfin URL');
    }
    if (
      oldHost !== newHost &&
      (!input.jellyfinApiKey?.trim() || isMaskedSecret(input.jellyfinApiKey))
    ) {
      merged.jellyfinApiKey = undefined;
      replacedSecrets.add('jellyfinApiKey');
    }
    const roots =
      this.configService.get<SubsyncEnvConfig>('subsync')!.mediaDirs;
    await validateSettings(merged, roots);
    if (
      merged.openRouterApiKey &&
      merged.openRouterApiKey !== current.openRouterApiKey
    )
      await this.assertOpenRouterKeyValid(merged.openRouterApiKey);
    if (
      merged.deepSeekApiKey &&
      merged.deepSeekApiKey !== current.deepSeekApiKey
    )
      await this.assertDeepSeekKeyValid(merged.deepSeekApiKey);
    await this.persist(merged, replacedSecrets);
    for (const field of replacedSecrets) this.unreadableSecrets.delete(field);
    this.cachedSettings = merged;
    return this.getPublicSettings();
  }

  async resetToEnvDefaults(): Promise<PublicSettings> {
    const defaults = this.loadFromEnv();
    await validateSettings(defaults);
    await this.persist(defaults, new Set(SECRET_FIELDS));
    this.unreadableSecrets.clear();
    this.cachedSettings = defaults;
    return this.getPublicSettings();
  }

  private loadFromEnv(): RuntimeSettings {
    const config = this.configService.get<SubsyncEnvConfig>('subsync');
    if (!config) {
      throw new Error('Missing subsync env config');
    }

    return {
      mediaDirs: config.mediaDirs,
      sourceLanguage: config.sourceLanguage,
      targetLanguage: config.targetLanguage,
      openRouterApiKey: config.openRouterApiKey,
      deepSeekApiKey: config.deepSeekApiKey,
      openRouterModel: 'openrouter/free',
      deepSeekModel: 'deepseek-chat',
      scanCacheTtlMinutes: config.scanCacheTtlMinutes,
      concurrency: config.concurrency,
      pathContainsExclusions: config.pathExclusions,
      fileTooLargeBytes: config.fileTooLargeBytes,
      translationVerificationEnabled: false,
      rules: DEFAULT_RULES,
      autoScanEnabled: false,
      autoScanCronExpression: '0 */6 * * *',
      autoTranslateNewItems: false,
      telegramBotToken: undefined,
      telegramChatId: undefined,
      telegramEnabled: false,
      telegramEvents: ['job.completed', 'job.failed', 'scan.completed'],
      dailyTokenLimitFree: undefined,
      dailyTokenLimitPaid: undefined,
      monthlyBudgetUsd: undefined,
      jellyfinUrl: undefined,
      jellyfinApiKey: undefined,
      tmdbApiKey: process.env.TMDB_API_KEY,
      deepSeekInputCacheHitUsdPerMillion: 0.028,
      deepSeekInputCacheMissUsdPerMillion: 0.28,
      deepSeekOutputUsdPerMillion: 0.42,
      pricingUpdatedAt: '2025-09-05',
      pricingSource: 'https://api-docs.deepseek.com/quick_start/pricing',
    };
  }

  private maskKey(key: string, field: SecretField): string {
    return key || this.unreadableSecrets.has(field) ? '••••••••' : '';
  }

  private async assertOpenRouterKeyValid(key: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
        redirect: 'error',
      });
      if (!res.ok) {
        throw new BadRequestException(
          res.status === 401
            ? 'OpenRouter API key is invalid or unauthorized'
            : `OpenRouter validation failed (HTTP ${res.status})`,
        );
      }
    } catch (e) {
      if (e instanceof BadRequestException) {
        throw e;
      }
      const aborted = e instanceof Error && e.name === 'AbortError';
      throw new BadRequestException(
        aborted
          ? 'OpenRouter validation timed out'
          : 'Could not reach OpenRouter to validate the API key',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async assertDeepSeekKeyValid(key: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch('https://api.deepseek.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
        redirect: 'error',
      });
      if (!res.ok) {
        throw new BadRequestException(
          res.status === 401
            ? 'DeepSeek API key is invalid or unauthorized'
            : `DeepSeek validation failed (HTTP ${res.status})`,
        );
      }
    } catch (e) {
      if (e instanceof BadRequestException) {
        throw e;
      }
      const aborted = e instanceof Error && e.name === 'AbortError';
      throw new BadRequestException(
        aborted
          ? 'DeepSeek validation timed out'
          : 'Could not reach DeepSeek to validate the API key',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
