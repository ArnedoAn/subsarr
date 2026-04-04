'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { readLibraryFiltersCache, writeLibraryFiltersCache } from '@/lib/library-filters-cache';
import { type MediaItemWithRuleStatus, type SettingsPayload } from '@/lib/types';
import { COMMON_LANGUAGES } from '@/lib/languages';
import { BatchQueueModal } from '@/components/batch-queue-modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

export default function LibraryPage() {
  const { success, error: toastError } = useToast();
  const [items, setItems]         = useState<MediaItemWithRuleStatus[]>([]);
  const [query, setQuery]         = useState('');
  const [targetLangFilter, setTargetLangFilter] = useState('spa');
  const [statusFilter, setStatusFilter]         = useState<'all' | 'ready' | 'skipped' | 'no-source'>('all');
  const [missingTargetOnly, setMissingTargetOnly] = useState(false);
  const [selected, setSelected]   = useState<Record<string, boolean>>({});
  const [loading, setLoading]     = useState(true);
  const [rescanning, setRescanning] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchModalItems, setBatchModalItems] = useState<MediaItemWithRuleStatus[]>([]);

  const [batchSource, setBatchSource]     = useState('eng');
  const [batchTarget, setBatchTarget]     = useState('spa');
  const [batchProvider, setBatchProvider] = useState<'openrouter' | 'deepseek'>('openrouter');

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [folderFilter, setFolderFilter] = useState('all');

  const restoredFromCacheRef = useRef(false);
  const skipFirstPersistRef    = useRef(true);

  useLayoutEffect(() => {
    const cached = readLibraryFiltersCache();
    if (!cached) return;
    restoredFromCacheRef.current = true;
    setQuery(cached.query);
    setFolderFilter(cached.folderFilter);
    setStatusFilter(cached.statusFilter);
    setMissingTargetOnly(cached.missingTargetOnly);
    setTargetLangFilter(cached.targetLangFilter);
    setFiltersOpen(cached.filtersOpen);
    setCurrentPage(Math.max(1, cached.currentPage));
    const ipp = cached.itemsPerPage;
    setItemsPerPage([10, 20, 50, 100].includes(ipp) ? ipp : 20);
    setBatchSource(cached.batchSource);
    setBatchTarget(cached.batchTarget);
    setBatchProvider(cached.batchProvider);
  }, []);

  useEffect(() => {
    if (skipFirstPersistRef.current) {
      skipFirstPersistRef.current = false;
      return;
    }
    writeLibraryFiltersCache({
      query,
      folderFilter,
      statusFilter,
      missingTargetOnly,
      targetLangFilter,
      filtersOpen,
      currentPage,
      itemsPerPage,
      batchSource,
      batchTarget,
      batchProvider,
    });
  }, [
    query,
    folderFilter,
    statusFilter,
    missingTargetOnly,
    targetLangFilter,
    filtersOpen,
    currentPage,
    itemsPerPage,
    batchSource,
    batchTarget,
    batchProvider,
  ]);

  const folders = useMemo(() => {
    const dirs = new Set<string>();
    items.forEach(item => {
      const parts = item.path.split('/');
      if (parts.length >= 2) {
        parts.pop();
        const dir = parts.join('/');
        if (dir) dirs.add(dir);
      }
    });
    return Array.from(dirs).sort();
  }, [items]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [itemsRes, settingsRes] = await Promise.all([
        apiGet<MediaItemWithRuleStatus[]>('/library?includeRules=true'),
        apiGet<SettingsPayload>('/settings').catch(() => null),
      ]);
      setItems(itemsRes);
      if (settingsRes && !restoredFromCacheRef.current) {
        setBatchSource(settingsRes.sourceLanguage);
        setBatchTarget(settingsRes.targetLanguage);
        setTargetLangFilter(settingsRes.targetLanguage);
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to load library');
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  const rescan = useCallback(async () => {
    setRescanning(true);
    try {
      const res = await apiPost<MediaItemWithRuleStatus[]>('/library/rescan');
      setItems(res);
      success('Library rescanned successfully');
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Rescan failed');
    } finally {
      setRescanning(false);
    }
  }, [success, toastError]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    return items
      .filter(item => {
        const q = query.toLowerCase();
        return item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q);
      })
      .filter(item => {
        if (folderFilter !== 'all') {
          const dir = item.path.substring(0, item.path.lastIndexOf('/'));
          return dir === folderFilter || dir.startsWith(folderFilter + '/');
        }
        return true;
      })
      .filter(item => {
        const hasSource = item.subtitleTracks.length > 0;
        const status = item.ruleStatus?.skip ? 'skipped' : hasSource ? 'ready' : 'no-source';
        return statusFilter === 'all' ? true : status === statusFilter;
      })
      .filter(item => {
        if (!missingTargetOnly) return true;
        const target = targetLangFilter.toLowerCase();
        const embedded = item.subtitleTracks.some(t => t.language === target);
        const external = item.externalSubtitles.some(s => s.language === target);
        return !embedded && !external;
      });
  }, [items, query, folderFilter, statusFilter, missingTargetOnly, targetLangFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [filtered.length, itemsPerPage, totalPages, currentPage]);

  const paginated     = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const selectedItemsAll = useMemo(
    () => items.filter(item => selected[item.id]),
    [items, selected],
  );

  const openBatchModal = () => {
    if (selectedItemsAll.length > 0) {
      setBatchModalItems(selectedItemsAll);
      setBatchModalOpen(true);
      return;
    }
    if (folderFilter !== 'all') {
      const scope = items.filter(item => {
        const dir = item.path.substring(0, item.path.lastIndexOf('/'));
        return dir === folderFilter || dir.startsWith(`${folderFilter}/`);
      });
      if (scope.length > 0) {
        setBatchModalItems(scope);
        setBatchModalOpen(true);
        return;
      }
    }
    toastError('Selecciona archivos en la tabla o elige una carpeta en los filtros.');
  };

  const toggleSelection = (id: string) => setSelected(prev => ({ ...prev, [id]: !prev[id] }));

  const toggleAll = () => {
    const allSel = filtered.every(item => selected[item.id]);
    setSelected(prev => {
      const next = { ...prev };
      for (const item of filtered) {
        if (allSel) delete next[item.id];
        else next[item.id] = true;
      }
      return next;
    });
  };

  const allSelected  = filtered.length > 0 && filtered.every(item => selected[item.id]);
  const someSelected = filtered.some(item => selected[item.id]) && !allSelected;

  const activeFiltersCount = [
    folderFilter !== 'all',
    statusFilter !== 'all',
    missingTargetOnly,
    query.length > 0,
  ].filter(Boolean).length;

  return (
    <section className="space-y-6">
      {/* Page Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-on-surface tracking-tight">Library</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">Media files and subtitle status</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="secondary"
            size="sm"
            iconLeft="playlist_add"
            onClick={() => openBatchModal()}
          >
            Encolar lote…
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={rescanning}
            iconLeft={rescanning ? undefined : 'refresh'}
            onClick={() => void rescan()}
          >
            {rescanning ? 'Scanning…' : 'Rescan'}
          </Button>
        </div>
      </div>

      {/* Filters Panel */}
      <div className="bg-surface-container rounded-lg overflow-hidden">
        <button
          onClick={() => setFiltersOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
        >
          <span className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">filter_list</span>
            Filters
            {activeFiltersCount > 0 && (
              <span className="bg-primary-container text-on-primary-container text-xs font-bold px-1.5 py-0.5 rounded">
                {activeFiltersCount}
              </span>
            )}
          </span>
          <span className="material-symbols-outlined text-[18px] transition-transform" style={{ transform: filtersOpen ? 'rotate(180deg)' : undefined }}>
            expand_more
          </span>
        </button>

        {filtersOpen && (
          <div className="px-4 pb-4 space-y-3 border-t border-outline-variant/15">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-2 pt-3">
              {/* Search */}
              <div className="relative sm:col-span-2 lg:col-span-1">
                <input
                  value={query}
                  onChange={e => { setQuery(e.target.value); setCurrentPage(1); }}
                  placeholder="Search files…"
                  className="w-full engraved-input text-sm px-3 py-2 pl-9"
                />
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[16px] pointer-events-none">search</span>
              </div>

              {/* Folder */}
              <div className="relative sm:col-span-2 lg:col-span-1">
                <select
                  value={folderFilter}
                  onChange={e => { setFolderFilter(e.target.value); setCurrentPage(1); }}
                  className="w-full engraved-input text-sm px-3 py-2 pr-8 appearance-none cursor-pointer"
                >
                  <option value="all">All Folders</option>
                  {folders.map(f => (
                    <option key={f} value={f} title={f}>{f.split('/').slice(-2).join('/')}</option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant text-[16px] pointer-events-none">folder</span>
              </div>

              {/* Status */}
              <div className="relative">
                <select
                  value={statusFilter}
                  onChange={e => { setStatusFilter(e.target.value as typeof statusFilter); setCurrentPage(1); }}
                  className="w-full engraved-input text-sm px-3 py-2 pr-8 appearance-none cursor-pointer"
                >
                  <option value="all">All statuses</option>
                  <option value="ready">Ready</option>
                  <option value="skipped">Skipped</option>
                  <option value="no-source">No source</option>
                </select>
                <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant text-[16px] pointer-events-none">expand_more</span>
              </div>

              {/* Target lang */}
              <input
                value={targetLangFilter}
                onChange={e => setTargetLangFilter(e.target.value)}
                placeholder="Target lang (e.g. spa)"
                className="engraved-input text-sm px-3 py-2"
              />

              {/* Missing target chip */}
              <label className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer border transition-colors ${
                missingTargetOnly
                  ? 'border-primary/40 bg-primary/8 text-primary'
                  : 'border-outline-variant engraved-input text-on-surface-variant hover:text-on-surface'
              }`}>
                <input
                  type="checkbox"
                  checked={missingTargetOnly}
                  onChange={e => { setMissingTargetOnly(e.target.checked); setCurrentPage(1); }}
                  className="h-3.5 w-3.5 accent-primary"
                />
                <span className="truncate font-medium">Missing target</span>
              </label>
            </div>

            {activeFiltersCount > 0 && (
              <button
                onClick={() => { setQuery(''); setFolderFilter('all'); setStatusFilter('all'); setMissingTargetOnly(false); setCurrentPage(1); }}
                className="text-xs text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-surface-container rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm data-table min-w-[640px]">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant/15">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleAll}
                    className="h-4 w-4 accent-primary cursor-pointer rounded"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant">File</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Tracks</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant w-12"></th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} columns={5} />)}

              {!loading && !paginated.length && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      icon="video_library"
                      title={query || activeFiltersCount > 0 ? 'No matching files' : 'No media files found'}
                      description={
                        query || activeFiltersCount > 0
                          ? 'Try adjusting your filters'
                          : 'Configure your media directories in Settings to get started'
                      }
                      action={
                        !query && activeFiltersCount === 0 ? (
                          <Link href="/settings" className="btn btn-primary btn-sm">
                            <span className="material-symbols-outlined text-[16px]">settings</span>
                            Open Settings
                          </Link>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              )}

              {paginated.map((item, idx) => {
                const hasSource    = item.subtitleTracks.length > 0;
                const statusLabel  = item.ruleStatus?.skip ? 'skipped' : hasSource ? 'ready' : 'no-source';
                const isSelected   = Boolean(selected[item.id]);
                const target       = targetLangFilter.toLowerCase();
                const hasTarget    = item.subtitleTracks.some(t => t.language === target) ||
                                     item.externalSubtitles.some(s => s.language === target);

                return (
                  <tr
                    key={item.id}
                    className={`border-b border-outline-variant/10 transition-colors ${
                      idx % 2 === 0 ? 'bg-surface-container' : 'bg-surface-container-low'
                    } ${isSelected ? 'bg-primary/5' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelection(item.id)}
                        className="h-4 w-4 accent-primary cursor-pointer rounded"
                      />
                    </td>
                    <td className="px-4 py-3 max-w-[300px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-on-surface truncate">{item.name}</span>
                        {hasTarget && (
                          <Badge variant="success" icon="done_all">{target.toUpperCase()}</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs font-mono text-on-surface-variant truncate" title={item.path}>
                        {item.path}
                      </p>
                      {item.externalSubtitles.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {item.externalSubtitles.slice(0, 3).map((sub, i) => (
                            <span
                              key={i}
                              className="bg-surface-container-high text-on-surface-variant border border-outline-variant/30 px-1.5 py-0.5 rounded text-[10px] font-mono"
                            >
                              {sub.language.toUpperCase()}{sub.forced ? ' F' : ''}
                            </span>
                          ))}
                          {item.externalSubtitles.length > 3 && (
                            <span className="text-[10px] text-on-surface-variant">+{item.externalSubtitles.length - 3}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {item.subtitleTracks.slice(0, 3).map(track => (
                          <span
                            key={track.index}
                            className="bg-surface-container-high border border-outline-variant/30 px-1.5 py-0.5 rounded text-[10px] font-mono text-on-surface-variant"
                          >
                            {track.language}
                          </span>
                        ))}
                        {item.subtitleTracks.length > 3 && (
                          <span className="text-[10px] text-primary font-semibold">
                            +{item.subtitleTracks.length - 3}
                          </span>
                        )}
                        {item.subtitleTracks.length === 0 && (
                          <span className="text-[10px] text-on-surface-variant/50">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={statusLabel === 'ready' ? 'success' : statusLabel === 'skipped' ? 'warning' : 'error'}
                      >
                        {statusLabel === 'no-source' ? 'No source' : statusLabel}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/library/${item.id}`}
                        className="btn btn-ghost btn-icon btn-sm"
                        title="View details"
                      >
                        <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && filtered.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-3 border-t border-outline-variant/15 bg-surface-container-low gap-3">
            <div className="flex items-center gap-3 text-xs text-on-surface-variant">
              <span>
                {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, filtered.length)} of {filtered.length}
              </span>
              <div className="relative">
                <select
                  value={itemsPerPage}
                  onChange={e => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                  className="engraved-input text-xs px-2 py-1 pr-7 appearance-none cursor-pointer"
                >
                  {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
                </select>
                <span className="material-symbols-outlined absolute right-1.5 top-1/2 -translate-y-1/2 text-[14px] text-on-surface-variant pointer-events-none">expand_more</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="btn btn-ghost btn-icon btn-xs"
              >
                <span className="material-symbols-outlined text-[16px]">first_page</span>
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="btn btn-ghost btn-icon btn-xs"
              >
                <span className="material-symbols-outlined text-[16px]">chevron_left</span>
              </button>
              <span className="text-xs text-on-surface-variant px-2 font-mono">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="btn btn-ghost btn-icon btn-xs"
              >
                <span className="material-symbols-outlined text-[16px]">chevron_right</span>
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="btn btn-ghost btn-icon btn-xs"
              >
                <span className="material-symbols-outlined text-[16px]">last_page</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Floating Batch Action Bar */}
      {selectedItemsAll.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 w-full max-w-2xl px-4">
          <div className="bg-surface-container-highest border border-outline-variant/30 rounded-xl shadow-2xl px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center gap-3 fade-in">
            {/* Selection info */}
            <div className="flex items-center gap-2 text-sm font-medium text-on-surface flex-shrink-0">
              <span className="bg-primary-container text-on-primary-container text-xs font-bold px-2 py-0.5 rounded">
                {selectedItemsAll.length}
              </span>
              item{selectedItemsAll.length !== 1 ? 's' : ''} selected
            </div>

            {/* Language + Provider selectors */}
            <div className="flex items-center gap-2 flex-wrap flex-1">
              <div className="flex items-center gap-1.5 bg-surface-container rounded-md px-2 py-1.5 border border-outline-variant/30">
                <select
                  value={batchSource}
                  onChange={e => setBatchSource(e.target.value)}
                  className="bg-transparent text-xs text-on-surface cursor-pointer focus:outline-none"
                  title="Source Language"
                >
                  {COMMON_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.code.toUpperCase()}</option>)}
                </select>
                <span className="material-symbols-outlined text-on-surface-variant text-[14px]">arrow_forward</span>
                <select
                  value={batchTarget}
                  onChange={e => setBatchTarget(e.target.value)}
                  className="bg-transparent text-xs text-on-surface cursor-pointer focus:outline-none"
                  title="Target Language"
                >
                  {COMMON_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.code.toUpperCase()}</option>)}
                </select>
              </div>
              <div className="relative">
                <select
                  value={batchProvider}
                  onChange={e => setBatchProvider(e.target.value as typeof batchProvider)}
                  className="engraved-input text-xs px-2 py-1.5 pr-7 appearance-none cursor-pointer"
                >
                  <option value="openrouter">OpenRouter</option>
                  <option value="deepseek">DeepSeek</option>
                </select>
                <span className="material-symbols-outlined absolute right-1.5 top-1/2 -translate-y-1/2 text-[14px] text-on-surface-variant pointer-events-none">expand_more</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setSelected({})}
                className="text-xs text-on-surface-variant hover:text-on-surface transition-colors"
              >
                Clear
              </button>
              <Button
                variant="primary"
                size="sm"
                iconLeft="fact_check"
                onClick={() => openBatchModal()}
              >
                Revisar y encolar
                {selectedItemsAll.length > 0 ? ` (${selectedItemsAll.length})` : ''}
              </Button>
            </div>
          </div>
        </div>
      )}

      <BatchQueueModal
        open={batchModalOpen}
        onClose={() => setBatchModalOpen(false)}
        items={batchModalItems}
        initialSource={batchSource}
        initialTarget={batchTarget}
        initialProvider={batchProvider}
        onEnqueued={({ queued, failed, errors }) => {
          if (failed === 0) {
            success(
              `Encolados: ${queued} trabajo${queued !== 1 ? 's' : ''}`,
            );
            setSelected({});
          } else if (queued > 0) {
            success(
              `Encolados: ${queued}, fallidos: ${failed}`,
            );
            toastError(
              errors.slice(0, 4).join(' · ') +
                (errors.length > 4 ? ` … (+${errors.length - 4})` : ''),
            );
          } else {
            toastError(
              errors[0] ?? 'No se pudo encolar ningún trabajo',
            );
          }
        }}
      />
    </section>
  );
}
