'use client';
import { useEffect, useRef, useState } from 'react';
import { apiPost } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { diagnosticDuration, diagnosticText, numericDiagnostics } from '@/lib/diagnostics';
import { useApiQuery } from '@/lib/use-api-query';
import type { LibraryScanStatus } from '@/lib/types';
export function ScanPanel({ onCompleted }: { onCompleted: () => void }) {
  const { data, error, refetch } = useApiQuery<LibraryScanStatus>('/library/scan-status', { intervalMs: 2000 });
  const [requestError, setRequestError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const lastObserved = useRef<{ successAt: number | null } | null>(null);
  const { error: showError } = useToast();
  useEffect(() => {
    if (error) showError(`Unable to load scan status: ${diagnosticText(error.message)}`);
  }, [error, showError]);
  useEffect(() => {
    if (!data) return;
    const previous = lastObserved.current;
    lastObserved.current = { successAt: data.lastSuccessAt };
    if (previous && data.lastSuccessAt !== null && previous.successAt !== data.lastSuccessAt) onCompleted();
  }, [data, onCompleted]);
  return <section className="rounded-lg bg-surface-container p-4 space-y-2" aria-label="Library scan">
    <div className="flex flex-wrap items-center justify-between gap-3"><p>Scan: {data?.state ?? (error ? 'unavailable' : 'loading')}{data?.lastSuccessAt ? ` · Last success ${new Date(data.lastSuccessAt).toLocaleString()}` : ''}</p>
      <button className="btn btn-secondary btn-sm" disabled={pending || data?.state === 'running'} onClick={async () => {
        setPending(true); setRequestError(null);
        try { await apiPost('/library/rescan'); refetch(); } catch (reason) {
          const message = diagnosticText(reason instanceof Error ? reason.message : 'Rescan failed');
          setRequestError(message); showError(message);
        } finally { setPending(false); }
      }}>{pending ? 'Requesting…' : data?.state === 'running' ? 'Scanning…' : 'Rescan library'}</button></div>
    {(requestError || error || data?.lastError) && <p role="alert" className="text-error break-words">{diagnosticText(requestError ?? error?.message ?? data?.lastError ?? '')}</p>}
    {data?.metrics && <details open={data.state === 'running'}><summary className="cursor-pointer text-sm">{data.metrics.processedFiles} / {data.metrics.discoveredFiles} files processed · {data.metrics.itemCount} inventory items · {data.metrics.pendingFiles ?? 'Unknown'} pending stability</summary><dl className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mt-3">{numericDiagnostics(data.metrics).map(([key, value]) => <div key={key}><dt className="text-on-surface-variant break-words">{key}</dt><dd>{String(value)}</dd></div>)}</dl>{data.metrics.roots.map(root => <p className="text-xs break-all" key={root.path}>{diagnosticText(root.path)}: {root.discoveredFiles} files, {root.directoryErrors} directory errors, {diagnosticDuration(root.durationMs)}</p>)}</details>}
  </section>;
}
