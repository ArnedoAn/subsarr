const STORAGE_KEY = 'subsarr-library-filters';
const VERSION = 1 as const;

export type LibraryFiltersSnapshot = {
  v: typeof VERSION;
  query: string;
  folderFilter: string;
  statusFilter: 'all' | 'ready' | 'skipped' | 'no-source';
  missingTargetOnly: boolean;
  targetLangFilter: string;
  filtersOpen: boolean;
  currentPage: number;
  itemsPerPage: number;
  batchSource: string;
  batchTarget: string;
  batchProvider: 'openrouter' | 'deepseek';
};

export function readLibraryFiltersCache(): LibraryFiltersSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LibraryFiltersSnapshot>;
    if (p.v !== VERSION) return null;
    if (
      typeof p.query !== 'string' ||
      typeof p.folderFilter !== 'string' ||
      typeof p.statusFilter !== 'string' ||
      typeof p.missingTargetOnly !== 'boolean' ||
      typeof p.targetLangFilter !== 'string' ||
      typeof p.filtersOpen !== 'boolean' ||
      typeof p.currentPage !== 'number' ||
      typeof p.itemsPerPage !== 'number' ||
      typeof p.batchSource !== 'string' ||
      typeof p.batchTarget !== 'string' ||
      (p.batchProvider !== 'openrouter' && p.batchProvider !== 'deepseek')
    ) {
      return null;
    }
    return p as LibraryFiltersSnapshot;
  } catch {
    return null;
  }
}

export function writeLibraryFiltersCache(snapshot: Omit<LibraryFiltersSnapshot, 'v'>): void {
  if (typeof window === 'undefined') return;
  try {
    const full: LibraryFiltersSnapshot = { v: VERSION, ...snapshot };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(full));
  } catch {
    /* ignore quota / private mode */
  }
}
