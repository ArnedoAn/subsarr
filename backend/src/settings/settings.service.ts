import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { type SubsyncEnvConfig } from '../config/subsync.config';
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

  constructor(private readonly configService: ConfigService) {}

  async getSettings(): Promise<RuntimeSettings> {
    if (this.cachedSettings) {
      return this.cachedSettings;
    }

    const base = this.loadFromEnv();
    this.cachedSettings = await this.loadFromFileOrDefault(base);
    return this.cachedSettings;
  }

  async getPublicSettings(): Promise<PublicSettings> {
    const settings = await this.getSettings();
    return {
      mediaDirs: settings.mediaDirs,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      openRouterApiKeyMasked: this.maskKey(settings.openRouterApiKey),
      deepSeekApiKeyMasked: this.maskKey(settings.deepSeekApiKey),
      scanCacheTtlMinutes: settings.scanCacheTtlMinutes,
      concurrency: settings.concurrency,
      pathContainsExclusions: settings.pathContainsExclusions,
      fileTooLargeBytes: settings.fileTooLargeBytes,
      translationVerificationEnabled: settings.translationVerificationEnabled,
      rules: settings.rules,
    };
  }

  async updateSettings(input: UpdateSettingsInput): Promise<PublicSettings> {
    const current = await this.getSettings();
    const merged: RuntimeSettings = {
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
      mediaDirs: input.mediaDirs
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
      pathContainsExclusions: input.pathContainsExclusions
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
      translationVerificationEnabled: input.translationVerificationEnabled,
      rules: input.rules,
    };

    await this.writeSettingsFile(merged);
    this.cachedSettings = merged;
    return this.getPublicSettings();
  }

  async resetToEnvDefaults(): Promise<PublicSettings> {
    const defaults = this.loadFromEnv();
    await this.writeSettingsFile(defaults);
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
      scanCacheTtlMinutes: config.scanCacheTtlMinutes,
      concurrency: config.concurrency,
      pathContainsExclusions: config.pathExclusions,
      fileTooLargeBytes: config.fileTooLargeBytes,
      translationVerificationEnabled: false,
      rules: DEFAULT_RULES,
    };
  }

  private async loadFromFileOrDefault(
    defaults: RuntimeSettings,
  ): Promise<RuntimeSettings> {
    const config = this.configService.get<SubsyncEnvConfig>('subsync');
    if (!config) {
      return defaults;
    }

    try {
      const fileContent = await fs.readFile(config.settingsFilePath, 'utf8');
      const parsed = JSON.parse(fileContent) as Partial<RuntimeSettings>;

      return {
        ...defaults,
        ...parsed,
        sourceLanguage: (
          parsed.sourceLanguage ?? defaults.sourceLanguage
        ).toLowerCase(),
        targetLanguage: (
          parsed.targetLanguage ?? defaults.targetLanguage
        ).toLowerCase(),
        mediaDirs: (parsed.mediaDirs ?? defaults.mediaDirs).filter(
          (entry) => entry.length > 0,
        ),
        pathContainsExclusions: (
          parsed.pathContainsExclusions ?? defaults.pathContainsExclusions
        ).filter((entry) => entry.length > 0),
        translationVerificationEnabled:
          parsed.translationVerificationEnabled ??
          defaults.translationVerificationEnabled,
        rules: parsed.rules ?? defaults.rules,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        await this.writeSettingsFile(defaults);
        return defaults;
      }

      this.logger.warn('Settings file was invalid, using env defaults');
      return defaults;
    }
  }

  private async writeSettingsFile(settings: RuntimeSettings): Promise<void> {
    const config = this.configService.get<SubsyncEnvConfig>('subsync');
    if (!config) {
      return;
    }

    const directory = path.dirname(config.settingsFilePath);
    await fs.mkdir(directory, { recursive: true });

    const tempPath = `${config.settingsFilePath}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(settings, null, 2), 'utf8');
    await fs.rename(tempPath, config.settingsFilePath);
  }

  private maskKey(key: string): string {
    if (!key || key.length < 8) {
      return '';
    }

    const start = key.slice(0, 4);
    const end = key.slice(-4);
    return `${start}****${end}`;
  }
}
