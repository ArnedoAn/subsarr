'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost, API_URL } from '@/lib/api';
import { type JobResult } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress-bar';
import { useToast } from '@/components/ui/toast';

interface LiveEvent {
  phase: string;
  progressPercent: number;
  message: string;
  timestamp: string;
}

interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error';
  phase: string;
  message: string;
  timestamp: string;
  details?: unknown;
}

function formatElapsed(ms: number): string {
  if (ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function formatEtaRemaining(ms: number): string {
  if (ms <= 0 || !Number.isFinite(ms)) return '';
  return `≈ ${formatElapsed(ms)} restantes`;
}

function jobEtaLabel(job: JobResult, progressPct: number, nowMs: number): string | null {
  if (job.state !== 'active' && job.state !== 'waiting') return null;
  const start = job.processedAt ?? job.createdAt;
  if (!start) return null;
  if (progressPct < 3 || progressPct > 97) return null;
  const elapsed = nowMs - start;
  if (elapsed < 2000) return null;
  const eta = elapsed * (100 / progressPct - 1);
  if (!Number.isFinite(eta) || eta < 0 || eta > 72 * 3600 * 1000) return null;
  return formatEtaRemaining(eta);
}

function tryBrowserNotify(title: string, body: string) {
  if (typeof document === 'undefined') return;
  if (document.visibilityState === 'visible') return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: '/favicon.ico' });
  } catch {
    /* ignore */
  }
}

const PHASE_CONFIG: Record<string, { variant: 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'neutral'; icon: string }> = {
  waiting:    { variant: 'warning',   icon: 'hourglass_empty' },
  active:     { variant: 'primary',   icon: 'play_arrow'      },
  parsing:    { variant: 'secondary', icon: 'description'     },
  translating:{ variant: 'primary',   icon: 'translate'       },
  writing:    { variant: 'secondary', icon: 'edit_document'   },
  completed:  { variant: 'success',   icon: 'check_circle'    },
  failed:     { variant: 'error',     icon: 'error'           },
  cancelled:  { variant: 'error',     icon: 'cancel'          },
};

function PhaseBadge({ phase }: { phase: string }) {
  const cfg = PHASE_CONFIG[phase.toLowerCase()] ?? { variant: 'neutral' as const, icon: 'radio_button_unchecked' };
  return (
    <Badge variant={cfg.variant} icon={cfg.icon}>
      {phase}
    </Badge>
  );
}

export default function JobsPage() {
  const { success: toastSuccess, error: toastError } = useToast();
  const [jobs, setJobs]             = useState<JobResult[]>([]);
  const [liveEvents, setLiveEvents] = useState<Record<string, LiveEvent>>({});
  const [expandedError, setExpandedError] = useState<Record<string, boolean>>({});
  const [expandedPath, setExpandedPath] = useState<Record<string, boolean>>({});
  const [expandAllPaths, setExpandAllPaths] = useState(false);
  /** Con “mostrar todos”, filas que el usuario eligió ocultar. */
  const [pathHiddenWhenAll, setPathHiddenWhenAll] = useState<Record<string, boolean>>({});
  const [logs, setLogs]             = useState<LogEntry[]>([]);
  const [logsOpen, setLogsOpen]     = useState(true);
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'waiting' | 'active' | 'completed' | 'failed'>('all');
  const [now, setNow]               = useState(0);
  const logRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [jobsRes, logsRes] = await Promise.all([
      apiGet<JobResult[]>('/jobs'),
      apiGet<LogEntry[]>('/jobs/logs/all').catch(() => [] as LogEntry[]),
    ]);
    setJobs(jobsRes);
    setLogs(logsRes.slice(0, 20));
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);


  /* SSE streams for active jobs */
  useEffect(() => {
    const active = jobs.filter(j => j.state === 'active' || j.state === 'waiting');
    const sources = active.map(job => {
      const src = new EventSource(`${API_URL}/jobs/${job.id}/stream`);
      src.onmessage = ev => {
        const payload = JSON.parse(ev.data) as LiveEvent;
        setLiveEvents(prev => ({ ...prev, [String(job.id)]: payload }));
        const ph = payload.phase.toLowerCase();
        if (ph === 'completed') {
          tryBrowserNotify('Traducción lista', payload.message || 'Job completado');
        }
        if (ph === 'failed') {
          tryBrowserNotify('Traducción fallida', payload.message || 'Error en el job');
        }
      };
      return src;
    });
    return () => sources.forEach(s => s.close());
  }, [jobs]);

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  /* Auto-scroll logs */
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const stats = useMemo(() => ({
    queued:    jobs.filter(j => j.state === 'waiting').length,
    active:    jobs.filter(j => j.state === 'active').length,
    completed: jobs.filter(j => j.state === 'completed').length,
    failed:    jobs.filter(j => j.state === 'failed').length,
  }), [jobs]);

  const filteredJobs = useMemo(() => jobs
    .filter(j => statusFilter === 'all' ? true : j.state === statusFilter)
    .filter(j => j.data.mediaItemPath.toLowerCase().includes(search.toLowerCase())),
    [jobs, search, statusFilter]
  );

  const toggleExpandAllPaths = () => {
    setPathHiddenWhenAll({});
    setExpandAllPaths(v => !v);
  };

  const cancel = async (jobId: string | number) => {
    if (!window.confirm('¿Cancelar este job?')) return;
    try {
      await apiPost(`/jobs/${jobId}/cancel`);
      toastSuccess('Job cancelled');
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Cancel failed');
    }
  };

  const retryJob = async (jobId: string | number) => {
    try {
      await apiPost(`/jobs/${jobId}/retry`);
      toastSuccess('Job re-enqueued');
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Retry failed');
    }
  };

  return (
    <section className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-on-surface tracking-tight">Jobs</h1>
        <p className="text-sm text-on-surface-variant mt-0.5">Translation queue and processing status</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Queued"    value={stats.queued}    icon="hourglass_empty" variant="warning" />
        <StatCard label="Active"    value={stats.active}    icon="play_arrow"      variant="primary"  pulse={stats.active > 0} />
        <StatCard label="Completed" value={stats.completed} icon="check_circle"    variant="success" />
        <StatCard label="Failed"    value={stats.failed}    icon="error"           variant="error" />
      </div>

      {/* Job Queue */}
      <div className="bg-surface-container rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-outline-variant/15 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-on-surface">Job Queue</h2>
            {filteredJobs.length > 0 && (
              <button
                type="button"
                onClick={() => toggleExpandAllPaths()}
                className="md:hidden btn btn-ghost btn-xs gap-1 text-on-surface-variant hover:text-on-surface"
                title={expandAllPaths ? 'Hide all full paths' : 'Show all full paths'}
                aria-expanded={expandAllPaths}
                aria-label={expandAllPaths ? 'Hide all full paths' : 'Show all full paths'}
              >
                <span className="material-symbols-outlined text-[16px]">
                  {expandAllPaths ? 'unfold_less' : 'unfold_more'}
                </span>
                <span className="text-[11px] font-medium">Full paths</span>
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <div className="relative">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search filename…"
                className="engraved-input text-sm px-3 py-1.5 pl-8 w-44"
              />
              <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant pointer-events-none">search</span>
            </div>
            <div className="relative">
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
                className="engraved-input text-sm px-3 py-1.5 pr-8 appearance-none cursor-pointer"
              >
                <option value="all">All statuses</option>
                <option value="waiting">Queued</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
              <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant pointer-events-none">expand_more</span>
            </div>
          </div>
        </div>

        {filteredJobs.length === 0 ? (
          <EmptyState
            icon="work_history"
            title="No jobs found"
            description={search || statusFilter !== 'all' ? 'Try adjusting your filters' : 'Queue a translation from the Library to get started'}
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto custom-scrollbar">
              <table className="w-full text-sm data-table min-w-[900px]">
                <thead>
                  <tr className="bg-surface-container-low">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                      <div className="flex items-center gap-2 min-w-0">
                        <span>File</span>
                        <button
                          type="button"
                          onClick={() => toggleExpandAllPaths()}
                          className="btn btn-ghost btn-icon btn-xs flex-shrink-0 text-on-surface-variant hover:text-on-surface"
                          title={expandAllPaths ? 'Hide all full paths' : 'Show all full paths'}
                          aria-expanded={expandAllPaths}
                          aria-label={expandAllPaths ? 'Hide all full paths' : 'Show all full paths'}
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            {expandAllPaths ? 'unfold_less' : 'unfold_more'}
                          </span>
                        </button>
                      </div>
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Languages</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant w-40">Progress</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Phase</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Tokens</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Elapsed</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-on-surface-variant w-32">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job, idx) => {
                    const live     = liveEvents[String(job.id)];
                    const progress = live?.progressPercent ?? Number(job.progress ?? 0);
                    const phase    = live?.phase ?? job.state;
                    const elapsedMs = job.processedAt && !job.finishedAt
                      ? now - job.processedAt
                      : job.processedAt && job.finishedAt
                        ? job.finishedAt - job.processedAt
                        : 0;
                    const etaText = jobEtaLabel(job, progress, now);
                    const filename = job.data.mediaItemPath.split(/[\\/]/).pop() ?? job.data.mediaItemPath;
                    const fullPath   = job.data.mediaItemPath;
                    const jobKey     = String(job.id);
                    const pathRowVisible = expandAllPaths
                      ? !pathHiddenWhenAll[jobKey]
                      : Boolean(expandedPath[jobKey]);

                    return (
                      <Fragment key={jobKey}>
                        <tr className={`border-b border-outline-variant/10 ${idx % 2 === 0 ? 'bg-surface-container' : 'bg-surface-container-low'}`}>
                          <td className="px-4 py-3 max-w-[200px]">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {job.state === 'active' && (
                                <span className="pulse-dot h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                              )}
                              <span className="font-medium text-on-surface truncate text-sm min-w-0 flex-1" title={fullPath}>
                                {filename}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  if (expandAllPaths) {
                                    setPathHiddenWhenAll(prev => ({
                                      ...prev,
                                      [jobKey]: !prev[jobKey],
                                    }));
                                  } else {
                                    setExpandedPath(prev => ({
                                      ...prev,
                                      [jobKey]: !prev[jobKey],
                                    }));
                                  }
                                }}
                                className="btn btn-ghost btn-icon btn-xs flex-shrink-0 text-on-surface-variant hover:text-on-surface"
                                title={
                                  expandAllPaths
                                    ? pathRowVisible
                                      ? 'Hide full path for this row'
                                      : 'Show full path for this row'
                                    : pathRowVisible
                                      ? 'Hide full path'
                                      : 'Show full path'
                                }
                                aria-expanded={pathRowVisible}
                                aria-label={
                                  pathRowVisible ? 'Hide full path' : 'Show full path'
                                }
                              >
                                <span className="material-symbols-outlined text-[18px]">
                                  {pathRowVisible ? 'expand_less' : 'unfold_more'}
                                </span>
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs font-mono text-on-surface-variant whitespace-nowrap">
                            {job.data.sourceLanguage.toUpperCase()} → {job.data.targetLanguage.toUpperCase()}
                          </td>
                          <td className="px-4 py-3">
                            <div className="space-y-0.5 min-w-[100px]">
                              <ProgressBar value={progress} showLabel />
                              {etaText && (
                                <p className="text-[10px] font-mono text-on-surface-variant">{etaText}</p>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <PhaseBadge phase={phase} />
                          </td>
                          <td className="px-4 py-3 text-xs font-mono text-on-surface-variant whitespace-nowrap">
                            {job.returnValue?.usage.totalTokens
                              ? `${(job.returnValue.usage.totalTokens / 1000).toFixed(1)}k`
                              : '—'
                            }
                          </td>
                          <td className="px-4 py-3 text-xs font-mono text-on-surface-variant whitespace-nowrap">
                            {formatElapsed(elapsedMs)}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant={
                                job.state === 'completed' ? 'success' :
                                job.state === 'failed'    ? 'error'   :
                                job.state === 'active'    ? 'primary' : 'warning'
                              }
                            >
                              {job.state}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              {(job.state === 'waiting' || job.state === 'active') && (
                                <Button variant="danger" size="xs" onClick={() => void cancel(job.id)}>
                                  Cancel
                                </Button>
                              )}
                              {(job.state === 'failed' || job.state === 'cancelled') && (
                                <Button variant="secondary" size="xs" onClick={() => void retryJob(job.id)}>
                                  Retry
                                </Button>
                              )}
                              {job.state === 'failed' && (
                                <Button
                                  variant="danger"
                                  size="xs"
                                  onClick={() => setExpandedError(prev => ({ ...prev, [jobKey]: !prev[jobKey] }))}
                                >
                                  {expandedError[jobKey] ? 'Hide' : 'Error'}
                                </Button>
                              )}
                              <Link
                                href={`/archive?jobId=${job.id}`}
                                className="btn btn-ghost btn-xs"
                              >
                                Logs
                              </Link>
                            </div>
                          </td>
                        </tr>
                        {pathRowVisible && (
                          <tr className="border-b border-outline-variant/10 bg-surface-container-low/80">
                            <td colSpan={8} className="px-4 py-2.5">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant mb-1">
                                Full path
                              </p>
                              <p className="text-xs font-mono text-on-surface break-all whitespace-pre-wrap leading-relaxed">
                                {fullPath}
                              </p>
                            </td>
                          </tr>
                        )}
                        {job.state === 'failed' && expandedError[jobKey] && (
                          <tr className="border-b border-outline-variant/10">
                            <td colSpan={8} className="px-4 py-3 bg-surface-container-low">
                              <pre className="overflow-x-auto rounded bg-surface-container-lowest p-3 text-xs font-mono text-error leading-relaxed">
                                {job.failedReason ?? 'No error details'}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-outline-variant/10">
              {filteredJobs.map(job => {
                const live     = liveEvents[String(job.id)];
                const progress = live?.progressPercent ?? Number(job.progress ?? 0);
                const phase    = live?.phase ?? job.state;
                const elapsedMs = job.processedAt && !job.finishedAt
                  ? now - job.processedAt
                  : job.processedAt && job.finishedAt
                    ? job.finishedAt - job.processedAt
                    : 0;
                const etaText = jobEtaLabel(job, progress, now);
                const filename = job.data.mediaItemPath.split(/[\\/]/).pop() ?? job.data.mediaItemPath;
                const fullPath = job.data.mediaItemPath;
                const jobKey = String(job.id);
                const pathRowVisible = expandAllPaths
                  ? !pathHiddenWhenAll[jobKey]
                  : Boolean(expandedPath[jobKey]);
                return (
                  <div key={jobKey} className="p-4 bg-surface-container space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {job.state === 'active' && <span className="pulse-dot h-2 w-2 rounded-full bg-primary flex-shrink-0" />}
                        <p className="font-medium text-on-surface text-sm truncate min-w-0 flex-1" title={fullPath}>
                          {filename}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            if (expandAllPaths) {
                              setPathHiddenWhenAll(prev => ({
                                ...prev,
                                [jobKey]: !prev[jobKey],
                              }));
                            } else {
                              setExpandedPath(prev => ({
                                ...prev,
                                [jobKey]: !prev[jobKey],
                              }));
                            }
                          }}
                          className="btn btn-ghost btn-icon btn-xs flex-shrink-0 text-on-surface-variant"
                          aria-expanded={pathRowVisible}
                          aria-label={pathRowVisible ? 'Hide full path' : 'Show full path'}
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            {pathRowVisible ? 'expand_less' : 'unfold_more'}
                          </span>
                        </button>
                      </div>
                      <Badge
                        variant={job.state === 'completed' ? 'success' : job.state === 'failed' ? 'error' : job.state === 'active' ? 'primary' : 'warning'}
                      >
                        {job.state}
                      </Badge>
                    </div>
                    {pathRowVisible && (
                      <p className="text-xs font-mono text-on-surface break-all whitespace-pre-wrap leading-relaxed bg-surface-container-low rounded-md px-2 py-2 border border-outline-variant/15">
                        {fullPath}
                      </p>
                    )}
                    <div className="text-xs text-on-surface-variant font-mono">
                      {job.data.sourceLanguage.toUpperCase()} → {job.data.targetLanguage.toUpperCase()} · {formatElapsed(elapsedMs)}
                    </div>
                    <div className="space-y-0.5">
                      <ProgressBar value={progress} showLabel />
                      {etaText && (
                        <p className="text-[10px] font-mono text-on-surface-variant">{etaText}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <PhaseBadge phase={phase} />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {(job.state === 'waiting' || job.state === 'active') && (
                        <Button variant="danger" size="xs" onClick={() => void cancel(job.id)}>Cancel</Button>
                      )}
                      {(job.state === 'failed' || job.state === 'cancelled') && (
                        <Button variant="secondary" size="xs" onClick={() => void retryJob(job.id)}>Retry</Button>
                      )}
                      <Link href={`/archive?jobId=${job.id}`} className="btn btn-ghost btn-xs">Logs</Link>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-4 py-3 border-t border-outline-variant/15 bg-surface-container-low">
              <p className="text-xs text-on-surface-variant">
                Showing {filteredJobs.length} of {jobs.length} jobs
              </p>
            </div>
          </>
        )}
      </div>

      {/* Recent Logs Console */}
      <div className="bg-surface-container rounded-lg overflow-hidden">
        <button
          onClick={() => setLogsOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
        >
          <span className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">terminal</span>
            Recent Logs
            <span className="text-[10px] font-mono text-primary/70">LIVE</span>
          </span>
          <span
            className="material-symbols-outlined text-[18px] transition-transform"
            style={{ transform: logsOpen ? 'rotate(180deg)' : undefined }}
          >
            expand_more
          </span>
        </button>

        {logsOpen && (
          <div
            ref={logRef}
            className="max-h-56 overflow-y-auto bg-surface-container-lowest px-4 py-3 font-mono text-xs custom-scrollbar border-t border-outline-variant/15"
          >
            {logs.length === 0 ? (
              <p className="text-on-surface-variant/50 text-center py-4">No logs yet</p>
            ) : (
              logs.map(log => (
                <div key={log.id} className="mb-1.5 flex items-start gap-2">
                  <span className="text-on-surface-variant/50 flex-shrink-0">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span
                    className={`flex-shrink-0 font-bold ${
                      log.level === 'error' ? 'text-error' : log.level === 'warn' ? 'text-warning' : 'text-primary'
                    }`}
                  >
                    {log.level.toUpperCase()}
                  </span>
                  <span className="text-on-surface-variant">{log.message}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function StatCard({
  label, value, icon, variant, pulse = false,
}: {
  label: string; value: number; icon: string;
  variant: 'primary' | 'success' | 'warning' | 'error';
  pulse?: boolean;
}) {
  const colors = {
    primary: 'text-primary',
    success: 'text-success',
    warning: 'text-warning',
    error:   'text-error',
  };
  return (
    <div className="bg-surface-container rounded-lg p-4 flex items-center gap-3">
      <span
        className={`material-symbols-outlined text-[24px] ${colors[variant]} ${pulse ? 'animate-pulse' : ''}`}
        style={{ fontVariationSettings: 'FILL 1' }}
      >
        {icon}
      </span>
      <div>
        <p className="text-2xl font-bold text-on-surface">{value}</p>
        <p className="text-xs text-on-surface-variant font-medium uppercase tracking-wide">{label}</p>
      </div>
    </div>
  );
}
