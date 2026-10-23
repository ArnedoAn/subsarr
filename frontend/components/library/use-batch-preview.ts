'use client';
import { useEffect, useRef, useState } from 'react';
import { apiPost } from '@/lib/api';
import type { BatchPreviewRow } from '@/lib/types';
export type BatchOptions = { sourceLanguage: string; targetLanguage: string; provider: 'openrouter' | 'deepseek'; forceBypassRules: boolean; targetConflictResolution?: 'replace' | 'alternate' };
export function useBatchPreview(open: boolean, ids: string[], options: BatchOptions) {
  const [rows, setRows] = useState<BatchPreviewRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [snapshot, setSnapshot] = useState<{ ids: string[]; options: BatchOptions } | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController(); const version = ++generation.current;
    setLoading(true); setError(null); setRows([]); setProcessed(0);
    void (async () => {
      const result: BatchPreviewRow[] = [];
      try {
        for (let offset = 0; offset < ids.length; offset += 500) {
          const chunk = ids.slice(offset, offset + 500);
          const response = await apiPost<BatchPreviewRow[]>('/jobs/batch/preview', { ...options, items: chunk.map(mediaItemId => ({ mediaItemId })) }, { signal: abort.signal });
          if (abort.signal.aborted || generation.current !== version) return;
          const returned = new Set(response.map(row => row.mediaItemId));
          result.push(...response, ...chunk.filter(id => !returned.has(id)).map(mediaItemId => ({ mediaItemId, status: 'error' as const, reason: 'Server did not return a preview for this item' })));
          setProcessed(Math.min(offset + chunk.length, ids.length));
        }
        if (!abort.signal.aborted) setRows(result);
      } catch (reason) { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Preview failed'); }
      finally {
        if (!abort.signal.aborted && generation.current === version) { setSnapshot({ ids, options }); setLoading(false); }
      }
    })();
    return () => abort.abort();
  }, [open, ids, options]);
  const current = snapshot?.ids === ids && snapshot.options === options;
  return { rows: current ? rows : [], error: current ? error : null, loading: open && (loading || !current), processed };
}
