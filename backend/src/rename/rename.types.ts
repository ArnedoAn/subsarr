export type RenameKind = 'movie' | 'episode' | 'anime' | 'unknown';
export interface RenameClassification {
  kind: RenameKind;
  title: string;
  year?: number;
  season?: number;
  episodes?: number[];
  absolute?: number;
  confidence: 'high' | 'medium' | 'low' | 'manual';
}
export interface RenameTemplates {
  movie: string;
  series: string;
  anime: string;
}
export interface RenamePlanRow {
  id: string;
  groupId: string;
  originalPath: string;
  proposedPath: string;
  sidecar: boolean;
  selected: boolean;
  customFilename?: string;
  classification: RenameClassification;
  status: 'safe' | 'unchanged' | 'conflict' | 'unclassified';
  reason?: string;
}
export interface RenamePlan {
  id: string;
  expiresAt: string;
  directory: string;
  seasonFolders: boolean;
  templates: RenameTemplates;
  rows: RenamePlanRow[];
}
export interface RenameMetadataMatch {
  id: string;
  source: 'jellyfin' | 'tmdb';
  title: string;
  year?: number;
  kind: 'movie' | 'episode';
}
export interface RenameOutcome {
  id: string;
  originalPath: string;
  proposedPath: string;
  status: 'renamed' | 'undone' | 'failed' | 'unchanged';
  reason?: string;
}
export interface RenameBatchResult {
  batchId: string;
  outcomes: RenameOutcome[];
}
export interface RenameHistoryRow {
  id: string;
  batchId: string;
  originalPath: string;
  destinationPath: string;
  state: 'pending' | 'renamed' | 'failed' | 'undone';
  error: string | null;
  createdAt: string;
}
