'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet } from '@/lib/api';
import type { LibraryGroup, LibraryGroupsResult, LibraryPageResult } from '@/lib/types';
import { DEFAULT_LIBRARY_FILTERS, libraryHistoryChange, libraryQuery, parseLibraryFilters, readLibraryFiltersCache, transitionLibraryFilters, writeLibraryFiltersCache, type LibraryFilters } from '@/lib/library-filters-cache';
export interface LibraryController {
  filters: LibraryFilters;
  update: (patch: Partial<LibraryFilters>) => void;
  search: string;
  setSearch: (value: string) => void;
  page: LibraryPageResult | null;
  groups: LibraryGroup[];
  folders: string[];
  error: string | null;
  groupsError: string | null;
  loading: boolean;
  refresh: () => void;
}

export function useLibrary(): LibraryController {
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_LIBRARY_FILTERS);
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<LibraryPageResult | null>(null);
  const [groups, setGroups] = useState<LibraryGroup[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const request = useRef(0);
  const currentFilters = useRef<LibraryFilters>(DEFAULT_LIBRARY_FILTERS);
  const searchTimer = useRef<number | undefined>(undefined);
  const searchEpoch = useRef(0);
  const commitFilters = useCallback((next: LibraryFilters, replace = false) => {
    const navigation = libraryHistoryChange(window.location.search, next, replace);
    if (navigation.method) window.history[navigation.method](window.history.state, '', `${window.location.pathname}${navigation.search}${window.location.hash}`);
    currentFilters.current = next;
    setFilters(next);
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const restored = params.size ? parseLibraryFilters(params) : readLibraryFiltersCache() ?? DEFAULT_LIBRARY_FILTERS;
    commitFilters(restored, true); setSearch(restored.q); setReady(true);
    const onPopState = () => {
      clearTimeout(searchTimer.current);
      searchEpoch.current += 1;
      request.current += 1;
      const value = parseLibraryFilters(new URLSearchParams(window.location.search));
      currentFilters.current = value;
      setFilters(value); setSearch(value.q);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [commitFilters]);
  const update = useCallback((patch: Partial<LibraryFilters>) => {
    const next = transitionLibraryFilters(currentFilters.current, patch);
    if (next === currentFilters.current) return;
    commitFilters(next);
    if (patch.q !== undefined) setSearch(next.q);
  }, [commitFilters]);
  useEffect(() => {
    if (!ready || search === filters.q) return;
    const epoch = searchEpoch.current;
    searchTimer.current = window.setTimeout(() => {
      if (epoch === searchEpoch.current && search !== currentFilters.current.q) update({ q: search });
    }, 250);
    return () => clearTimeout(searchTimer.current);
  }, [search, ready, filters.q, update]);
  useEffect(() => {
    if (ready) writeLibraryFiltersCache(filters);
  }, [filters, ready]);
  useEffect(() => {
    if (!ready) return;
    const abort = new AbortController(); const id = ++request.current;
    setLoading(true); setError(null);
    void apiGet<LibraryPageResult>(`/library?${libraryQuery(filters)}`, { signal: abort.signal }).then(result => {
      if (id !== request.current || abort.signal.aborted) return;
      const lastPage = Math.max(1, Math.ceil(result.total / filters.limit));
      if (filters.page > lastPage) { commitFilters({ ...filters, page: lastPage }, true); return; }
      setPage(result);
    }).catch(reason => { if (id === request.current && !abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Library unavailable'); }).finally(() => { if (id === request.current && !abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [filters, ready, revision, commitFilters]);
  // Groups and folders summarize the same server-side match set, independent of the current page/group/season.
  const groupParams = libraryQuery(filters, false); groupParams.delete('group'); groupParams.delete('season');
  const groupQuery = groupParams.toString();
  useEffect(() => {
    if (!ready) return;
    const abort = new AbortController(); setGroupsError(null);
    void apiGet<LibraryGroupsResult>(`/library/groups?${groupQuery}`, { signal: abort.signal }).then(result => { if (!abort.signal.aborted) { setGroups(result.groups); setFolders(result.folders); } }).catch(reason => { if (!abort.signal.aborted) setGroupsError(reason instanceof Error ? reason.message : 'Groups unavailable'); });
    return () => abort.abort();
  }, [groupQuery, ready, revision]);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  return { filters, update, search, setSearch, page, groups, folders, error, groupsError, loading: loading || search !== filters.q, refresh };
}
