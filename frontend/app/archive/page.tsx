'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  id: string;
  jobId?: string;
  level: LogLevel;
  phase: string;
  message: string;
  timestamp: string;
  details?: Record<string, string | number | boolean | null>;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState<'' | LogLevel>('');
  const [jobId, setJobId] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (level) {
      params.set('level', level);
    }
    if (jobId.trim()) {
      params.set('jobId', jobId.trim());
    }
    if (search.trim()) {
      params.set('search', search.trim());
    }
    if (from) {
      params.set('from', new Date(from).toISOString());
    }
    if (to) {
      params.set('to', new Date(to).toISOString());
    }

    const response = await apiGet<LogEntry[]>(`/jobs/logs/all?${params.toString()}`);
    setLogs(response);
  }, [level, jobId, search, from, to]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const incomingJobId = params.get('jobId');
    if (incomingJobId) {
      setJobId(incomingJobId);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }

    const timer = setInterval(() => {
      void load();
    }, 4000);

    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  return (
    <section className="space-y-8">
      {/* Page Header */}
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-headline font-black uppercase tracking-[0.05em] text-on-surface">
            Archive
          </h1>
          <p className="text-on-surface-variant mt-2 font-body text-sm">
            System event logs and diagnostic history.
          </p>
        </div>
      </header>

      {/* Filters */}
      <div className="bg-surface-container rounded-xl p-6">
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <div className="relative">
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value as '' | LogLevel)}
              className="w-full engraved-input rounded-lg px-4 py-3 pr-10 text-sm text-on-surface appearance-none bg-surface-container-lowest cursor-pointer transition-all duration-200"
            >
              <option value="">All levels</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
            <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">
              expand_more
            </span>
          </div>

          <input
            value={jobId}
            onChange={(event) => setJobId(event.target.value)}
            placeholder="Job ID..."
            className="engraved-input rounded-lg px-4 py-3 text-sm text-on-surface"
          />

          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search..."
            className="engraved-input rounded-lg px-4 py-3 text-sm text-on-surface"
          />

          <input
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="engraved-input rounded-lg px-4 py-3 text-sm text-on-surface"
          />

          <input
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="engraved-input rounded-lg px-4 py-3 text-sm text-on-surface"
          />

          <label className="flex items-center gap-3 engraved-input rounded-lg px-4 py-3 text-sm text-on-surface-variant cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Auto refresh
          </label>
        </div>
      </div>

      {/* Logs List */}
      <div className="bg-surface-container rounded-xl p-2">
        <div className="space-y-2">
          {logs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-on-surface-variant text-center">No logs found.</p>
          ) : null}
          {logs.map((log) => (
            <details
              key={log.id}
              className="bg-surface-container-high rounded-lg px-4 py-3 hover:bg-surface-bright transition-colors"
            >
              <summary className="flex cursor-pointer flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                  <span
                    className={`badge ${
                      log.level === 'info'
                        ? 'badge-primary'
                        : log.level === 'warn'
                          ? 'badge-secondary'
                          : 'badge-error'
                    }`}
                  >
                    {log.level}
                  </span>
                  <span className="text-sm text-on-surface">{log.phase}</span>
                  <span className="text-sm text-on-surface-variant">{log.message}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-on-surface-variant">
                  {log.jobId ? (
                    <Link href={`/jobs?jobId=${log.jobId}`} className="text-primary hover:text-primary/70 font-mono">
                      #{log.jobId}
                    </Link>
                  ) : null}
                  <span className="font-mono">{new Date(log.timestamp).toLocaleString()}</span>
                </div>
              </summary>
              {log.details ? (
                <pre className="mt-4 overflow-x-auto rounded-lg bg-surface-container-lowest p-4 text-xs font-mono text-on-surface">
                  {JSON.stringify(log.details, null, 2)}
                </pre>
              ) : null}
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
