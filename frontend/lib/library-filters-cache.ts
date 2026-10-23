const STORAGE_KEY = 'subsarr-library-filters-v2';
export type LibraryFilters = {
  q: string; folder: string; group: string; season: string; type: '' | 'movie' | 'episode' | 'unknown';
  status: '' | 'eligible' | 'skipped' | 'failed'; targetLanguage: string; missingTarget: boolean;
  sort: 'name' | 'size' | 'date' | 'tracks'; order: 'asc' | 'desc'; page: number; limit: number;
};
export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = { q: '', folder: '', group: '', season: '', type: '', status: '', targetLanguage: 'spa', missingTarget: false, sort: 'name', order: 'asc', page: 1, limit: 50 };
export function parseLibraryFilters(params: URLSearchParams): LibraryFilters {
  const value = { ...DEFAULT_LIBRARY_FILTERS };
  for (const key of ['q', 'folder', 'group', 'targetLanguage'] as const) value[key] = params.get(key) ?? value[key];
  const season = params.get('season') ?? '';
  value.season = /^\d{1,2}$/.test(season) ? season : '';
  const type = params.get('type') ?? '';
  if (type === 'movie' || type === 'episode' || type === 'unknown') value.type = type;
  const status = params.get('status') ?? '';
  if (status === 'eligible' || status === 'skipped' || status === 'failed') value.status = status;
  const sort = params.get('sort');
  if (sort === 'name' || sort === 'size' || sort === 'date' || sort === 'tracks') value.sort = sort;
  value.order = params.get('order') === 'desc' ? 'desc' : 'asc';
  const page = Number(params.get('page'));
  value.page = Number.isSafeInteger(Math.floor(page)) && page <= Math.floor(Number.MAX_SAFE_INTEGER / 200) ? Math.max(1, Math.floor(page)) : 1;
  const limit = Number(params.get('limit'));
  value.limit = [20, 50, 100, 200].includes(limit) ? limit : 50;
  value.missingTarget = params.get('missingTarget') === 'true';
  value.targetLanguage ||= 'spa';
  return value;
}
export function libraryQuery(filters: LibraryFilters, paginated = true): URLSearchParams {
  const params = new URLSearchParams({ includeRules: 'true', sort: filters.sort, order: filters.order, targetLanguage: filters.targetLanguage });
  for (const key of ['q', 'folder', 'type', 'status', 'group', 'season'] as const) if (filters[key]) params.set(key, filters[key]);
  if (filters.missingTarget) params.set('missingTarget', 'true');
  if (paginated) { params.set('offset', String((filters.page - 1) * filters.limit)); params.set('limit', String(filters.limit)); }
  return params;
}
export function transitionLibraryFilters(current: LibraryFilters, patch: Partial<LibraryFilters>): LibraryFilters {
  if (!Object.entries(patch).some(([key, value]) => current[key as keyof LibraryFilters] !== value)) return current;
  return { ...current, ...patch, page: patch.page ?? 1 };
}

export interface LibraryHistoryChange {
  method: 'pushState' | 'replaceState' | null;
  search: string;
}
export function libraryHistoryChange(currentSearch: string, filters: LibraryFilters, replace = false): LibraryHistoryChange {
  const params = libraryQuery(filters);
  params.delete('includeRules'); params.delete('offset'); params.set('page', String(filters.page));
  const search = `?${params}`;
  return { method: currentSearch === search ? null : replace ? 'replaceState' : 'pushState', search };
}
export function readLibraryFiltersCache(): LibraryFilters | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') params.set(key, String(value));
    return parseLibraryFilters(params);
  } catch { return null; }
}
export function writeLibraryFiltersCache(snapshot: LibraryFilters): void {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* Private browsing/storage quota must not block navigation. */ }
}
