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
  scanCacheTtlMinutes: number;
  concurrency: number;
  pathContainsExclusions: string[];
  fileTooLargeBytes?: number;
  translationVerificationEnabled: boolean;
  rules: RuleToggleConfig[];
}

export interface PublicSettings {
  mediaDirs: string[];
  sourceLanguage: string;
  targetLanguage: string;
  openRouterApiKeyMasked: string;
  deepSeekApiKeyMasked: string;
  scanCacheTtlMinutes: number;
  concurrency: number;
  pathContainsExclusions: string[];
  fileTooLargeBytes?: number;
  translationVerificationEnabled: boolean;
  rules: RuleToggleConfig[];
}

export interface UpdateSettingsInput {
  mediaDirs: string[];
  sourceLanguage: string;
  targetLanguage: string;
  openRouterApiKey?: string;
  deepSeekApiKey?: string;
  scanCacheTtlMinutes: number;
  concurrency: number;
  pathContainsExclusions: string[];
  fileTooLargeBytes?: number;
  translationVerificationEnabled: boolean;
  rules: RuleToggleConfig[];
}
