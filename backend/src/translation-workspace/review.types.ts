export interface ReviewWorkspace {
  id: string;
  revision: number;
  filename: string;
  format: 'srt' | 'ass' | 'ssa' | 'vtt';
  sourceLanguage: string;
  targetLanguage: string;
  contextSheet: string;
  cueCount: number;
  libraryMediaId?: string;
  expiresAt: string;
}
export interface ReviewCue {
  cueIndex: number;
  index: number;
  start: string;
  end: string;
  source: string;
  text: string;
  charsPerSecond: number;
  lineLengths: number[];
  issues: Array<{
    code: string;
    message: string;
    severity: 'warning' | 'error';
  }>;
}
export interface ReviewWorkspacePage extends ReviewWorkspace {
  offset: number;
  limit: number;
  cues: ReviewCue[];
  quality: { totalCues: number; warningCount: number; errorCount: number };
}
export interface ReviewCueEdit {
  cueIndex: number;
  text: string;
}
export interface ReviewEditRequest {
  expectedRevision: number;
  edits: ReviewCueEdit[];
}
export interface ReviewContextRequest {
  expectedRevision: number;
  contextSheet: string;
}
export interface ReviewRetranslateRequest {
  expectedRevision: number;
  cueIndices: number[];
  provider?: 'openrouter' | 'deepseek' | 'opencode-go';
  model?: string;
  allowBudgetOverride?: boolean;
}
export interface ReviewOperation {
  id: string;
  workspaceId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progressPercent: number;
  revision: number;
  error?: string;
}
export interface ReviewLibraryRequest {
  subtitlePath: string;
  sourceTrackIndex?: number;
  targetLanguage?: string;
  sourceLanguage?: string;
}
export interface ReviewSaveRequest {
  expectedRevision: number;
  overwrite?: boolean;
}
export interface ReviewApproveRequest {
  expectedRevision: number;
  cueIndices: number[];
  approved: true;
}
