// Public JSON transport contracts. Never add runtime settings or secrets here.
// Run `node scripts/generate-contracts.cjs` after editing this file.
import type {
  TranslationProvider,
  TranslationBillingTier,
  TranslationQualityMode,
} from './providers';
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
  probeStatus: 'ok' | 'failed' | 'skipped' | 'pending';
  subtitleTracks: SubtitleTrack[];
  externalSubtitles: ExternalSubtitle[];
  size: number;
  lastModified: string;
  series?: string;
  season?: number;
  episodes?: number[];
  year?: number;
  groupKey?: string;
  ruleStatus?: { skip: boolean; reason?: string };
}
export interface MediaItemWithRuleStatus extends MediaItem {
  ruleStatus: { skip: boolean; reason?: string };
}
export interface LibraryPageResult {
  items: MediaItemWithRuleStatus[];
  total: number;
  offset: number;
  limit: number;
}
export interface LibraryGroup {
  key: string;
  label: string;
  type: 'movie' | 'episode' | 'unknown';
  count: number;
  seasons: number[];
  targetPresent: number;
  missingTarget: number;
}
export interface LibraryGroupsResult {
  groups: LibraryGroup[];
  folders: string[];
  targetLanguage: string;
}
export type BatchPreviewRow = {
  mediaItemId: string;
  status: 'ready' | 'no_source_track' | 'rule_blocked' | 'not_found' | 'error';
  sourceTrackIndex?: number;
  reason?: string;
  name?: string;
  path?: string;
  alreadyTranslated?: boolean;
};
export type BatchEnqueueResultItem = {
  mediaItemId: string;
  id?: string | number;
  error?: string;
  index?: number;
  status?: 'queued' | 'conflict' | 'rejected';
  errorCode?: number;
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
  opencodeGoApiKeyMasked: string;
  opencodeGoModel: string;
  defaultProvider: TranslationProvider;
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
  dailyTokenLimitFree?: number | null;
  dailyTokenLimitPaid?: number | null;
  monthlyBudgetUsd?: number | null;
  jellyfinUrl?: string;
  jellyfinApiKeyMasked: string;
  tmdbApiKeyMasked: string;
  deepSeekInputCacheHitUsdPerMillion: number;
  deepSeekInputCacheMissUsdPerMillion: number;
  deepSeekOutputUsdPerMillion: number;
  pricingUpdatedAt: string;
  pricingSource: string;
  secretWarnings?: Array<{ field: string; message: string }>;
}
export interface BudgetStatus {
  spentUsd: number;
  budgetUsd: number | null;
  ratio: number | null;
  level: 'ok' | 'warning' | 'exceeded';
}
export interface LibraryScanMetrics {
  scanId: string;
  concurrency: number;
  discoveredFiles: number;
  processedFiles: number;
  itemCount: number;
  cacheHits: number;
  negativeCacheHits: number;
  cacheMisses: number;
  cacheReadErrors: number;
  cacheWriteErrors: number;
  cacheMalformedEntries: number;
  probes: number;
  probeErrors: number;
  probeTimeouts: number;
  skippedLargeFiles: number;
  statFailures: number;
  itemFailures: number;
  directoryErrors: number;
  sidecarReadErrors: number;
  pendingFiles?: number;
  watcher?: {
    enabled: boolean;
    watching: number;
    dirtyDirectories: number;
    reconciling: boolean;
    overflow: number;
    errors: string[];
  };
  wallTimeMs: number;
  discoveryWallTimeMs: number;
  buildWallTimeMs: number;
  /** Summed operation durations; concurrent operations can exceed wall time. */
  statDurationMs: number;
  cacheReadDurationMs: number;
  cacheWriteDurationMs: number;
  probeDurationMs: number;
  sidecarReadDurationMs: number;
  probeP50Ms: number | null;
  probeP95Ms: number | null;
  probeMaxMs: number | null;
  roots: Array<{
    path: string;
    durationMs: number;
    discoveredFiles: number;
    directoryErrors: number;
  }>;
}
export interface LibraryScanStatus {
  state: 'idle' | 'running' | 'completed' | 'failed';
  trigger:
    | 'startup'
    | 'request'
    | 'cache-refresh'
    | 'manual'
    | 'scheduled'
    | null;
  startedAt: number | null;
  finishedAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  lastDurationMs: number | null;
  lastItemCount: number | null;
  metrics: LibraryScanMetrics | null;
}
export interface JobResult {
  id: string | number;
  data: {
    mediaItemId: string;
    mediaItemPath: string;
    sourceLanguage: string;
    targetLanguage: string;
    provider?: TranslationProvider;
    model?: string;
    sessionId?: string;
    qualityMode?: TranslationQualityMode;
    contextHint?: string;
    useTranslationMemory?: boolean;
    triggeredBy?: 'manual' | 'batch' | 'auto-scan';
  };
  progress: number;
  state: string;
  returnValue?: {
    outputPath: string;
    tierUsed: TranslationBillingTier;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    lineCount: number;
    qualityReport?: {
      warningCount: number;
      errorCount: number;
      suspectCueIndices: number[];
    };
    checkpointKey?: string;
    checkpointReusedCues?: number;
    memoryReusedCues?: number;
    contextSheet?: string;
    workspace?: { mediaItemId: string; subtitlePath: string };
  };
  failedReason?: string;
  createdAt: number;
  processedAt?: number;
  finishedAt?: number;
  archived?: boolean;
}
export interface JobsPageResponse {
  jobs: JobResult[];
  total: number;
  offset: number;
  limit: number;
}
export interface LogEntry {
  id: string;
  jobId?: string;
  level: 'info' | 'warn' | 'error';
  phase: string;
  message: string;
  timestamp: string;
  details?: unknown;
}
export interface LogsPageResponse {
  logs: LogEntry[];
  total: number;
  nextCursor?: string | null;
}
