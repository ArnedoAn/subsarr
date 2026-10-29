'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { apiDownload } from '@/lib/api';
import { diagnosticBasename, diagnosticDuration, diagnosticText, numericDiagnostics } from '@/lib/diagnostics';
import { useApiQuery } from '@/lib/use-api-query';
import type { LibraryScanPage, LibraryScanRun, LibraryScanStatus, LibraryWatchStatus } from '@/lib/types';

function WatchStatus({ status }: { status: LibraryWatchStatus }) {
  return <div className="space-y-1 text-sm">
    <p>Watcher: {status.enabled ? 'Enabled' : 'Disabled'} · {status.watching} directories watched · {status.dirtyDirectories} directories awaiting refresh · {status.reconciling ? 'Reconciling' : 'Idle'} · {status.overflow} over watch limit</p>
    {!status.enabled && <p className="text-on-surface-variant">Periodic and manual library scans remain available.</p>}
    {status.errors.map((error, index) => <p key={index} className="break-words text-error">{diagnosticText(error)}</p>)}
  </div>;
}

function ScanRunDetails({ id }: { id: string }) {
  const { data, error, loading, refetch } = useApiQuery<LibraryScanRun>(`/library/scans/${encodeURIComponent(id)}`);
  const { error: showError } = useToast();
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    if (error) showError(`Unable to load scan details: ${diagnosticText(error.message)}`);
  }, [error, showError]);

  async function download() {
    setExporting(true);
    try {
      const blob = await apiDownload(`/library/scans/${encodeURIComponent(id)}/export`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'subsarr-scan-report.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      showError(`Unable to export scan: ${diagnosticText(reason instanceof Error ? reason.message : 'Download failed')}`);
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <p role="status" className="p-3 text-sm">Loading scan details…</p>;
  return <div className="border-t border-outline-variant p-3 space-y-4">
    {error && <div role="alert" className="text-sm text-error">Scan details unavailable. <button type="button" className="underline" onClick={refetch}>Retry</button></div>}
    {data && <>
      {data.error && <p role="alert" className="text-sm text-error break-words">{diagnosticText(data.error)}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">{data.metrics.processedFiles} / {data.metrics.discoveredFiles} files · {data.metrics.itemCount} inventory items · Pending stability: {data.metrics.pendingFiles ?? 'Unavailable'}</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={download} disabled={exporting}>{exporting ? 'Exporting…' : 'Export JSON'}</button>
      </div>
      <p className="text-xs text-on-surface-variant">Exports use basenames only and redact diagnostic errors by default.</p>
      <div><h4 className="font-medium text-sm">Phase timings</h4>
        <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {([
            ['Total wall time', data.metrics.wallTimeMs], ['Discovery', data.metrics.discoveryWallTimeMs], ['Build', data.metrics.buildWallTimeMs],
            ['File stat (summed)', data.metrics.statDurationMs], ['Cache read (summed)', data.metrics.cacheReadDurationMs], ['Cache write (summed)', data.metrics.cacheWriteDurationMs],
            ['Probe (summed)', data.metrics.probeDurationMs], ['Sidecars (summed)', data.metrics.sidecarReadDurationMs],
            ['Probe p50', data.metrics.probeP50Ms], ['Probe p95', data.metrics.probeP95Ms], ['Probe maximum', data.metrics.probeMaxMs],
          ] as const).map(([label, value]) => <div key={label} className="text-xs"><dt className="text-on-surface-variant">{label}</dt><dd>{value === null ? 'Unavailable' : diagnosticDuration(value)}</dd></div>)}
        </dl><p className="mt-2 text-xs text-on-surface-variant">Summed concurrent operation timings may exceed total wall time.</p>
      </div>
      <div><h4 className="font-medium text-sm">Cache, probes and errors</h4><dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {numericDiagnostics({ 'Cache hits': data.metrics.cacheHits, 'Negative cache hits': data.metrics.negativeCacheHits, 'Cache misses': data.metrics.cacheMisses, 'Cache read errors': data.metrics.cacheReadErrors, 'Cache write errors': data.metrics.cacheWriteErrors, 'Malformed cache entries': data.metrics.cacheMalformedEntries, Probes: data.metrics.probes, 'Probe errors': data.metrics.probeErrors, 'Probe timeouts': data.metrics.probeTimeouts, 'Large files skipped': data.metrics.skippedLargeFiles, 'Stat failures': data.metrics.statFailures, 'Item failures': data.metrics.itemFailures, 'Directory errors': data.metrics.directoryErrors, 'Sidecar errors': data.metrics.sidecarReadErrors }).map(([label, value]) => <div key={label} className="text-xs"><dt className="text-on-surface-variant">{label}</dt><dd>{value}</dd></div>)}
      </dl></div>
      {data.metrics.roots.length > 0 && <div><h4 className="font-medium text-sm">Roots</h4><ul className="space-y-1 text-xs">{data.metrics.roots.map((root, index) => <li key={index} className="break-all">{diagnosticText(root.path)} · {root.discoveredFiles} files · {root.directoryErrors} directory errors · {diagnosticDuration(root.durationMs)}</li>)}</ul></div>}
      <div><h4 className="font-medium text-sm">Recorded errors</h4>{data.failures.length === 0 ? <p className="text-sm text-on-surface-variant">No recorded errors.</p> : <ul className="space-y-2 text-sm">{data.failures.map((failure, index) => <li key={index} className="break-words text-error">{diagnosticText(failure.event)}{failure.path ? ` · ${diagnosticBasename(failure.path)}` : ''}{failure.error ? ` · ${diagnosticText(failure.error)}` : ''}</li>)}</ul>}</div>
      <div><h4 className="font-medium text-sm">Slow files</h4>{data.slowFiles.length === 0 ? <p className="text-sm text-on-surface-variant">No slow files recorded.</p> : <ul className="space-y-1 text-sm">{data.slowFiles.map((file, index) => <li key={index} className="break-all">{diagnosticBasename(file.path)} · {diagnosticDuration(file.durationMs)}</li>)}</ul>}</div>
      <div><h4 className="font-medium text-sm">Watcher at scan completion</h4><WatchStatus status={data.watcher} /></div>
    </>}
  </div>;
}

export function ScanHistoryPanel() {
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const pageSize = 10;
  const history = useApiQuery<LibraryScanPage>(`/library/scans?offset=${offset}&limit=${pageSize}`, { intervalMs: 10000 });
  const watcher = useApiQuery<LibraryWatchStatus>('/library/watch-status', { intervalMs: 10000 });
  const current = useApiQuery<LibraryScanStatus>('/library/scan-status', { intervalMs: 10000 });
  const { error: showError } = useToast();
  useEffect(() => { if (history.error) showError(`Scan history unavailable: ${diagnosticText(history.error.message)}`); }, [history.error, showError]);
  useEffect(() => { if (watcher.error) showError(`Watcher status unavailable: ${diagnosticText(watcher.error.message)}`); }, [watcher.error, showError]);
  useEffect(() => { if (current.error) showError(`Pending file status unavailable: ${diagnosticText(current.error.message)}`); }, [current.error, showError]);
  const refreshing = history.refreshing || watcher.refreshing || current.refreshing;

  return <section className="rounded-lg bg-surface-container p-4 space-y-4" aria-label="Scan history and diagnostics" aria-busy={refreshing}>
    <div className="flex flex-wrap justify-between items-center gap-3"><div><h2 className="font-semibold">Scan history & diagnostics</h2><p className="text-sm text-on-surface-variant">Recent scans, download stability and incremental refresh health.</p></div><button type="button" className="btn btn-secondary btn-sm" disabled={refreshing} onClick={() => { history.refetch(); watcher.refetch(); current.refetch(); }}>{refreshing ? 'Refreshing…' : 'Refresh diagnostics'}</button></div>
    {watcher.data && <WatchStatus status={watcher.data} />}
    {watcher.error && <p role="alert" className="text-sm text-error">Watcher status unavailable{watcher.data ? ' · Showing previous result' : ''}.</p>}
    <p className="text-sm">Files awaiting download stability (latest scan): {current.data?.metrics?.pendingFiles ?? 'Unavailable'}{current.data?.state === 'running' ? ' · Scan in progress' : ''}</p>
    {current.error && <p role="alert" className="text-sm text-error">Pending file count unavailable; refresh diagnostics to retry.</p>}
    {history.loading && <p role="status" className="text-sm">Loading scan history…</p>}
    {history.error && <p role="alert" className="text-sm text-error">Scan history unavailable{history.data ? ' · Showing previous results' : ''}. Use Refresh diagnostics to retry.</p>}
    {history.data && <>
      {history.data.items.length === 0 && <p className="text-sm text-on-surface-variant">No scans recorded on this page.</p>}
      <ul className="space-y-2">{history.data.items.map(run => <li key={run.id} className="rounded border border-outline-variant overflow-hidden">
        <button type="button" aria-expanded={expanded === run.id} aria-controls={`scan-${run.id}`} className="w-full p-3 text-left flex flex-wrap items-center justify-between gap-2 hover:bg-surface-container-high" onClick={() => setExpanded(expanded === run.id ? null : run.id)}>
          <span className="text-sm">{new Date(run.startedAt).toLocaleString()} · {run.trigger ?? 'Unknown trigger'}<span className={`block ${run.state === 'failed' ? 'text-error' : 'text-on-surface-variant'}`}>{run.state} · {diagnosticDuration(run.finishedAt - run.startedAt)}</span></span><span className="text-sm text-primary">{expanded === run.id ? 'Hide details' : 'View details'}</span>
        </button>
        {expanded === run.id && <div id={`scan-${run.id}`}><ScanRunDetails id={run.id} /></div>}
      </li>)}</ul>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><p>{history.data.total === 0 ? '0 scans' : `${offset + 1}–${Math.min(offset + history.data.items.length, history.data.total)} of ${history.data.total} scans`}</p><div className="flex gap-2"><button type="button" className="btn btn-secondary btn-sm" disabled={offset === 0 || history.loading} onClick={() => { setExpanded(null); setOffset(Math.max(0, offset - pageSize)); }}>Previous</button><button type="button" className="btn btn-secondary btn-sm" disabled={offset + pageSize >= history.data.total || history.loading} onClick={() => { setExpanded(null); setOffset(offset + pageSize); }}>Next</button></div></div>
    </>}
  </section>;
}
