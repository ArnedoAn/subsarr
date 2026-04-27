import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(SettingEntity)
    private readonly settingsRepo: Repository<SettingEntity>,
  ) {}

  async getSettings(): Promise<RuntimeSettings> {
    if (this.cachedSettings) {
      return this.cachedSettings;
    }

    const base = this.loadFromEnv();
    const row = await this.settingsRepo.findOne({
      where: { id: SETTINGS_ROW_ID },
    });
    if (row) {
      this.cachedSettings = entityToRuntime(row);
      return this.cachedSettings;
    }

    const entity = runtimeToEntity(base);
    await this.settingsRepo.save(entity);
    this.cachedSettings = base;
    return this.cachedSettings;
  }

  async fetchAvailableModels(): Promise<{
    openRouter: string[];
    deepSeek: string[];
  }> {
    const s = await this.getSettings();
    const out = { openRouter: [] as string[], deepSeek: [] as string[] };
    if (s.openRouterApiKey?.trim()) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: `Bearer ${s.openRouterApiKey.trim()}` },
          signal: AbortSignal.timeout(12_000),
        });
        const j = (await res.json()) as {
          data?: Array<{ id?: string }>;
        };
        out.openRouter = (j.data ?? [])
          .map((m) => m.id)
          .filter((id): id is string => !!id)
          .slice(0, 120);
      } catch {
        /* ignore */
      }
    }
    if (s.deepSeekApiKey?.trim()) {
      try {
        const res = await fetch('https://api.deepseek.com/v1/models', {
          headers: { Authorization: `Bearer ${s.deepSeekApiKey.trim()}` },
          signal: AbortSignal.timeout(12_000),
        });
        const j = (await res.json()) as {
          data?: Array<{ id?: string }>;
        };
        out.deepSeek = (j.data ?? [])
          .map((m) => m.id)
          .filter((id): id is string => !!id);
      } catch {
        /* ignore */
      }
    }
    return out;
  }

  async getPublicSettings(): Promise<PublicSettings> {
    const settings = await this.getSettings();
    return {
      mediaDirs: settings.mediaDirs,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      openRouterApiKeyMasked: this.maskKey(settings.openRouterApiKey),
      deepSeekApiKeyMasked: this.maskKey(settings.deepSeekApiKey),
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
      telegramBotTokenMasked: this.maskKey(settings.telegramBotToken ?? ''),
      telegramChatId: settings.telegramChatId,
      telegramEnabled: settings.telegramEnabled,
      telegramEvents: settings.telegramEvents,
      dailyTokenLimitFree: settings.dailyTokenLimitFree,
      dailyTokenLimitPaid: settings.dailyTokenLimitPaid,
      monthlyBudgetUsd: settings.monthlyBudgetUsd,
      jellyfinUrl: settings.jellyfinUrl,
      jellyfinApiKeyMasked: this.maskKey(settings.jellyfinApiKey ?? ''),
    };
  }

  async updateSettings(input: UpdateSettingsInput): Promise<PublicSettings> {
    const current = await this.getSettings();
    const merged: RuntimeSettings = {
      ...current,
      ...input,
      sourceLanguage: input.sourceLanguage.toLowerCase(),
      targetLanguage: input.targetLanguage.toLowerCase(),
      openRouterApiKey:
        input.openRouterApiKey && input.openRouterApiKey.trim().length > 0
          ? input.openRouterApiKey.trim()
          : current.openRouterApiKey,
      deepSeekApiKey:
        input.deepSeekApiKey && input.deepSeekApiKey.trim().length > 0
          ? input.deepSeekApiKey.trim()
          : current.deepSeekApiKey,
      openRouterModel: input.openRouterModel?.trim() || current.openRouterModel,
      deepSeekModel: input.deepSeekModel?.trim() || current.deepSeekModel,
      mediaDirs: input.mediaDirs
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
      pathContainsExclusions: input.pathContainsExclusions
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
      translationVerificationEnabled: input.translationVerificationEnabled,
      rules: input.rules,
      autoScanEnabled: input.autoScanEnabled ?? current.autoScanEnabled,
      autoScanCronExpression:
        input.autoScanCronExpression?.trim() || current.autoScanCronExpression,
      autoTranslateNewItems:
        input.autoTranslateNewItems ?? current.autoTranslateNewItems,
      telegramBotToken:
        input.telegramBotToken && input.telegramBotToken.trim().length > 0
          ? input.telegramBotToken.trim()
          : current.telegramBotToken,
      telegramChatId: input.telegramChatId?.trim() || current.telegramChatId,
      telegramEnabled: input.telegramEnabled ?? current.telegramEnabled,
      telegramEvents: input.telegramEvents ?? current.telegramEvents,
      dailyTokenLimitFree:
        input.dailyTokenLimitFree ?? current.dailyTokenLimitFree,
      dailyTokenLimitPaid:
        input.dailyTokenLimitPaid ?? current.dailyTokenLimitPaid,
      monthlyBudgetUsd: input.monthlyBudgetUsd ?? current.monthlyBudgetUsd,
      jellyfinUrl: input.jellyfinUrl?.trim() || current.jellyfinUrl,
      jellyfinApiKey:
        input.jellyfinApiKey && input.jellyfinApiKey.trim().length > 0
          ? input.jellyfinApiKey.trim()
          : current.jellyfinApiKey,
    };

    if (input.openRouterApiKey?.trim()) {
      await this.assertOpenRouterKeyValid(merged.openRouterApiKey);
    }
    if (input.deepSeekApiKey?.trim()) {
      await this.assertDeepSeekKeyValid(merged.deepSeekApiKey);
    }

    await this.settingsRepo.save(runtimeToEntity(merged));
    this.cachedSettings = merged;
    return this.getPublicSettings();
  }

  async resetToEnvDefaults(): Promise<PublicSettings> {
    const defaults = this.loadFromEnv();
    await this.settingsRepo.save(runtimeToEntity(defaults));
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
    };
  }

  private maskKey(key: string): string {
    if (!key || key.length < 8) {
      return '';
    }

    const start = key.slice(0, 4);
    const end = key.slice(-4);
    return `${start}****${end}`;
  }

  private async assertOpenRouterKeyValid(key: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
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
