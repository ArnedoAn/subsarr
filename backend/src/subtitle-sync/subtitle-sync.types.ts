export type SubtitleSyncReferenceMode = 'auto' | 'audio' | 'track';
export type SubtitleSyncState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type SubtitleSyncConflictResolution = 'fail' | 'replace' | 'alternate';

/** Timing source the subtitle was aligned against. */
export type SubtitleSyncReferenceUsed =
  | { kind: 'audio' }
  | { kind: 'track'; trackIndex: number; language: string };

export interface SubtitleSyncResult {
  outputPath: string;
  /** Representative offset; piecewise alignments may use several offsets. */
  offsetSeconds: number;
  /** Ratio applied to correct framerate drift, 1 when unchanged. */
  framerateScaleFactor: number;
  cueCount: number;
}

export interface SubtitleSyncTask {
  id: string;
  mediaItemId: string;
  inputName: string;
  language: string;
  forced: boolean;
  allowSplits: boolean;
  maxOffsetSeconds: number;
  state: SubtitleSyncState;
  reference: SubtitleSyncReferenceUsed | null;
  /** Audio decoding progress, 0..100; null when unknown or not decoding audio. */
  progressPercent: number | null;
  message: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: SubtitleSyncResult | null;
  error: string | null;
}
