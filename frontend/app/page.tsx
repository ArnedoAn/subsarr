'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { type MediaItem, type SettingsPayload } from '@/lib/types';
import { COMMON_LANGUAGES } from '@/lib/languages';

interface RuleStatus {
  skip: boolean;
  reason?: string;
}

interface MediaItemWithRules extends MediaItem {
  ruleStatus: RuleStatus;
}

export default function LibraryPage() {
  const [items, setItems] = useState<MediaItemWithRules[]>([]);
  const [query, setQuery] = useState('');
  const [targetLanguageFilter, setTargetLanguageFilter] = useState('spa');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'skipped' | 'no-source'>('all');
  const [missingTargetOnly, setMissingTargetOnly] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [rescanning, setRescanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [batchSource, setBatchSource] = useState('eng');
  const [batchTarget, setBatchTarget] = useState('spa');
  const [batchProvider, setBatchProvider] = useState<'openrouter' | 'deepseek'>('openrouter');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  // Folder filter state
  const [folderFilter, setFolderFilter] = useState('all');

  // Extract unique parent folders from items
  const folders = useMemo(() => {
    const dirs = new Set<string>();
    items.forEach(item => {
      const parts = item.path.split('/');
      // Get parent directory (remove filename)
      if (parts.length >= 2) {
        parts.pop(); // remove filename
        const dir = parts.join('/');
        if (dir) dirs.add(dir);
      }
    });
    return Array.from(dirs).sort();
  }, [items]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemsResponse, settingsResponse] = await Promise.all([
        apiGet<MediaItemWithRules[]>('/library?includeRules=true'),
        apiGet<SettingsPayload>('/settings').catch(() => null)
      ]);
      setItems(itemsResponse);
      if (settingsResponse) {
        setBatchSource(settingsResponse.sourceLanguage);
        setBatchTarget(settingsResponse.targetLanguage);
        setTargetLanguageFilter(settingsResponse.targetLanguage);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to fetch library');
    } finally {
      setLoading(false);
    }
  }, []);

  const rescan = useCallback(async () => {
    setRescanning(true);
    setError(null);
    try {
      // Use POST to /library/rescan endpoint for a fresh scan
      const itemsResponse = await apiPost<MediaItemWithRules[]>('/library/rescan');
      setItems(itemsResponse);
    } catch (requestError) {
      const errorMessage = requestError instanceof Error ? requestError.message : 'Rescan failed';
      setError(`Rescan failed: ${errorMessage}. Try again.`);
    } finally {
      setRescanning(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return items
      .filter((item) => {
        const searchLower = query.toLowerCase();
        return item.name.toLowerCase().includes(searchLower) || item.path.toLowerCase().includes(searchLower);
      })
      .filter((item) => {
        if (folderFilter !== 'all') {
          const itemDir = item.path.substring(0, item.path.lastIndexOf('/'));
          return itemDir === folderFilter || itemDir.startsWith(folderFilter + '/');
        }
        return true;
      })
      .filter((item) => {
        const hasSource = item.subtitleTracks.length > 0;
        const status = item.ruleStatus?.skip ? 'skipped' : hasSource ? 'ready' : 'no-source';
        return statusFilter === 'all' ? true : status === statusFilter;
      })
      .filter((item) => {
        if (!missingTargetOnly) {
          return true;
        }

        const target = targetLanguageFilter.toLowerCase();
        const embedded = item.subtitleTracks.some((track) => track.language === target);
        const external = item.externalSubtitles.some((subtitle) => subtitle.language === target);
        return !embedded && !external;
      });
  }, [items, missingTargetOnly, query, folderFilter, statusFilter, targetLanguageFilter]);

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [filtered.length, itemsPerPage, totalPages, currentPage]);

  const paginatedItems = filtered.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const selectedItems = filtered.filter((item) => selected[item.id]);

  const toggleSelection = (id: string) => {
    setSelected((previous) => ({
      ...previous,
      [id]: !previous[id],
    }));
  };

  const toggleSelectAll = () => {
    const allFilteredSelected = filtered.every((item) => selected[item.id]);
    
    if (allFilteredSelected) {
      // Deselect all filtered items
      setSelected((previous) => {
        const next = { ...previous };
        for (const item of filtered) {
          delete next[item.id];
        }
        return next;
      });
    } else {
      // Select all filtered items
      setSelected((previous) => {
        const next = { ...previous };
        for (const item of filtered) {
          next[item.id] = true;
        }
        return next;
      });
    }
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((item) => selected[item.id]);
  const someFilteredSelected = filtered.some((item) => selected[item.id]) && !allFilteredSelected;

  const translateSelected = async () => {
    if (selectedItems.length === 0) {
      return;
    }

    const jobs = selectedItems
      .filter((item) => item.subtitleTracks.length > 0)
      .map((item) => {
        // Try to find the selected source language, otherwise fallback to the first track
        const matchedTrack = item.subtitleTracks.find((t) => t.language === batchSource);
        const sourceTrack = matchedTrack || item.subtitleTracks[0];
        
        return {
          mediaItemId: item.id,
          mediaItemPath: item.path,
          sourceTrackIndex: sourceTrack.index,
        };
      });

    await apiPost('/jobs/batch', {
      items: jobs,
      sourceLanguage: batchSource,
      targetLanguage: batchTarget,
      triggeredBy: 'batch',
      forceBypassRules: false,
      provider: batchProvider,
    });
  };

  return (
    <section className="space-y-8">
      {/* Page Header */}
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-headline font-black uppercase tracking-[0.05em] text-on-surface">
            Media Timeline
          </h1>
          <p className="text-on-surface-variant mt-2 font-body text-sm">
            Monitor subtitle synchronization status across all indexed media nodes.
          </p>
        </div>
      </header>

      {/* Filters Toolbar */}
      <div className="bg-surface-container rounded-xl p-4 md:p-6 space-y-4">
        {/* Search and Filters */}
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          {/* Folder Filter */}
          <div className="relative sm:col-span-2 lg:col-span-1">
            <select
              value={folderFilter}
              onChange={(event) => {
                setFolderFilter(event.target.value);
                setCurrentPage(1);
              }}
              className="w-full engraved-input rounded-lg px-4 py-3 pr-10 text-sm text-on-surface appearance-none bg-surface-container-lowest cursor-pointer transition-all duration-200"
            >
              <option value="all">All Folders</option>
              {folders.map(folder => {
                // Show only the last part of the path for readability
                const shortName = folder.split('/').slice(-2).join('/');
                return (
                  <option key={folder} value={folder} title={folder}>{shortName}</option>
                );
              })}
            </select>
            <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">
              folder
            </span>
          </div>
          
          {/* Search Input */}
          <div className="relative sm:col-span-2 lg:col-span-1">
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search media files..."
              className="w-full engraved-input rounded-lg px-4 py-3 pl-10 text-sm text-on-surface"
            />
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none text-[18px]">
              search
            </span>
          </div>
          
          {/* Status Filter */}
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as 'all' | 'ready' | 'skipped' | 'no-source');
                setCurrentPage(1);
              }}
              className="w-full engraved-input rounded-lg px-4 py-3 pr-10 text-sm text-on-surface appearance-none bg-surface-container-lowest cursor-pointer transition-all duration-200"
            >
              <option value="all">All statuses</option>
              <option value="ready">Ready</option>
              <option value="skipped">Skipped</option>
              <option value="no-source">No source track</option>
            </select>
            <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">
              expand_more
            </span>
          </div>
          
          {/* Target Language */}
          <input
            value={targetLanguageFilter}
            onChange={(event) => setTargetLanguageFilter(event.target.value)}
            placeholder="Target language"
            className="w-full engraved-input rounded-lg px-4 py-3 text-sm text-on-surface"
          />
          
          {/* Missing Target Checkbox */}
          <label className="flex items-center gap-3 engraved-input rounded-lg px-4 py-3 text-sm text-on-surface-variant cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={missingTargetOnly}
              onChange={(event) => {
                setMissingTargetOnly(event.target.checked);
                setCurrentPage(1);
              }}
              className="h-4 w-4 accent-primary flex-shrink-0"
            />
            <span className="truncate">Missing target only</span>
          </label>
        </div>

        {/* Actions Row */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between pt-2 border-t border-cyan-400/10">
          {/* Batch Translation Controls */}
          {selectedItems.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-on-surface-variant font-medium">Batch:</span>
              <div className="flex items-center gap-1 bg-surface-container-high rounded-lg p-1">
                <select
                  value={batchSource}
                  onChange={(e) => setBatchSource(e.target.value)}
                  className="bg-transparent px-2 py-1.5 text-xs text-on-surface cursor-pointer focus:outline-none"
                  title="Source Language"
                >
                  {COMMON_LANGUAGES.map((lang) => (
                    <option key={`batch-src-${lang.code}`} value={lang.code}>
                      {lang.code.toUpperCase()}
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined text-on-surface-variant text-[14px]">arrow_forward</span>
                <select
                  value={batchTarget}
                  onChange={(e) => setBatchTarget(e.target.value)}
                  className="bg-transparent px-2 py-1.5 text-xs text-on-surface cursor-pointer focus:outline-none"
                  title="Target Language"
                >
                  {COMMON_LANGUAGES.map((lang) => (
                    <option key={`batch-tgt-${lang.code}`} value={lang.code}>
                      {lang.code.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
              <select
                value={batchProvider}
                onChange={(e) => setBatchProvider(e.target.value as 'openrouter' | 'deepseek')}
                className="engraved-input rounded-lg px-2 py-1.5 text-xs text-on-surface appearance-none bg-surface-container-lowest cursor-pointer"
                title="Provider"
              >
                <option value="openrouter">OpenRouter</option>
                <option value="deepseek">DeepSeek</option>
              </select>
            </div>
          ) : (
            <div className="text-xs text-on-surface-variant">Select items to enable batch translation</div>
          )}
          
          {/* Action Buttons */}
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => void rescan()}
              disabled={rescanning}
              className="bg-surface-container-high px-4 py-2.5 rounded text-xs font-bold tracking-widest text-on-surface hover:bg-surface-variant transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className={`material-symbols-outlined text-[16px] ${rescanning ? 'animate-spin' : ''}`}>
                {rescanning ? 'progress_activity' : 'refresh'}
              </span>
              <span className="hidden sm:inline">{rescanning ? 'SCANNING...' : 'RESCAN'}</span>
            </button>
            <button
              onClick={() => void translateSelected()}
              disabled={selectedItems.length === 0}
              className="bg-gradient-to-br from-primary to-primary-container px-4 sm:px-6 py-2.5 rounded text-xs font-black tracking-widest text-on-primary-container shadow-[0_0_15px_rgba(47,217,244,0.3)] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px]">translate</span>
              <span className="hidden sm:inline">TRANSLATE</span>
              {selectedItems.length > 0 && <span>({selectedItems.length})</span>}
            </button>
          </div>
        </div>
      </div>

      {/* Media Table */}
      <div className="bg-surface-container rounded-xl overflow-hidden">
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[700px]">
            <thead className="bg-surface-container-low border-b border-cyan-400/15">
              <tr>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-on-surface-variant w-12">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someFilteredSelected;
                    }}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 accent-primary cursor-pointer"
                    title={allFilteredSelected ? 'Deselect all filtered items' : 'Select all filtered items'}
                  />
                </th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-on-surface-variant">File</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-on-surface-variant">Tracks</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-on-surface-variant">Status</th>
                <th className="px-4 py-3 text-xs font-bold uppercase tracking-widest text-on-surface-variant w-24">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-on-surface-variant">
                    Loading media library...
                  </td>
                </tr>
              ) : null}
              {error ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-error">
                    {error}
                  </td>
                </tr>
              ) : null}
              {!loading && !error && filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-on-surface-variant">
                    No media items found.
                  </td>
                </tr>
              ) : null}
              {paginatedItems.map((item, index) => {
                const status = item.ruleStatus?.skip ? 'Skipped' : 'Ready';
                const hasSource = item.subtitleTracks.length > 0;
                const statusLabel = hasSource ? status : 'No source track';
                const isSelected = Boolean(selected[item.id]);

                const target = targetLanguageFilter.toLowerCase();
                const hasTargetEmbedded = item.subtitleTracks.some((track) => track.language === target);
                const hasTargetExternal = item.externalSubtitles.some((subtitle) => subtitle.language === target);
                const hasTargetLanguage = hasTargetEmbedded || hasTargetExternal;

                return (
                  <tr
                    key={item.id}
                    className={`border-b border-cyan-400/10 transition-colors ${
                      index % 2 === 0 ? 'bg-surface-container' : 'bg-surface-container-low'
                    } hover:bg-primary/5`}
                  >
                    <td className="px-4 py-3 align-top">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelection(item.id)}
                        className="h-4 w-4 accent-primary"
                      />
                    </td>
                    <td className="px-4 py-3 align-top max-w-[300px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-on-surface truncate">{item.name}</p>
                        {hasTargetLanguage && (
                          <span 
                            className="bg-primary/20 text-primary px-2 py-0.5 rounded text-[10px] font-bold tracking-widest flex items-center gap-1 flex-shrink-0"
                            title={`Already has ${target.toUpperCase()} subtitles`}
                          >
                            <span className="material-symbols-outlined text-[12px]">done_all</span>
                            {target.toUpperCase()}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs font-mono text-on-surface-variant truncate" title={item.path}>{item.path}</p>
                      
                      {item.externalSubtitles.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {item.externalSubtitles.slice(0, 3).map((sub, idx) => (
                            <span
                              key={`ext-${item.id}-${idx}`}
                              className="bg-surface-variant/50 text-on-surface-variant border border-on-surface-variant/20 px-1.5 py-0.5 rounded text-[9px] font-mono"
                            >
                              {sub.language.toUpperCase()}{sub.forced ? ' F' : ''}
                            </span>
                          ))}
                          {item.externalSubtitles.length > 3 && (
                            <span className="text-[9px] text-on-surface-variant">+{item.externalSubtitles.length - 3}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap gap-1">
                        {item.subtitleTracks.slice(0, 2).map((track) => (
                          <span
                            key={`${item.id}-${track.index}`}
                            className="bg-surface-container-high px-2 py-1 rounded text-[9px] font-mono text-on-surface-variant"
                          >
                            {track.language}
                          </span>
                        ))}
                        {item.subtitleTracks.length > 2 && (
                          <span className="bg-primary/10 text-primary px-1.5 py-1 rounded text-[9px] font-bold">
                            +{item.subtitleTracks.length - 2}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span
                        className={`badge text-[10px] ${
                          statusLabel === 'Ready'
                            ? 'badge-success'
                            : statusLabel === 'Skipped'
                              ? 'badge-secondary'
                              : 'badge-error'
                        }`}
                      >
                        {statusLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Link
                        href={`/library/${item.id}`}
                        className="inline-flex items-center gap-1 bg-surface-container-high px-2 py-1 rounded text-[10px] font-bold tracking-widest text-on-surface hover:bg-surface-variant transition-colors"
                      >
                        <span className="material-symbols-outlined text-sm">search</span>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden divide-y divide-cyan-400/10">
          {loading && (
            <div className="px-4 py-12 text-center text-on-surface-variant">
              Loading media library...
            </div>
          )}
          {error && (
            <div className="px-4 py-12 text-center text-error">
              {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="px-4 py-12 text-center text-on-surface-variant">
              No media items found.
            </div>
          )}
          {paginatedItems.map((item) => {
            const status = item.ruleStatus?.skip ? 'Skipped' : 'Ready';
            const hasSource = item.subtitleTracks.length > 0;
            const statusLabel = hasSource ? status : 'No source';
            const isSelected = Boolean(selected[item.id]);

            const target = targetLanguageFilter.toLowerCase();
            const hasTargetEmbedded = item.subtitleTracks.some((track) => track.language === target);
            const hasTargetExternal = item.externalSubtitles.some((subtitle) => subtitle.language === target);
            const hasTargetLanguage = hasTargetEmbedded || hasTargetExternal;

            return (
              <div key={item.id} className="p-4 bg-surface-container hover:bg-primary/5 transition-colors">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelection(item.id)}
                    className="h-4 w-4 accent-primary mt-1 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-on-surface text-sm truncate">{item.name}</p>
                        <p className="text-xs font-mono text-on-surface-variant truncate mt-0.5">{item.path}</p>
                      </div>
                      <Link
                        href={`/library/${item.id}`}
                        className="flex-shrink-0 bg-surface-container-high p-2 rounded hover:bg-surface-variant transition-colors"
                      >
                        <span className="material-symbols-outlined text-[18px] text-on-surface">search</span>
                      </Link>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <span
                        className={`badge text-[10px] ${
                          statusLabel === 'Ready'
                            ? 'badge-success'
                            : statusLabel === 'Skipped'
                              ? 'badge-secondary'
                              : 'badge-error'
                        }`}
                      >
                        {statusLabel}
                      </span>
                      
                      {hasTargetLanguage && (
                        <span className="bg-primary/20 text-primary px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1">
                          <span className="material-symbols-outlined text-[12px]">done_all</span>
                          {target.toUpperCase()}
                        </span>
                      )}
                      
                      {item.subtitleTracks.length > 0 && (
                        <div className="flex items-center gap-1">
                          {item.subtitleTracks.slice(0, 2).map((track) => (
                            <span
                              key={`${item.id}-${track.index}`}
                              className="bg-surface-container-high px-1.5 py-0.5 rounded text-[9px] font-mono text-on-surface-variant"
                            >
                              {track.language}
                            </span>
                          ))}
                          {item.subtitleTracks.length > 2 && (
                            <span className="text-[9px] text-primary font-bold">+{item.subtitleTracks.length - 2}</span>
                          )}
                        </div>
                      )}
                      
                      {item.externalSubtitles.length > 0 && (
                        <span className="text-[9px] text-on-surface-variant">
                          {item.externalSubtitles.length} ext
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 border-t border-cyan-400/15 bg-surface-container-low gap-4">
          <div className="flex items-center gap-4 text-xs text-on-surface-variant">
            <span>
              Showing {filtered.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filtered.length)} of {filtered.length} entries
            </span>
            <div className="relative">
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="engraved-input rounded-lg px-2 py-1.5 pr-8 text-xs text-on-surface appearance-none bg-surface-container-lowest cursor-pointer"
              >
                <option value={10}>10 per page</option>
                <option value={20}>20 per page</option>
                <option value={50}>50 per page</option>
                <option value={100}>100 per page</option>
              </select>
              <span className="material-symbols-outlined absolute right-1.5 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none text-[16px]">
                expand_more
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded text-xs font-bold bg-surface-container-high disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-variant transition-colors text-on-surface"
            >
              PREV
            </button>
            <span className="text-xs font-mono text-on-surface-variant px-2">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded text-xs font-bold bg-surface-container-high disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-variant transition-colors text-on-surface"
            >
              NEXT
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
