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
  provider?: 'deepseek' | 'openrouter';
  verificationEnabled?: boolean;
  allowBudgetOverride?: boolean;
}
