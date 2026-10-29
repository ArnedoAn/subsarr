import type { SecretField } from './secret-store';
import type { SettingsPayload } from '../contracts/api';
import type { TranslationProvider } from '../contracts/providers';

export interface RuleToggleConfig {
  id: string;
  enabled: boolean;
}

export interface RuntimeSettings {
  mediaDirs: string[];
  sourceLanguage: string;
  targetLanguage: string;
  openRouterApiKey: string;
  deepSeekApiKey: string;
  openRouterModel: string;
  deepSeekModel: string;
  opencodeGoApiKey?: string;
  opencodeGoModel?: string;
  defaultProvider?: TranslationProvider;
  scanCacheTtlMinutes: number;
  concurrency: number;
  pathContainsExclusions: string[];
  fileTooLargeBytes?: number;
  translationVerificationEnabled: boolean;
  rules: RuleToggleConfig[];
  autoScanEnabled: boolean;
  autoScanCronExpression: string;
  autoTranslateNewItems: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramEnabled: boolean;
  telegramEvents: string[];
  dailyTokenLimitFree?: number;
  dailyTokenLimitPaid?: number;
  monthlyBudgetUsd?: number;
  jellyfinUrl?: string;
  jellyfinApiKey?: string;
  tmdbApiKey?: string;
  deepSeekInputCacheHitUsdPerMillion?: number;
  deepSeekInputCacheMissUsdPerMillion?: number;
  deepSeekOutputUsdPerMillion?: number;
  pricingUpdatedAt?: string;
  pricingSource?: string;
}

export type PublicSettings = SettingsPayload;

export interface UpdateSettingsInput {
  clearSecrets?: SecretField[];
  mediaDirs: string[];
  sourceLanguage: string;
  targetLanguage: string;
  openRouterApiKey?: string;
  deepSeekApiKey?: string;
  openRouterModel?: string;
  deepSeekModel?: string;
  opencodeGoApiKey?: string;
  opencodeGoModel?: string;
  defaultProvider?: TranslationProvider;
  scanCacheTtlMinutes: number;
  concurrency: number;
  pathContainsExclusions: string[];
  fileTooLargeBytes?: number | null;
  translationVerificationEnabled: boolean;
  rules: RuleToggleConfig[];
  autoScanEnabled?: boolean;
  autoScanCronExpression?: string;
  autoTranslateNewItems?: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramEnabled?: boolean;
  telegramEvents?: string[];
  dailyTokenLimitFree?: number | null;
  dailyTokenLimitPaid?: number | null;
  monthlyBudgetUsd?: number | null;
  jellyfinUrl?: string;
  jellyfinApiKey?: string;
  tmdbApiKey?: string;
  deepSeekInputCacheHitUsdPerMillion?: number;
  deepSeekInputCacheMissUsdPerMillion?: number;
  deepSeekOutputUsdPerMillion?: number;
  pricingUpdatedAt?: string;
  pricingSource?: string;
}
