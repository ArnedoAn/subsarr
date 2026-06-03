'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Toggle } from '@/components/ui/toggle';
import { MobilePageHeader } from '@/components/mobile/page-header';

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  id: string;
  jobId?: string;
  level: LogLevel;
  phase: string;
  message: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

const ITEMS_PER_PAGE = 50;

type LogsApiResponse = {
  items: LogEntry[];
  total: number;
  nextCursor: string | null;
};

export default function LogsPage() {
  const [logs, setLogs]           = useState<LogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [level, setLevel]         = useState<'' | LogLevel>('');
  const [jobId, setJobId]         = useState('');
  const [search, setSearch]       = useState('');
  const [from, setFrom]           = useState('');
  const [to, setTo]               = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading]     = useState(true);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [expanded, setExpanded]   = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (level) params.set('level', level);
    if (jobId.trim()) params.set('jobId', jobId.trim());
    if (search.trim()) params.set('search', search.trim());
    if (from) params.set('from', new Date(from).toISOString());
    if (to) params.set('to', new Date(to).toISOString());
    params.set('limit', '500');
    try {
      const res = await apiGet<LogsApiResponse>(`/jobs/logs/all?${params.toString()}`);
      setLogs(res.items);
      setTotalCount(res.total);
      setCurrentPage(1);
    } finally {
      setLoading(false);
    }
  }, [level, jobId, search, from, to]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const incomingJobId = params.get('jobId');
    if (incomingJobId) setJobId(incomingJobId);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  /* Active filter chips */
  const activeFilters: { label: string; key: string }[] = [
    ...(level   ? [{ label: `Level: ${level.toUpperCase()}`, key: 'level'  }] : []),
    ...(jobId   ? [{ label: `Job: #${jobId}`,                key: 'jobId'  }] : []),
    ...(search  ? [{ label: `Search: "${search}"`,           key: 'search' }] : []),
    ...(from    ? [{ label: `From: ${from}`,                 key: 'from'   }] : []),
    ...(to      ? [{ label: `To: ${to}`,                     key: 'to'     }] : []),
  ];

  const removeFilter = (key: string) => {
    if (key === 'level')  setLevel('');
    if (key === 'jobId')  setJobId('');
    if (key === 'search') setSearch('');
    if (key === 'from')   setFrom('');
    if (key === 'to')     setTo('');
  };

  const totalPages  = Math.max(1, Math.ceil(logs.length / ITEMS_PER_PAGE));
  const paginated   = logs.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  return (
    <section className="space-y-6">
      <MobilePageHeader
        title="Logs"
        subtitle="System event history and diagnostics"
        actions={
          <button
            type="button"
            onClick={() => setMobileFiltersOpen(v => !v)}
            className="btn btn-ghost btn-icon"
            aria-label="Toggle filters"
          >
            <span className="material-symbols-outlined text-[18px]">
              {mobileFiltersOpen ? 'expand_less' : 'filter_list'}
            </span>
          </button>
        }
      />

      <div className="hidden md:block">
        <h1 className="text-2xl font-bold text-on-surface tracking-tight">Logs</h1>
        <p className="text-sm text-on-surface-variant mt-0.5">
          System event history and diagnostics
          {totalCount > 0 && (
            <span className="ml-2 text-xs opacity-80">· {totalCount} entradas (coincidencias)</span>
          )}
        </p>
      </div>

      <div className="md:hidden bg-surface-container rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setMobileFiltersOpen(v => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
        >
          <span className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">filter_list</span>
            Filters
          </span>
          <span className="material-symbols-outlined text-[16px]">
            {mobileFiltersOpen ? 'expand_less' : 'expand_more'}
          </span>
        </button>
        {mobileFiltersOpen && (
          <div className="p-3 border-t border-outline-variant/15 space-y-2">
            <div className="grid grid-cols-1 gap-2">
              <div className="relative">
                <select
                  value={level}
                  onChange={e => setLevel(e.target.value as '' | LogLevel)}
                  className="w-full engraved-input text-sm px-3 py-2 pr-8 appearance-none cursor-pointer"
                >
                  <option value="">All levels</option>
                  <option value="info">INFO</option>
                  <option value="warn">WARN</option>
                  <option value="error">ERROR</option>
                </select>
                <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant pointer-events-none">expand_more</span>
              </div>
              <input
                value={jobId}
                onChange={e => setJobId(e.target.value)}
                placeholder="Job ID…"
                className="engraved-input text-sm px-3 py-2"
              />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search messages…"
                className="engraved-input text-sm px-3 py-2"
              />
              <input
                type="datetime-local"
                value={from}
                onChange={e => setFrom(e.target.value)}
                className="engraved-input text-sm px-3 py-2"
              />
              <input
                type="datetime-local"
                value={to}
                onChange={e => setTo(e.target.value)}
                className="engraved-input text-sm px-3 py-2"
              />
              <div className="flex items-center justify-between gap-2">
                <Toggle checked={autoRefresh} onChange={setAutoRefresh} label="Auto-refresh" />
                <Button variant="secondary" size="sm" onClick={() => void load()} iconLeft="refresh">
                  Apply
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="hidden md:block bg-surface-container rounded-lg p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
          {/* Level */}
          <div className="relative">
            <select
              value={level}
              onChange={e => setLevel(e.target.value as '' | LogLevel)}
              className="w-full engraved-input text-sm px-3 py-2 pr-8 appearance-none cursor-pointer"
            >
              <option value="">All levels</option>
              <option value="info">INFO</option>
              <option value="warn">WARN</option>
              <option value="error">ERROR</option>
            </select>
            <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant pointer-events-none">expand_more</span>
          </div>

          {/* Job ID */}
          <input
            value={jobId}
            onChange={e => setJobId(e.target.value)}
            placeholder="Job ID…"
            className="engraved-input text-sm px-3 py-2"
          />

          {/* Search */}
          <div className="relative sm:col-span-2 lg:col-span-1">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search messages…"
              className="w-full engraved-input text-sm px-3 py-2 pl-8"
            />
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant pointer-events-none">search</span>
          </div>

          {/* From */}
          <input
            type="datetime-local"
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="engraved-input text-sm px-3 py-2"
          />

          {/* To */}
          <input
            type="datetime-local"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="engraved-input text-sm px-3 py-2"
          />

          {/* Auto-refresh + Apply */}
          <div className="flex items-center gap-2 justify-between sm:col-span-2 lg:col-span-1">
            <Toggle
              checked={autoRefresh}
              onChange={setAutoRefresh}
              label="Auto-refresh"
            />
            <Button variant="secondary" size="sm" onClick={() => void load()} iconLeft="refresh">
              Apply
            </Button>
          </div>
        </div>

        {/* Active filter chips */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {activeFilters.map(f => (
              <button
                key={f.key}
                onClick={() => removeFilter(f.key)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
              >
                {f.label}
                <span className="material-symbols-outlined text-[13px]">close</span>
              </button>
            ))}
            <button
              onClick={() => { setLevel(''); setJobId(''); setSearch(''); setFrom(''); setTo(''); }}
              className="text-xs text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[13px]">close</span>
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Log List */}
      <div className="bg-surface-container rounded-lg overflow-hidden">
        {loading && (
          <div className="px-4 py-8 text-sm text-on-surface-variant text-center">
            Loading logs…
          </div>
        )}

        {!loading && paginated.length === 0 && (
          <EmptyState
            icon="terminal"
            title="No logs found"
            description={activeFilters.length > 0 ? 'Try adjusting your filters' : 'Logs will appear here once jobs are processed'}
          />
        )}

        {!loading && paginated.length > 0 && (
          <div className="divide-y divide-outline-variant/10">
            {paginated.map(log => (
              <div
                key={log.id}
                className="bg-surface-container hover:bg-surface-container-high transition-colors"
              >
                <button
                  onClick={() => setExpanded(prev => ({ ...prev, [log.id]: !prev[log.id] }))}
                  className="w-full flex flex-col md:flex-row md:items-center gap-2 px-4 py-3 text-left"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Badge
                      variant={log.level === 'info' ? 'primary' : log.level === 'warn' ? 'warning' : 'error'}
                    >
                      {log.level}
                    </Badge>
                    <span className="text-xs font-medium text-on-surface-variant flex-shrink-0">{log.phase}</span>
                    <span className="text-sm text-on-surface truncate">{log.message}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-on-surface-variant flex-shrink-0">
                    {log.jobId && (
                      <Link
                        href={`/jobs?jobId=${log.jobId}`}
                        onClick={e => e.stopPropagation()}
                        className="text-primary hover:underline font-mono"
                      >
                        #{log.jobId.slice(0, 8)}
                      </Link>
                    )}
                    <span className="font-mono">{new Date(log.timestamp).toLocaleString()}</span>
                    {log.details && (
                      <span className="material-symbols-outlined text-[16px] transition-transform" style={{ transform: expanded[log.id] ? 'rotate(180deg)' : undefined }}>
                        expand_more
                      </span>
                    )}
                  </div>
                </button>
                {log.details && expanded[log.id] && (
                  <div className="px-4 pb-3">
                    <pre className="overflow-x-auto rounded bg-surface-container-lowest p-3 text-xs font-mono text-on-surface leading-relaxed custom-scrollbar">
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {!loading && logs.length > ITEMS_PER_PAGE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-outline-variant/15 bg-surface-container-low">
            <span className="text-xs text-on-surface-variant">
              {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, logs.length)} de {logs.length}
              {totalCount > logs.length ? ` (total API ${totalCount})` : ''}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="btn btn-ghost btn-icon btn-xs"
              >
                <span className="material-symbols-outlined text-[16px]">chevron_left</span>
              </button>
              <span className="text-xs font-mono text-on-surface-variant px-2">{currentPage} / {totalPages}</span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="btn btn-ghost btn-icon btn-xs"
              >
                <span className="material-symbols-outlined text-[16px]">chevron_right</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
