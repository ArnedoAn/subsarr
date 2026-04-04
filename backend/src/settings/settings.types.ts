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
}

export interface PublicSettings {
  mediaDirs: string[];
  sourceLanguage: string;
  targetLanguage: string;
  openRouterApiKeyMasked: string;
  deepSeekApiKeyMasked: string;
  openRouterModel: string;
  deepSeekModel: string;
  scanCacheTtlMinutes: number;
  concurrency: number;
  pathContainsExclusions: string[];
  fileTooLargeBytes?: number;
  translationVerificationEnabled: boolean;
  rules: RuleToggleConfig[];
  autoScanEnabled: boolean;
  autoScanCronExpression: string;
  autoTranslateNewItems: boolean;
  telegramBotTokenMasked: string;
  telegramChatId?: string;
  telegramEnabled: boolean;
  telegramEvents: string[];
  dailyTokenLimitFree?: number;
  dailyTokenLimitPaid?: number;
  monthlyBudgetUsd?: number;
  jellyfinUrl?: string;
  jellyfinApiKeyMasked: string;
}

export interface UpdateSettingsInput {
  mediaDirs: string[];
  sourceLanguage: string;
  targetLanguage: string;
  openRouterApiKey?: string;
  deepSeekApiKey?: string;
  openRouterModel?: string;
  deepSeekModel?: string;
  scanCacheTtlMinutes: number;
  concurrency: number;
  pathContainsExclusions: string[];
  fileTooLargeBytes?: number;
  translationVerificationEnabled: boolean;
  rules: RuleToggleConfig[];
  autoScanEnabled?: boolean;
  autoScanCronExpression?: string;
  autoTranslateNewItems?: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramEnabled?: boolean;
  telegramEvents?: string[];
  dailyTokenLimitFree?: number;
  dailyTokenLimitPaid?: number;
  monthlyBudgetUsd?: number;
  jellyfinUrl?: string;
  jellyfinApiKey?: string;
}
