import type { LibraryScanMetrics, LibraryScanStatus } from '../contracts/api';

export interface LibraryWatchStatus {
  enabled: boolean;
  watching: number;
  dirtyDirectories: number;
  reconciling: boolean;
  overflow: number;
  errors: string[];
}

export interface LibraryScanFailure {
  event: string;
  path?: string;
  error?: string;
}

export interface LibraryScanRun {
  id: string;
  trigger: LibraryScanStatus['trigger'];
  state: 'completed' | 'failed';
  startedAt: number;
  finishedAt: number;
  error: string | null;
  metrics: LibraryScanMetrics;
  failures: LibraryScanFailure[];
  slowFiles: Array<{ path: string; durationMs: number }>;
  watcher: LibraryWatchStatus;
}

export interface LibraryScanPage {
  items: LibraryScanRun[];
  total: number;
  offset: number;
  limit: number;
}
