import type { SubtitleOutputExtension } from '../translation/subtitle-format';
import type {
  TranslationProvider,
  TranslationBillingTier,
} from '../contracts/providers';

export type JobPhase =
  | 'waiting'
  | 'active'
  | 'extracting'
  | 'translating'
  | 'validating'
  | 'correcting'
  | 'writing'
  | 'completed'
  | 'failed'
  | 'cancelling'
  | 'cancelled';

export interface TranslationJobPayload {
  mediaItemId: string;
  mediaItemPath?: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceTrackIndex: number;
  /** Matches embedded source track codec (srt for subrip etc., ass for ass/ssa). */
  outputExtension?: SubtitleOutputExtension;
  /** Overwrite existing target file, or write `name.lang.2.ext` instead of `name.lang.ext`. */
  targetConflictResolution?: 'replace' | 'alternate';
  /** When translating to multiple targets in one request. */
  batchGroupId?: string;
  triggeredBy: 'manual' | 'batch' | 'auto-scan';
  forceBypassRules?: boolean;
  provider?: TranslationProvider;
  model?: string;
  sessionId?: string;
  qualityMode?: 'fast' | 'balanced' | 'review';
  contextHint?: string;
  useTranslationMemory?: boolean;
  allowBudgetOverride?: boolean;
  automatic?: boolean;
}

export interface JobProgressTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  tierUsed: string;
  estimatedCostUsd: number;
}

export interface JobProgressEvent {
  phase: JobPhase;
  progressPercent: number;
  message: string;
  timestamp: string;
  details?: unknown;
  tokenUsage?: JobProgressTokenUsage;
}

export interface JobProgressStreamEvent extends JobProgressEvent {
  jobId: string;
  type: JobPhase;
}

export interface JobReturnValue {
  outputPath: string;
  tierUsed: TranslationBillingTier;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  lineCount: number;
  provider?: TranslationProvider;
  model?: string;
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
}
