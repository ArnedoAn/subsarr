export interface SubtitleTrack {
  index: number;
  language: string;
  title?: string;
  codec: string;
}

export interface ExternalSubtitle {
  path: string;
  language: string;
  forced: boolean;
}

export interface MediaItem {
  id: string;
  path: string;
  name: string;
  type: 'movie' | 'episode' | 'unknown';
  subtitleTracks: SubtitleTrack[];
  externalSubtitles: ExternalSubtitle[];
  size: number;
  lastModified: string;
  ruleStatus?: {
    skip: boolean;
    reason?: string;
  };
}

/** Library list with `includeRules=true` (ruleStatus is always set). */
export interface MediaItemWithRuleStatus extends MediaItem {
  ruleStatus: { skip: boolean; reason?: string };
}

export type BatchPreviewRow = {
  mediaItemId: string;
  status:
    | 'ready'
    | 'no_source_track'
    | 'rule_blocked'
    | 'not_found'
    | 'error';
  sourceTrackIndex?: number;
  reason?: string;
};

export type BatchEnqueueResultItem = {
  mediaItemId: string;
  id?: string | number;
  error?: string;
};

export interface RuleEvaluation {
  id: string;
  label: string;
  enabled: boolean;
  skip: boolean;
  reason?: string;
}

export interface RuleDefinition {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

export interface SettingsPayload {
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
  rules: Array<{ id: string; enabled: boolean }>;
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

export interface JobResult {
  id: string | number;
  data: {
    mediaItemId: string;
    mediaItemPath: string;
    sourceLanguage: string;
    targetLanguage: string;
  };
  progress: number;
  state: string;
  returnValue?: {
    outputPath: string;
    tierUsed: 'free' | 'paid';
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    lineCount: number;
  };
  failedReason?: string;
  createdAt: number;
  processedAt?: number;
  finishedAt?: number;
  /** Solo en jobs cargados desde disco tras reinicio (Redis vacío) */
  archived?: boolean;
}
