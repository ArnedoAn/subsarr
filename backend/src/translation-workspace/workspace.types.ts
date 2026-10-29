export type SubtitleQualityMode = 'fast' | 'balanced' | 'review';
export interface SubtitleQualityIssue {
  code: string;
  message: string;
  severity: 'warning' | 'error';
}
export interface SubtitleCueQuality {
  cueIndex: number;
  index: number;
  start: string;
  end: string;
  source: string;
  text: string;
  charsPerSecond: number;
  lineLengths: number[];
  issues: SubtitleQualityIssue[];
}
export interface SubtitleQualityReport {
  cues: SubtitleCueQuality[];
  warningCount: number;
  errorCount: number;
  suspectCueIndices: number[];
}
export interface WorkspaceMemoryEntry {
  id: string;
  source: string;
  target: string;
  contextHash: string;
  sourceLanguage: string;
  targetLanguage: string;
  signature: string;
  approved: boolean;
  model: string | null;
  provenance: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface WorkspaceMemoryPage {
  entries: WorkspaceMemoryEntry[];
  total: number;
}
export interface WorkspaceCheckpointSummary {
  key: string;
  createdAt: number;
  updatedAt: number;
  translatedCues: number;
  hasContext: boolean;
}
export interface WorkspaceCheckpointPage {
  entries: WorkspaceCheckpointSummary[];
  total: number;
}
