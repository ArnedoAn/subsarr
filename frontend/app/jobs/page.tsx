'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, API_URL } from '@/lib/api';
import { type JobResult } from '@/lib/types';

interface LiveEvent {
  phase: string;
  progressPercent: number;
  message: string;
  timestamp: string;
  details?: any;
}

interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error';
  phase: string;
  message: string;
  timestamp: string;
  details?: any;
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobResult[]>([]);
  const [liveEvents, setLiveEvents] = useState<Record<string, LiveEvent>>({});
  const [expandedFailure, setExpandedFailure] = useState<Record<string, boolean>>({});
  const [consoleLogs, setConsoleLogs] = useState<LogEntry[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'waiting' | 'active' | 'completed' | 'failed'>('all');
  const [now, setNow] = useState<number>(0);

  const load = useCallback(async () => {
    const response = await apiGet<JobResult[]>('/jobs');
    setJobs(response);

    const logs = await apiGet<LogEntry[]>('/jobs/logs/all');
    setConsoleLogs(logs.slice(0, 8));
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, 3000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const activeJobs = jobs.filter((job) => job.state === 'active' || job.state === 'waiting');
    const sources = activeJobs.map((job) => {
      const source = new EventSource(`${API_URL}/jobs/${job.id}/stream`);
      source.onmessage = (event) => {
        const payload = JSON.parse(event.data) as LiveEvent;
        setLiveEvents((previous) => ({
          ...previous,
          [String(job.id)]: payload,
        }));
      };
      return source;
    });

    return () => {
      for (const source of sources) {
        source.close();
      }
    };
  }, [jobs]);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const stats = useMemo(() => {
    return {
      queued: jobs.filter((job) => job.state === 'waiting').length,
      active: jobs.filter((job) => job.state === 'active').length,
      completedToday: jobs.filter((job) => job.state === 'completed').length,
      failedToday: jobs.filter((job) => job.state === 'failed').length,
    };
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    return jobs
      .filter((job) => {
        if (statusFilter === 'all') {
          return true;
        }

        return job.state === statusFilter;
      })
      .filter((job) =>
        job.data.mediaItemPath.toLowerCase().includes(search.toLowerCase()),
      );
  }, [jobs, search, statusFilter]);

  const cancel = async (jobId: string | number) => {
    await apiPost(`/jobs/${jobId}/cancel`);
    await load();
  };

  return (
    <section className="space-y-8">
      {/* Page Header */}
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-headline font-black uppercase tracking-[0.05em] text-on-surface">
            Engine Diagnostics
          </h1>
          <p className="text-on-surface-variant mt-2 font-body text-sm">
            Real-time Subsarr processing pipeline monitoring.
          </p>
        </div>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="QUEUED" value={stats.queued} />
        <Stat label="ACTIVE" value={stats.active} pulse={stats.active > 0} />
        <Stat label="COMPLETED" value={stats.completedToday} />
        <Stat label="FAILED" value={stats.failedToday} error={stats.failedToday > 0} />
      </div>

      {/* Jobs Table */}
      <div className="bg-surface-container rounded-xl overflow-hidden">
        <div className="p-6 border-b border-cyan-400/15">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <h2 className="text-lg font-headline font-bold text-on-surface">Live Job Monitor</h2>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search filename..."
                className="engraved-input rounded-lg px-4 py-2.5 text-sm text-on-surface w-full sm:w-48"
              />
              <div className="relative">
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(
                      event.target.value as
                        | 'all'
                        | 'waiting'
                        | 'active'
                        | 'completed'
                        | 'failed',
                    )
                  }
                  className="engraved-input rounded-lg px-4 py-2.5 pr-10 text-sm text-on-surface appearance-none bg-surface-container-lowest cursor-pointer transition-all duration-200"
                >
                  <option value="all">All statuses</option>
                  <option value="waiting">Queued</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
                <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none text-[20px]">
                  expand_more
                </span>
              </div>
            </div>
          </div>
        </div>

        <table className="w-full text-left text-sm">
          <thead className="bg-surface-container-low">
            <tr>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant">Filename</th>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant">Languages</th>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant">Progress</th>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant">Phase</th>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant">Usage</th>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant">Elapsed</th>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant">Status</th>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredJobs.map((job, index) => {
              const live = liveEvents[String(job.id)];
              const progress =
                live?.progressPercent ?? Number(job.progress ?? 0);
              const phase = live?.phase ?? job.state;
              const elapsedMs =
                job.processedAt && !job.finishedAt
                  ? now - job.processedAt
                  : job.processedAt && job.finishedAt
                    ? job.finishedAt - job.processedAt
                    : 0;
              const filename =
                job.data.mediaItemPath.split(/[\\/]/).pop() ??
                job.data.mediaItemPath;

              return (
                <Fragment key={String(job.id)}>
                  <tr
                    className={`border-b border-cyan-400/10 transition-colors ${
                      index % 2 === 0 ? 'bg-surface-container' : 'bg-surface-container-low'
                    } hover:bg-primary/5`}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {job.state === 'active' ? (
                          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
                        ) : null}
                        <span className="font-medium text-on-surface">{filename}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-on-surface-variant">
                      {job.data.sourceLanguage.toUpperCase()} →{' '}
                      {job.data.targetLanguage.toUpperCase()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-2 w-36 overflow-hidden rounded-full bg-surface-container-highest">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{
                            width: `${Math.min(Math.max(progress, 0), 100)}%`,
                          }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-on-surface-variant">{progress}%</p>
                    </td>
                    <td className="px-6 py-4 text-on-surface-variant">{phase}</td>
                    <td className="px-6 py-4 text-on-surface-variant font-mono text-xs">
                      {job.returnValue?.usage.totalTokens ?? 0} tokens
                    </td>
                    <td className="px-6 py-4 text-on-surface-variant font-mono text-xs">{formatElapsed(elapsedMs)}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`badge ${
                          job.state === 'completed'
                            ? 'badge-success'
                            : job.state === 'failed'
                              ? 'badge-error'
                              : job.state === 'active'
                                ? 'badge-primary'
                                : 'badge-secondary'
                        }`}
                      >
                        {job.state}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {job.state === 'waiting' || job.state === 'failed' ? (
                          <button
                            onClick={() => void cancel(job.id)}
                            className="bg-error/10 text-error border border-error/30 px-3 py-1.5 rounded text-[10px] font-bold tracking-widest hover:bg-error/20 transition-colors"
                          >
                            {job.state === 'failed' ? 'DELETE' : 'CANCEL'}
                          </button>
                        ) : null}
                        {job.state === 'failed' ? (
                          <button
                            onClick={() =>
                              setExpandedFailure((previous) => ({
                                ...previous,
                                [String(job.id)]: !previous[String(job.id)],
                              }))
                            }
                            className="bg-error/10 text-error border border-error/30 px-3 py-1.5 rounded text-[10px] font-bold tracking-widest hover:bg-error/20 transition-colors"
                          >
                            {expandedFailure[String(job.id)]
                              ? 'HIDE'
                              : 'ERROR'}
                          </button>
                        ) : null}
                        <Link
                          href={`/logs?jobId=${job.id}`}
                          className="bg-surface-container-high text-on-surface px-3 py-1.5 rounded text-[10px] font-bold tracking-widest hover:bg-surface-variant transition-colors"
                        >
                          LOGS
                        </Link>
                      </div>
                    </td>
                  </tr>
                  {job.state === 'failed' && expandedFailure[String(job.id)] ? (
                    <tr className="border-b border-cyan-400/10">
                      <td colSpan={8} className="px-6 py-4 bg-surface-container-low">
                        <pre className="overflow-x-auto rounded-lg bg-surface-container-lowest p-4 text-xs font-mono text-error">
                          {job.failedReason ?? 'No error details'}
                        </pre>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        <div className="p-4 border-t border-cyan-400/15">
          <p className="text-xs text-on-surface-variant">
            Showing {filteredJobs.length} of {jobs.length} jobs
          </p>
        </div>
      </div>

      {/* Bottom Grid: Console + Resources */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Console Output */}
        <div className="lg:col-span-2 bg-surface-container rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-on-surface">Live Console Output</h3>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">AUTOSCROLL ON</span>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-lg bg-surface-container-lowest p-4 font-mono text-xs custom-scrollbar">
            {consoleLogs.map((log) => (
              <div key={log.id} className="mb-2">
                <p className="text-on-surface-variant">
                  <span className="text-on-surface">[{new Date(log.timestamp).toLocaleTimeString()}]</span>{' '}
                  <span
                    className={
                      log.level === 'error'
                        ? 'text-error'
                        : log.level === 'warn'
                          ? 'text-secondary'
                          : 'text-primary'
                    }
                  >
                    {log.level.toUpperCase()}
                  </span>
                  : {log.message}
                </p>
                {log.details && (
                  <pre className="mt-1 ml-4 overflow-x-auto rounded bg-surface-container-high p-2 text-[10px] text-on-surface-variant">
                    {JSON.stringify(log.details, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Node Resources */}
        <div className="bg-surface-container rounded-xl p-6">
          <h3 className="text-sm font-bold text-on-surface mb-6">Node Resources</h3>
          <Resource label="GPU Cluster A" value="92%" width="92%" />
          <Resource label="Memory Load" value="44%" width="44%" />
          <Resource label="Network Egress" value="1.2 GB/s" width="78%" />
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, pulse = false, error = false }: { label: string; value: number; pulse?: boolean; error?: boolean }) {
  return (
    <div className="bg-surface-container rounded-xl p-6">
      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">{label}</p>
      <p
        className={`mt-2 text-3xl font-black ${
          error ? 'text-error' : pulse ? 'text-primary animate-pulse' : 'text-on-surface'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Resource({ label, value, width }: { label: string; value: string; width: string }) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-on-surface-variant">{label}</span>
        <span className="text-xs font-mono font-bold text-on-surface">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-container-highest">
        <div className="h-full bg-primary" style={{ width }} />
      </div>
    </div>
  );
}

function formatElapsed(ms: number): string {
  if (ms <= 0) {
    return '0s';
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}
