export type QuickFileState =
  | 'queued'
  | 'translating'
  | 'completed'
  | 'failed'
  | 'cancelled';
export interface QuickFileSnapshot {
  id: string;
  name: string;
  downloadName: string;
  state: QuickFileState;
  progress: number;
  cueCount: number;
  error?: string;
  errorCode?: 'BUDGET_OVERRIDE_REQUIRED';
  warnings: string[];
  qualityReport?: {
    warningCount: number;
    errorCount: number;
    suspectCueIndices: number[];
  };
  checkpointReusedCues?: number;
  memoryReusedCues?: number;
  contextSheet?: string;
  provider?: 'deepseek' | 'openrouter' | 'opencode-go';
  model?: string;
  tierUsed?: 'free' | 'paid' | 'subscription';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
export interface QuickBatchSnapshot {
  id: string;
  revision: number;
  expiresAt: string | null;
  files: QuickFileSnapshot[];
}
export interface QuickTranslationOptions {
  sourceLanguage?: string;
  targetLanguage: string;
  provider?: 'deepseek' | 'openrouter' | 'opencode-go';
  model?: string;
  qualityMode?: 'fast' | 'balanced' | 'review';
  contextHint?: string;
  useTranslationMemory?: boolean;
  verificationEnabled?: boolean;
  allowBudgetOverride?: boolean;
}
