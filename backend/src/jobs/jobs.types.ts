export type JobPhase =
  | 'waiting'
  | 'active'
  | 'extracting'
  | 'translating'
  | 'writing'
  | 'completed'
  | 'failed';

export interface TranslationJobPayload {
  mediaItemId: string;
  mediaItemPath?: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceTrackIndex: number;
  triggeredBy: 'manual' | 'batch';
  forceBypassRules?: boolean;
  provider?: 'openrouter' | 'deepseek';
}

export interface JobProgressEvent {
  phase: JobPhase;
  progressPercent: number;
  message: string;
  timestamp: string;
  details?: any;
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
