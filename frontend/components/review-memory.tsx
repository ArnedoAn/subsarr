'use client';

import { useEffect, useState } from 'react';
import { apiDelete, apiGet } from '@/lib/api';
import type { WorkspaceMemoryPage } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

const PAGE_SIZE = 20;

export function ReviewMemory() {
  const { error: showError, success } = useToast();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<WorkspaceMemoryPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [failure, setFailure] = useState('');

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setFailure('');
    void apiGet<WorkspaceMemoryPage>(`/translation-memory?offset=${offset}&limit=${PAGE_SIZE}`, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setPage(result);
    }).catch(error => {
      if (controller.signal.aborted) return;
      const detail = error instanceof Error ? error.message : 'Unable to load approved translation memory';
      setFailure(detail); showError(detail);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, offset, refresh, showError]);

  const remove = async (id: string) => {
    if (removing || !window.confirm('Delete this approved translation-memory entry? Future translations will no longer reuse it.')) return;
    setRemoving(id);
    try {
      await apiDelete(`/translation-memory/${encodeURIComponent(id)}`);
      success('Approved memory entry deleted.');
      if (page?.entries.length === 1 && offset > 0) setOffset(Math.max(0, offset - PAGE_SIZE));
      else setRefresh(value => value + 1);
    } catch (error) { showError(error instanceof Error ? error.message : 'Unable to delete memory entry'); }
    finally { setRemoving(null); }
  };

  return <details className="rounded-xl border border-outline-variant/30 bg-surface-container p-4" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold">Approved translation memory</summary>
    <div className="mt-4 space-y-3">
      <p className="text-sm text-on-surface-variant">Only manually approved cues are stored. Exact source, neighboring context, language pair and style must match for automatic reuse. Deletion does not change existing subtitle files.</p>
      <Button disabled={loading || removing !== null} onClick={() => setRefresh(value => value + 1)}>Refresh memory</Button>
      {loading && <p role="status">Loading approved entries…</p>}
      {failure && <p role="alert" className="text-error">{failure}</p>}
      {page && !loading && <>
        <p className="text-sm">{page.total} approved entries</p>
        {page.entries.length === 0 && <p className="text-sm">No approved translations on this page.</p>}
        {page.entries.map(entry => <article key={entry.id} className="rounded-lg border border-outline-variant/30 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-on-surface-variant">{entry.sourceLanguage} → {entry.targetLanguage} · {entry.model || 'Manual/unknown model'} · {new Date(entry.updatedAt).toLocaleString()}</p><Button size="sm" variant="danger" disabled={removing !== null} loading={removing === entry.id} onClick={() => void remove(entry.id)}>Delete entry</Button></div>
          <div className="grid gap-3 md:grid-cols-2"><div><p className="text-xs text-on-surface-variant">Source</p><pre className="whitespace-pre-wrap break-words font-sans text-sm">{entry.source}</pre></div><div><p className="text-xs text-on-surface-variant">Approved translation</p><pre className="whitespace-pre-wrap break-words font-sans text-sm">{entry.target}</pre></div></div>
          <details className="text-xs text-on-surface-variant"><summary className="cursor-pointer">Context and provenance</summary><p className="break-all">Context fingerprint: {entry.contextHash}</p><p className="break-all">Style signature: {entry.signature}</p><p>{entry.provenance || 'No additional provenance recorded'}</p></details>
        </article>)}
        <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Translation memory pages"><Button disabled={loading || removing !== null || offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous entries</Button><span className="text-sm">{page.total ? offset + 1 : 0}–{Math.min(offset + page.entries.length, page.total)} of {page.total}</span><Button disabled={loading || removing !== null || offset + page.entries.length >= page.total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next entries</Button></nav>
      </>}
    </div>
  </details>;
}
