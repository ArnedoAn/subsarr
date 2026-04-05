import type { SubtitleOutputExtension } from '../translation/subtitle-format';

export type JobPhase =
  | 'waiting'
  | 'active'
  | 'extracting'
  | 'translating'
  | 'validating'
  | 'correcting'
  | 'writing'
  | 'completed'
  | 'failed';

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
  provider?: 'openrouter' | 'deepseek';
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
  details?: any;
  tokenUsage?: JobProgressTokenUsage;
}

export interface JobReturnValue {
  outputPath: string;
  tierUsed: 'free' | 'paid';
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  lineCount: number;
}
