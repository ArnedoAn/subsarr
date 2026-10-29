'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import type { MediaItemWithRuleStatus, SettingsPayload } from '@/lib/types';
import { useLibrary } from '@/components/library/use-library';
import { libraryQuery } from '@/lib/library-filters-cache';
import { LibraryResults } from '@/components/library/library-results';
import { ScanPanel } from '@/components/library/scan-panel';
import { ItemDetail } from '@/components/library/item-detail';
import { BatchQueueModal } from '@/components/batch-queue-modal';
import { Dialog } from '@/components/ui/dialog';
import { LibraryFilters } from '@/components/library/library-filters';
import { ScanHistoryPanel } from '@/components/library/scan-history-panel';

export default function LibraryPage() {
  const library = useLibrary();
  const { filters, update, page } = library;
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [scope, setScope] = useState<'selected' | 'matches' | 'group'>('matches');
  const [batch, setBatch] = useState<{ ids: string[]; label: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [budgetItem, setBudgetItem] = useState<MediaItemWithRuleStatus | null>(null);
  const selectionAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void apiGet<SettingsPayload>('/settings', { signal: abort.signal }).then(setSettings).catch(reason => { if (!abort.signal.aborted) setSettingsError(reason instanceof Error ? reason.message : 'Defaults unavailable'); });
    return () => { abort.abort(); selectionAbort.current?.abort(); };
  }, []);
  const filterIdentity = libraryQuery(filters, false).toString();
  useEffect(() => { selectionAbort.current?.abort(); setSelected({}); }, [filterIdentity]);
  const selectedIds = Object.keys(selected).filter(id => selected[id]);
  const toggle = useCallback((id: string) => setSelected(previous => ({ ...previous, [id]: !previous[id] })), []);
  async function resolveIds(allGroup = false) {
    selectionAbort.current?.abort();
    const abort = new AbortController(); selectionAbort.current = abort;
    const query = allGroup ? new URLSearchParams({ group: filters.group }) : libraryQuery(filters, false);
    const result = await apiGet<{ ids: string[] }>(`/library/ids?${query}`, { signal: abort.signal });
    if (abort.signal.aborted) throw new DOMException('Selection changed', 'AbortError');
    return result.ids;
  }
  async function openBatch() {
    setBusy(true); setActionError(null);
    try {
      const ids = scope === 'selected' ? selectedIds : await resolveIds(scope === 'group');
      if (!ids.length) { setActionError('No files in this scope. Select files or change the filters.'); return; }
      setBatch({ ids, label: scope === 'selected' ? 'Explicit selection' : scope === 'group' ? `All files in ${library.groups.find(group => group.key === filters.group)?.label ?? 'group'} (ignores current match filters and season)` : 'Current search and filters, all pages' });
    } catch (reason) { if (!(reason instanceof DOMException && reason.name === 'AbortError')) setActionError(reason instanceof Error ? reason.message : 'Unable to resolve selection'); }
    finally { setBusy(false); }
  }
  async function quickTranslate(item: MediaItemWithRuleStatus, allowBudgetOverride = false) {
    if (!settings) { setActionError('Saved translation defaults are unavailable. Open details to choose options.'); return; }
    const track = item.subtitleTracks.find(track => track.language === settings.sourceLanguage);
    if (!track) { setDetailId(item.id); setNotice('No source track matches saved defaults. Choose a source in details.'); return; }
    setBusy(true); setActionError(null);
    try {
      await apiPost('/jobs', { mediaItemId: item.id, mediaItemPath: item.path, sourceTrackIndex: track.index, sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage, provider: settings.defaultProvider, triggeredBy: 'manual', allowBudgetOverride });
      setBudgetItem(null); setNotice(`Queued ${item.name}`);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && reason.code === 'TRANSLATION_BUDGET_EXCEEDED') setBudgetItem(item);
      else setActionError(reason instanceof Error ? reason.message : 'Translation could not be queued');
    } finally { setBusy(false); }
  }
  return <section className="min-w-0 w-full max-w-full space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Library</h1><p className="text-sm text-on-surface-variant">Search the complete inventory, then translate a file, season, show or explicit selection.</p></div><button className="btn btn-secondary" onClick={library.refresh}>Refresh</button></header>
    <ScanPanel onCompleted={library.refresh} />
    <ScanHistoryPanel />
    {settingsError && <p role="alert" className="text-warning">Saved defaults unavailable: {settingsError}. Individual detail options remain available.</p>}
    {(actionError || notice) && <div role={actionError ? 'alert' : 'status'} className={actionError ? 'text-error' : 'text-primary'}>{actionError ?? notice}</div>}
    <LibraryFilters library={library} />
    <section className="flex flex-wrap gap-3 items-center" aria-label="Batch selection">
      <button className="btn btn-secondary btn-sm" disabled={busy || library.loading || !!library.error} onClick={async () => { setBusy(true); setActionError(null); try { const ids = await resolveIds(); setSelected(Object.fromEntries(ids.map(id => [id, true]))); setScope('selected'); } catch (reason) { if (!(reason instanceof DOMException && reason.name === 'AbortError')) setActionError(reason instanceof Error ? reason.message : 'Selection failed'); } finally { setBusy(false); } }}>Select all {page?.total ?? ''} matches (all pages)</button><button className="btn btn-ghost btn-sm" onClick={() => setSelected({})}>Clear {selectedIds.length} selected</button>
      <label>Batch scope <select className="engraved-input p-2" value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="matches">Current matches, all pages</option><option value="selected">Explicit selection ({selectedIds.length})</option><option value="group" disabled={!filters.group}>All files in group (ignore filters)</option></select></label><button className="btn btn-primary" disabled={busy || !settings || library.loading || !!library.error || (scope === 'selected' && !selectedIds.length) || (scope === 'group' && !filters.group)} onClick={() => void openBatch()}>Review batch</button>
    </section>
    {library.error ? <div role="alert" className="p-5 rounded border border-error text-error"><h2>Library unavailable / offline</h2><p>{library.error}</p>{page && <p>Previously loaded inventory is retained; it is not an empty inventory.</p>}<button className="btn btn-secondary" onClick={library.refresh}>Retry</button></div> : null}
    {library.loading ? <p role="status" className="p-6">Loading matching inventory…</p> : !library.error && page?.total === 0 ? <section className="p-8 text-center"><h2>No matching inventory records</h2><p>Change your search or filters. A running or failed scan can mean discovery is incomplete; this does not prove your media folders are empty. See scan status above.</p></section> : null}
    {page && !library.loading && !library.error && <><LibraryResults items={page.items} selected={selected} onToggle={toggle} onDetails={setDetailId} onTranslate={item => void quickTranslate(item)} targetLanguage={filters.targetLanguage} busy={busy} /><div className="flex flex-wrap items-center justify-between gap-3"><p>{page.total ? page.offset + 1 : 0}–{page.offset + page.items.length} of {page.total} matches</p><div className="flex items-center gap-3"><button className="btn btn-secondary" disabled={filters.page === 1} onClick={() => update({ page: filters.page - 1 })}>Previous</button><span>Page {filters.page} of {Math.max(1, Math.ceil(page.total / filters.limit))}</span><button className="btn btn-secondary" disabled={page.offset + page.items.length >= page.total} onClick={() => update({ page: filters.page + 1 })}>Next</button></div></div></>}
    <Dialog open={detailId !== null} onClose={() => setDetailId(null)} title="Media details" className="!fixed !inset-0 !m-0 !h-dvh !max-h-dvh !w-screen !max-w-none !rounded-none md:!inset-y-0 md:!left-auto md:!right-0 md:!w-[min(90vw,64rem)]"><div>{detailId && <ItemDetail key={detailId} id={detailId} />}</div></Dialog>
    {batch && settings && <BatchQueueModal open onClose={() => setBatch(null)} itemIds={batch.ids} items={page?.items} scopeLabel={batch.label} initialSource={settings.sourceLanguage} initialTarget={settings.targetLanguage} initialProvider={settings.defaultProvider} onEnqueued={summary => { setNotice(`${summary.queued} queued; ${summary.failed} not confirmed queued`); }} />}
    <Dialog open={budgetItem !== null} onClose={() => setBudgetItem(null)} title="Monthly budget reached"><p>Approve a manual budget override to translate {budgetItem?.name}?</p><div className="flex gap-3 mt-4"><button className="btn btn-secondary" onClick={() => setBudgetItem(null)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => { if (budgetItem) void quickTranslate(budgetItem, true); }}>Approve override and queue</button></div></Dialog>
  </section>;
}
