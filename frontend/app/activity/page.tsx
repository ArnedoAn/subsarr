'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { apiPatch, apiPost, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { useJobEvents, type JobStreamEvent } from '@/lib/job-events';
import type { JobResult, JobsPageResponse, LogsPageResponse } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { useToast } from '@/components/ui/toast';
import { TranslationResultSummary } from '@/components/translation-result-summary';

interface JobEvent { jobId: string; phase?: string; progressPercent?: number; message?: string; type?: string }
const PAGE_SIZE = 50;
const inputClass = 'engraved-input px-3 py-2 text-sm w-full';

export default function ActivityPage() {
  return <Suspense fallback={<section aria-busy="true"><h1 className="text-2xl font-bold">Activity</h1><p>Loading activity…</p></section>}><Activity /></Suspense>;
}

function Activity() {
  const params = useSearchParams();
  const { success, error: toastError } = useToast();
  const tab = params.get('tab') === 'logs' ? 'logs' : params.get('tab') === 'history' ? 'history' : 'queue';
  const requestedPage = Number(params.get('page'));
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1;
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [events, setEvents] = useState<Record<string, JobEvent>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [cancelling, setCancelling] = useState<Record<string, boolean>>({});
  const [lastSuccess, setLastSuccess] = useState<number | null>(null);
  // router.replace() did not update this page's search params, so filter changes were lost.
  // Native history updates stay in sync with useSearchParams (same pattern as the library).
  const replaceSearch = (next: URLSearchParams) => window.history.replaceState(null, '', `/activity?${next.toString()}`);
  const update = (changes: Record<string, string>, reset = true) => {
    const next = new URLSearchParams(params.toString());
    if (reset) next.delete('page');
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key); }
    replaceSearch(next);
  };
  const serialized = params.toString();
  useEffect(() => { setDraft(q); }, [q]);
  useEffect(() => {
    if (draft === q) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(serialized);
      if (draft.trim()) next.set('q', draft.trim()); else next.delete('q');
      next.delete('page');
      window.history.replaceState(null, '', `/activity?${next.toString()}`);
    }, 350);
    return () => clearTimeout(timer);
  }, [draft, q, serialized]);

  const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
  if (q) query.set('q', q);
  const state = params.get('state') ?? '';
  if (tab !== 'logs') query.set('state', state || (tab === 'history' ? 'completed,failed,cancelled' : 'waiting,active,delayed,paused,cancelling'));
  else for (const key of ['level', 'jobId']) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  if (tab !== 'queue') for (const key of ['from', 'to'] as const) {
    // datetime-local values are local time; the API expects absolute instants.
    const date = new Date(params.get(key) ?? '');
    if (Number.isFinite(date.getTime())) query.set(key, date.toISOString());
  }
  const path = tab === 'logs' ? `/jobs/logs/all?${query}` : `/jobs?${query}`;
  const resource = useApiQuery<JobsPageResponse | LogsPageResponse>(path, { intervalMs: paused ? 0 : connected ? 30000 : 5000 });
  const refetch = useRef(resource.refetch);
  useEffect(() => { refetch.current = resource.refetch; }, [resource.refetch]);
  useEffect(() => { if (resource.data && !resource.error) setLastSuccess(Date.now()); }, [resource.data, resource.error]);
  const refreshTimer = useRef<number | undefined>(undefined);
  const wasPaused = useRef(paused);
  const lifecyclePhases = useRef<Record<string, string>>({});
  const receiveEvent = useCallback((payload: JobStreamEvent) => {
    if (paused) return;
    const phase = payload.phase ?? payload.type;
    const progressPercent = typeof payload.progressPercent === 'number' ? payload.progressPercent : undefined;
    setEvents(previous => {
      const next = { ...previous, [payload.jobId]: { jobId: payload.jobId, phase, progressPercent, message: payload.message } };
      const keys = Object.keys(next);
      if (keys.length > 200) delete next[keys[0]];
      return next;
    });
    if (phase && ['waiting', 'active', 'completed', 'failed', 'cancelling', 'cancelled', 'paused', 'delayed'].includes(phase)
      && lifecyclePhases.current[payload.jobId] !== phase) {
      lifecyclePhases.current[payload.jobId] = phase;
      const keys = Object.keys(lifecyclePhases.current);
      if (keys.length > 200) delete lifecyclePhases.current[keys[0]];
      if (refreshTimer.current === undefined) refreshTimer.current = window.setTimeout(() => {
        refreshTimer.current = undefined;
        refetch.current();
      }, 500);
    }
  }, [paused]);
  const streamState = useJobEvents(receiveEvent, !paused);
  useEffect(() => { setConnected(streamState === 'connected'); }, [streamState]);
  useEffect(() => {
    if (wasPaused.current && !paused) refetch.current();
    wasPaused.current = paused;
    if (paused) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = undefined;
    }
  }, [paused]);
  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  const jobs = resource.data && 'jobs' in resource.data ? resource.data.jobs : [];
  const logs = resource.data && 'logs' in resource.data ? resource.data.logs : [];
  const total = resource.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const mutate = async (job: JobResult, action: 'cancel' | 'retry' | 'priority', priority?: number, allowBudgetOverride = false) => {
    const id = String(job.id);
    setPending(previous => ({ ...previous, [id]: true }));
    try {
      if (action === 'priority') await apiPatch(`/jobs/${encodeURIComponent(id)}/priority`, { priority });
      else await apiPost(`/jobs/${encodeURIComponent(id)}/${action}`, action === 'retry' ? { allowBudgetOverride } : undefined);
      if (action === 'cancel') setCancelling(previous => ({ ...previous, [id]: true }));
      success(action === 'cancel' ? 'Cancellation requested; waiting for the worker to stop.' : action === 'retry' ? 'Job queued again' : 'Priority updated');
      resource.refetch();
    } catch (error) {
      if (action === 'retry' && !allowBudgetOverride && error instanceof ApiError && error.status === 409 && /budget/i.test(error.message) && window.confirm(`${error.message}\nRetry with an explicit monthly budget override?`)) {
        await mutate(job, action, priority, true);
      } else toastError(error instanceof Error ? error.message : 'Action failed');
    } finally { setPending(previous => ({ ...previous, [id]: false })); }
  };

  return <section className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold text-on-surface">Activity</h1><p className="text-sm text-on-surface-variant">Translation queue, history and diagnostics</p></div><div className="flex gap-2"><Button variant="secondary" onClick={() => setPaused(value => !value)}>{paused ? 'Resume' : 'Pause updates'}</Button><Button variant="secondary" onClick={resource.refetch}>Refresh</Button></div></header>
    <nav aria-label="Activity views" className="flex gap-2 border-b border-outline-variant/25 pb-2">{(['queue', 'history', 'logs'] as const).map(value => <Link key={value} href={`/activity?tab=${value}`} aria-current={tab === value ? 'page' : undefined} className={`btn ${tab === value ? 'btn-primary' : 'btn-ghost'}`}>{value[0].toUpperCase() + value.slice(1)}</Link>)}</nav>
    <p role="status" className="text-xs text-on-surface-variant">{resource.error ? 'Data unavailable / stale' : paused || streamState === 'paused' ? 'Updates paused' : connected ? 'Stream connected' : streamState === 'connecting' ? 'Stream connecting · polling fallback' : 'Stream disconnected · polling fallback'} · Last successful fetch: {lastSuccess ? new Date(lastSuccess).toLocaleString() : 'none yet'}{resource.refreshing ? ' · Refreshing…' : ''}</p>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 rounded-xl bg-surface-container p-4">
      <label className="text-xs">Search<input className={inputClass} value={draft} onChange={event => setDraft(event.target.value)} placeholder={tab === 'logs' ? 'Search log messages' : 'Search media or job ID'} /></label>
      {tab !== 'logs' && <label className="text-xs">Status<select className={inputClass} value={state} onChange={event => update({ state: event.target.value })}><option value="">All {tab === 'history' ? 'finished' : 'queued'} states</option>{(tab === 'history' ? ['completed', 'failed', 'cancelled'] : ['waiting', 'active', 'delayed', 'paused', 'cancelling']).map(value => <option key={value}>{value}</option>)}</select></label>}
      {tab === 'logs' && <>
        <label className="text-xs">Level<select className={inputClass} value={params.get('level') ?? ''} onChange={event => update({ level: event.target.value })}><option value="">All levels</option>{['info', 'warn', 'error'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="text-xs">Job ID<input className={inputClass} value={params.get('jobId') ?? ''} onChange={event => update({ jobId: event.target.value })} /></label>
      </>}
      {tab !== 'queue' && <>
        {(['from', 'to'] as const).map(key => <label key={key} className="text-xs">{key === 'from' ? (tab === 'history' ? 'Finished from' : 'From') : (tab === 'history' ? 'Finished until' : 'To')}<input type="datetime-local" className={inputClass} value={params.get(key) ?? ''} onChange={event => update({ [key]: event.target.value })} /></label>)}
        <div className="flex flex-wrap items-end gap-2 text-xs" role="group" aria-label="Quick date ranges">
          {([['Last hour', 60 * 60_000], ['Today', 0], ['Last 7 days', 7 * 24 * 60 * 60_000]] as const).map(([label, span]) => <Button key={label} variant="ghost" type="button" onClick={() => {
            const start = new Date(span ? Date.now() - span : new Date().setHours(0, 0, 0, 0));
            start.setSeconds(0, 0);
            // Format as a local datetime-local value (YYYY-MM-DDTHH:mm).
            const local = new Date(start.getTime() - start.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
            update({ from: local, to: '' });
          }}>{label}</Button>)}
        </div>
      </>}
      <Button variant="ghost" onClick={() => { setDraft(''); replaceSearch(new URLSearchParams({ tab })); }}>Clear filters</Button>
    </div>
    {resource.error && <div role="alert" className="rounded-xl border border-error/30 p-4 text-error"><p>{resource.error.message}</p><Button variant="secondary" onClick={resource.refetch}>Retry loading activity</Button></div>}
    {resource.loading && !resource.data ? <p aria-busy="true" className="p-8 text-center">Loading {tab}…</p> : !resource.error && total === 0 ? <div className="rounded-xl bg-surface-container p-8 text-center"><h2 className="font-semibold">No matching {tab === 'queue' ? 'jobs' : tab === 'logs' ? 'logs' : 'history'}</h2><p className="text-sm text-on-surface-variant">Change the filters or return to the library to queue a translation.</p><Link href="/" className="btn btn-secondary mt-3">Open library</Link></div> : null}
    {tab !== 'logs' ? <div className="space-y-3">{jobs.map(job => {
      const id = String(job.id); const live = events[id];
      const stopped = ['completed', 'failed', 'cancelled'].includes(job.state);
      const phase = cancelling[id] && !stopped ? 'cancelling' : stopped ? job.state : live?.phase ?? job.state;
      const progress = stopped ? Number(job.progress) : live?.progressPercent ?? Number(job.progress);
      const summary = job.returnValue && <TranslationResultSummary result={job.returnValue} mediaItemId={job.state === 'completed' ? job.data.mediaItemId : undefined} />;
      return <article key={id} className="rounded-xl border border-outline-variant/25 bg-surface-container p-4 space-y-3">
        <div className="flex flex-wrap justify-between gap-2"><h2 className="font-medium break-all">{job.data.mediaItemPath.split(/[\\/]/).pop()}</h2><Badge variant={phase === 'failed' ? 'error' : phase === 'completed' ? 'success' : 'neutral'}>{phase}</Badge></div>
        <details><summary className="text-xs text-on-surface-variant cursor-pointer">Job #{id} · {job.data.sourceLanguage} → {job.data.targetLanguage} · Full path</summary><p className="break-all text-xs font-mono mt-2">{job.data.mediaItemPath}</p></details>
        <ProgressBar value={Number.isFinite(progress) ? progress : 0} showLabel />
        {live?.message && !stopped && <p className="text-sm text-on-surface-variant">{live.message}</p>}
        {job.failedReason && <details className="text-error text-sm"><summary>Error details</summary><pre className="whitespace-pre-wrap break-all">{job.failedReason}</pre></details>}
        {job.returnValue && <p className="text-xs">{job.returnValue.usage.totalTokens.toLocaleString()} tokens · {job.returnValue.tierUsed === 'subscription' ? 'Subscription' : job.returnValue.tierUsed} · {job.returnValue.lineCount} lines</p>}
        {summary}
        <div className="flex flex-wrap items-center gap-2">
          {['waiting', 'active', 'delayed', 'paused'].includes(job.state) && phase !== 'cancelling' && <Button variant="danger" size="sm" disabled={pending[id]} onClick={() => void mutate(job, 'cancel')}>Cancel</Button>}
          {['failed', 'cancelled'].includes(job.state) && <Button variant="secondary" size="sm" disabled={pending[id]} onClick={() => void mutate(job, 'retry')}>Retry translation</Button>}
          {['waiting', 'delayed', 'paused'].includes(job.state) && <label className="text-xs">Priority <select aria-label={`Priority for job ${id}`} defaultValue="" disabled={pending[id]} className="engraved-input p-2" onChange={event => { if (event.target.value) void mutate(job, 'priority', Number(event.target.value)); }}><option value="">Change…</option>{[1,2,3,4,5,6,7,8,9,10].map(value => <option key={value} value={value}>{value}{value === 1 ? ' (highest)' : ''}</option>)}</select></label>}
          <Link href={`/activity?tab=logs&jobId=${encodeURIComponent(id)}`} className="btn btn-ghost btn-sm">View logs</Link>
        </div>
      </article>;
    })}</div> : <div className="space-y-2">{logs.map(log => <article key={log.id} className="rounded-lg border border-outline-variant/20 bg-surface-container p-3"><div className="flex flex-wrap gap-2 text-xs"><Badge variant={log.level === 'error' ? 'error' : log.level === 'warn' ? 'warning' : 'neutral'}>{log.level}</Badge><time dateTime={log.timestamp}>{new Date(log.timestamp).toLocaleString()}</time><span>{log.phase}</span>{log.jobId && <Link href={`/activity?tab=logs&jobId=${encodeURIComponent(log.jobId)}`}>Job #{log.jobId}</Link>}</div><p className="text-sm whitespace-pre-wrap break-words mt-2">{log.message}</p>{log.details != null && <details className="text-xs mt-2"><summary>Details</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(log.details, null, 2)}</pre></details>}</article>)}</div>}
    {resource.data && <footer className="flex flex-wrap items-center justify-between gap-3 text-sm"><p>{total.toLocaleString()} matching {tab === 'logs' ? 'logs' : 'jobs'} · Page {page} of {pages}</p><div className="flex gap-2"><Button variant="secondary" disabled={page <= 1 || resource.loading} onClick={() => update({ page: String(page - 1) }, false)}>Previous</Button><Button variant="secondary" disabled={page >= pages || resource.loading} onClick={() => update({ page: String(page + 1) }, false)}>Next</Button></div></footer>}
  </section>;
}
