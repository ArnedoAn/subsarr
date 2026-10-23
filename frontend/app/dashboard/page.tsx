'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApiQuery } from '@/lib/use-api-query';
import type { BudgetStatus, LibraryScanStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type TierBlock = { promptTokens: number; completionTokens: number; totalTokens: number };
export interface DashboardStats {
  libraryItemCount: number | null;
  libraryScan: LibraryScanStatus;
  jobsByState: Record<string, number>;
  jobsSummary: { today: { completed: number; failed: number; cancelled: number; total: number }; week: { completed: number; failed: number; cancelled: number; total: number }; archiveTotal: number };
  jobsByDay: Array<{ date: string; completed: number; failed: number; cancelled: number }>;
  tokensByDay: Array<{ date: string; free: number; paid: number }>;
  tokenUsage: { free: TierBlock; paid: TierBlock; estimatedCostUsd: number };
  queue: { ok: boolean; jobCounts?: Record<string, number>; error?: string };
  memory: { heapUsed: number; heapTotal: number; rss: number };
  uptimeSeconds: number;
}
const SERIES = { completed: 'var(--success)', failed: 'var(--error)', cancelled: 'var(--warning)', free: 'var(--primary)', paid: 'var(--secondary)' };
const tooltipStyle = { background: 'var(--surface-container-high)', border: '1px solid var(--outline-variant)', borderRadius: 8, color: 'var(--on-surface)' };

export default function DashboardPage() {
  const stats = useApiQuery<DashboardStats>('/stats', { intervalMs: 30000 });
  const budget = useApiQuery<BudgetStatus>('/settings/budget', { intervalMs: 30000 });
  const [lastSuccess, setLastSuccess] = useState<number | null>(null);
  useEffect(() => { if (stats.data && !stats.error) setLastSuccess(Date.now()); }, [stats.data, stats.error]);
  const data = stats.data;
  const queue = data?.queue.jobCounts;
  return <section className="space-y-6">
    <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-bold text-on-surface">Overview</h1><p className="text-sm text-on-surface-variant">Library, translation outcomes and monthly budget</p></div><Button variant="secondary" onClick={() => { stats.refetch(); budget.refetch(); }}>Refresh overview</Button></header>
    <p role="status" className="text-xs text-on-surface-variant">{stats.error ? 'Statistics unavailable / stale' : stats.loading ? 'Loading statistics…' : stats.refreshing ? 'Refreshing statistics…' : 'Statistics updated'} · Last successful fetch: {lastSuccess ? new Date(lastSuccess).toLocaleString() : 'none yet'}</p>
    {stats.error && <div role="alert" className="rounded-xl border border-error/30 p-4 text-error"><p>{stats.error.message}</p><Button variant="secondary" onClick={stats.refetch}>Retry statistics</Button></div>}
    {!data && stats.loading && <div aria-busy="true" className="rounded-xl bg-surface-container p-8 text-center">Loading library and queue summaries…</div>}
    {data && <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Summary title="Indexed media" value={data.libraryItemCount == null ? 'Unknown' : data.libraryItemCount.toLocaleString()} subtitle={data.libraryScan.state === 'running' ? 'Scan in progress · open library' : 'Browse and filter the library'} href="/" />
        <Summary title="Needs attention" value={data.jobsSummary.week.failed.toLocaleString()} subtitle="Failed translations in the last 7 days · inspect and retry" href="/activity?tab=history&state=failed" />
        <Summary title="Queue" value={data.queue.ok ? String((queue?.waiting ?? 0) + (queue?.active ?? 0) + (queue?.delayed ?? 0) + (queue?.cancelling ?? 0)) : 'Unavailable'} subtitle={data.queue.ok ? `${queue?.active ?? 0} active · manage translations` : data.queue.error ?? 'Unable to read the queue'} href="/activity" />
        <Summary title="Completed today" value={String(data.jobsSummary.today.completed)} subtitle={`${data.jobsSummary.today.total} finished today · view history`} href="/activity?tab=history&state=completed" />
      </div>
      {data.libraryScan.lastError && <div role="alert" className="rounded-xl border border-warning/30 p-4"><p className="text-warning">Last scan failed: {data.libraryScan.lastError}</p><p className="text-sm text-on-surface-variant">Last successful scan: {data.libraryScan.lastSuccessAt ? new Date(data.libraryScan.lastSuccessAt).toLocaleString() : 'none yet'}. Existing inventory is retained.</p><Link href="/?status=failed" className="btn btn-ghost mt-2">Review library issues</Link></div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Chart title="Translation outcomes · last 30 days" data={data.jobsByDay} keys={['completed', 'failed', 'cancelled']} />
        <Chart title="Token usage · last 30 days" data={data.tokensByDay} keys={['free', 'paid']} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-outline-variant/25 bg-surface-container p-5"><h2 className="font-semibold">Queue availability</h2><p className={stats.error || !data.queue.ok ? 'text-error' : 'text-on-surface'}>{stats.error ? 'Unknown · showing stale data' : data.queue.ok ? 'Queue reachable' : `Unavailable: ${data.queue.error ?? 'connection failed'}`}</p>{data.queue.ok && <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">{Object.entries(queue ?? {}).map(([state, count]) => <div key={state}><dt className="text-on-surface-variant">{state}</dt><dd><Link className="underline" href={`/activity?tab=${['completed','failed','cancelled'].includes(state) ? 'history' : 'queue'}&state=${encodeURIComponent(state)}`}>{count}</Link></dd></div>)}</dl>}<Link className="btn btn-secondary mt-4" href="/activity?tab=logs&level=error">Inspect error logs</Link></div>
        <div className="rounded-xl border border-outline-variant/25 bg-surface-container p-5"><h2 className="font-semibold">Process</h2><dl className="mt-3 space-y-2 text-sm"><div className="flex justify-between"><dt>Uptime</dt><dd>{Math.floor(data.uptimeSeconds / 3600)}h {Math.floor(data.uptimeSeconds % 3600 / 60)}m</dd></div><div className="flex justify-between"><dt>Heap used / allocated</dt><dd>{(data.memory.heapUsed / 1048576).toFixed(1)} / {(data.memory.heapTotal / 1048576).toFixed(1)} MiB</dd></div><div className="flex justify-between"><dt>Resident memory</dt><dd>{(data.memory.rss / 1048576).toFixed(1)} MiB</dd></div></dl><Link className="btn btn-ghost mt-4" href="/?missingTarget=true">Find media missing target subtitles</Link></div>
      </div>
    </>}
    <section className="rounded-xl border border-outline-variant/25 bg-surface-container p-5 space-y-2"><h2 className="font-semibold">Monthly translation budget</h2>{budget.error && <div role="alert" className="text-error"><p>Budget unavailable: {budget.error.message}</p><Button variant="secondary" onClick={budget.refetch}>Retry budget</Button></div>}{!budget.data && budget.loading && <p aria-busy="true">Loading budget…</p>}{budget.data && <><p className="text-xl font-bold">${budget.data.spentUsd.toFixed(2)}{budget.data.budgetUsd != null ? ` / $${budget.data.budgetUsd.toFixed(2)}` : ' · no monthly cap'}</p><p className={budget.error ? 'text-on-surface-variant' : budget.data.level === 'exceeded' ? 'text-error' : budget.data.level === 'warning' ? 'text-warning' : 'text-on-surface-variant'}>{budget.error ? 'Last known budget · not current' : budget.data.level === 'exceeded' ? 'Budget reached. Automatic paid requests are blocked; manual requests require an explicit override.' : budget.data.level === 'warning' ? 'At least 80% of the monthly budget used.' : 'Usage includes provider attempts, including retries.'}</p>{budget.data.ratio != null && <progress aria-label="Monthly budget used" max={1} value={Math.min(1, budget.data.ratio)} className="w-full accent-primary" />}</>}<Link className="btn btn-ghost" href="/settings">Manage budget and pricing</Link></section>
  </section>;
}
function Summary({ title, value, subtitle, href }: { title: string; value: string; subtitle: string; href: string }) {
  return <Link href={href} className="rounded-xl border border-outline-variant/25 bg-surface-container p-4 hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"><h2 className="text-xs text-on-surface-variant uppercase tracking-wide">{title}</h2><p className="text-2xl font-bold mt-1">{value}</p><p className="text-xs text-on-surface-variant mt-2">{subtitle}</p></Link>;
}
function Chart({ title, data, keys }: { title: string; data: Array<{ date: string } & Partial<Record<keyof typeof SERIES, number>>>; keys: Array<keyof typeof SERIES> }) {
  return <section className="rounded-xl border border-outline-variant/25 bg-surface-container p-4"><h2 className="text-sm font-semibold mb-4">{title}</h2>{data.length === 0 ? <p className="p-8 text-center text-on-surface-variant">No data for this period.</p> : <div className="h-64" role="img" aria-label={title}><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}><CartesianGrid stroke="var(--outline-variant)" strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} tick={{ fill: 'var(--on-surface-variant)', fontSize: 10 }} interval={4} /><YAxis tick={{ fill: 'var(--on-surface-variant)', fontSize: 10 }} width={45} /><Tooltip contentStyle={tooltipStyle} /><Legend />{keys.map(key => <Bar key={key} dataKey={key} stackId="total" fill={SERIES[key]} />)}</BarChart></ResponsiveContainer></div>}<details className="mt-3 text-xs"><summary>View chart data</summary><div className="overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">{title}</caption><thead><tr><th>Date</th>{keys.map(key => <th key={key}>{key}</th>)}</tr></thead><tbody>{data.map(row => <tr key={row.date}><td>{row.date}</td>{keys.map(key => <td key={key}>{String(row[key] ?? 0)}</td>)}</tr>)}</tbody></table></div></details></section>;
}
