'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '@/lib/api';
import { type LibraryScanStatus } from '@/lib/types';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MobilePageHeader } from '@/components/mobile/page-header';

type TierBlock = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type DashboardStats = {
  libraryItemCount: number | null;
  libraryScan: LibraryScanStatus;
  jobsByState: Record<string, number>;
  jobsSummary: {
    today: { completed: number; failed: number; cancelled: number; total: number };
    week: { completed: number; failed: number; cancelled: number; total: number };
    archiveTotal: number;
  };
  jobsByDay: Array<{
    date: string;
    completed: number;
    failed: number;
    cancelled: number;
  }>;
  tokensByDay: Array<{ date: string; free: number; paid: number }>;
  tokenUsage: {
    free: TierBlock;
    paid: TierBlock;
    deepSeekEstimatedCostUsd: number;
  };
  queue: {
    ok: boolean;
    jobCounts?: Record<string, number>;
    error?: string;
  };
  memory: { heapUsed: number; heapTotal: number; rss: number };
  uptimeSeconds: number;
};

const CHART_AXIS = '#737373';
const CHART_GRID = '#2a2a2a';
const COLORS = {
  completed: '#4ade80',
  failed: '#ec7c8a',
  cancelled: '#fbbf24',
  free: '#818cf8',
  paid: '#34d399',
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KiB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MiB`;
  return `${(mb / 1024).toFixed(2)} GiB`;
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function shortDate(iso: string): string {
  return iso.slice(5);
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardStats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await apiGet<DashboardStats>('/stats');
        if (!cancelled) {
          setData(s);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : 'Error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const queuePie = useMemo(() => {
    if (!data?.queue.ok || !data.queue.jobCounts) return [];
    return Object.entries(data.queue.jobCounts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }));
  }, [data]);

  const pieColors = ['#818cf8', '#34d399', '#fbbf24', '#ec7c8a', '#94a3b8', '#c084fc'];

  const jobsChartData = useMemo(
    () =>
      (data?.jobsByDay ?? []).map((r) => ({
        ...r,
        label: shortDate(r.date),
      })),
    [data],
  );

  const tokensChartData = useMemo(
    () =>
      (data?.tokensByDay ?? []).map((r) => ({
        ...r,
        label: shortDate(r.date),
      })),
    [data],
  );

  if (err) {
    return (
      <div className="rounded-xl border border-error/30 bg-error/8 px-4 py-3 text-sm text-error">
        {err}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-24 text-on-surface-variant text-sm">
        Cargando estadísticas…
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <MobilePageHeader title="Dashboard" subtitle="KPIs, job trends, token usage, and queue health." />

      <div className="hidden md:block">
        <h1 className="text-2xl font-bold text-on-surface tracking-tight">Dashboard</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          KPIs, tendencias de jobs y tokens, y estado de la cola.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          title="Biblioteca"
          value={data.libraryItemCount == null ? 'N/A' : String(data.libraryItemCount)}
          subtitle={
            data.libraryScan.state === 'running'
              ? 'escaneo en progreso'
              : 'items indexados'
          }
        />
        <Kpi
          title="Jobs hoy"
          value={String(data.jobsSummary.today.total)}
          subtitle={`${data.jobsSummary.today.completed} ok · ${data.jobsSummary.today.failed} fallos`}
        />
        <Kpi
          title="Jobs (7 días)"
          value={String(data.jobsSummary.week.total)}
          subtitle={`${data.jobsSummary.week.completed} completados`}
        />
        <Kpi
          title="Archivo jobs"
          value={String(data.jobsSummary.archiveTotal)}
          subtitle="snapshots totales"
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          title="Tokens free"
          value={formatTokens(data.tokenUsage.free.totalTokens)}
          subtitle={`prompt ${formatTokens(data.tokenUsage.free.promptTokens)}`}
        />
        <Kpi
          title="Tokens paid"
          value={formatTokens(data.tokenUsage.paid.totalTokens)}
          subtitle={`completion ${formatTokens(data.tokenUsage.paid.completionTokens)}`}
        />
        <Kpi
          title="Coste DeepSeek (est.)"
          value={`$${data.tokenUsage.deepSeekEstimatedCostUsd.toFixed(4)}`}
          subtitle="acumulado paid tier"
        />
        <Kpi
          title="Estados archivo"
          value={String(
            (data.jobsByState.completed ?? 0) +
              (data.jobsByState.failed ?? 0) +
              (data.jobsByState.cancelled ?? 0),
          )}
          subtitle={`ok ${data.jobsByState.completed ?? 0} · fallo ${data.jobsByState.failed ?? 0}`}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Jobs por día (30 días)">
          <div className="h-[220px] sm:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
            <BarChart data={jobsChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis dataKey="label" tick={{ fill: CHART_AXIS, fontSize: 10 }} interval={4} />
              <YAxis tick={{ fill: CHART_AXIS, fontSize: 11 }} width={32} />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface-container-high)',
                  border: '1px solid var(--outline-variant)',
                  borderRadius: 8,
                }}
                labelStyle={{ color: 'var(--on-surface)' }}
              />
              <Legend />
              <Bar dataKey="completed" stackId="a" fill={COLORS.completed} name="Completados" />
              <Bar dataKey="failed" stackId="a" fill={COLORS.failed} name="Fallidos" />
              <Bar dataKey="cancelled" stackId="a" fill={COLORS.cancelled} name="Cancelados" />
            </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Tokens por día — free vs paid">
          <div className="h-[220px] sm:h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
            <BarChart data={tokensChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis dataKey="label" tick={{ fill: CHART_AXIS, fontSize: 10 }} interval={4} />
              <YAxis tick={{ fill: CHART_AXIS, fontSize: 11 }} width={40} />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface-container-high)',
                  border: '1px solid var(--outline-variant)',
                  borderRadius: 8,
                }}
              />
              <Legend />
              <Bar dataKey="free" stackId="t" fill={COLORS.free} name="Free" />
              <Bar dataKey="paid" stackId="t" fill={COLORS.paid} name="Paid" />
            </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Cola Bull (Redis)">
          {data.queue.ok && queuePie.length > 0 ? (
            <div className="h-[220px] sm:h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={queuePie}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={88}
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {queuePie.map((_, i) => (
                    <Cell key={i} fill={pieColors[i % pieColors.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface-container-high)',
                    border: '1px solid var(--outline-variant)',
                    borderRadius: 8,
                  }}
                />
              </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[260px] flex flex-col items-center justify-center text-sm text-on-surface-variant px-4 text-center">
              {data.queue.ok ? (
                <span>Cola vacía (sin jobs pendientes).</span>
              ) : (
                <span className="text-warning">Cola no disponible: {data.queue.error}</span>
              )}
            </div>
          )}
        </ChartCard>

        <div className="rounded-xl border border-outline-variant/25 bg-surface-container-low p-5">
          <h3 className="text-sm font-semibold text-on-surface mb-4">Salud del proceso</h3>
          <ul className="space-y-3 text-sm">
            <li className="flex justify-between gap-4">
              <span className="text-on-surface-variant">Redis / cola</span>
              <span className={data.queue.ok ? 'text-success font-medium' : 'text-error font-medium'}>
                {data.queue.ok ? 'OK' : 'Error'}
              </span>
            </li>
            <li className="flex justify-between gap-4">
              <span className="text-on-surface-variant">Uptime</span>
              <span className="text-on-surface font-mono">{formatUptime(data.uptimeSeconds)}</span>
            </li>
            <li className="flex justify-between gap-4">
              <span className="text-on-surface-variant">Heap usado</span>
              <span className="text-on-surface font-mono">{formatBytes(data.memory.heapUsed)}</span>
            </li>
            <li className="flex justify-between gap-4">
              <span className="text-on-surface-variant">Heap total</span>
              <span className="text-on-surface font-mono">{formatBytes(data.memory.heapTotal)}</span>
            </li>
            <li className="flex justify-between gap-4">
              <span className="text-on-surface-variant">RSS</span>
              <span className="text-on-surface font-mono">{formatBytes(data.memory.rss)}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function Kpi({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-xl border border-outline-variant/25 bg-surface-container-low p-4">
      <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wide">{title}</p>
      <p className="text-2xl font-bold text-on-surface mt-1 tabular-nums">{value}</p>
      <p className="text-xs text-on-surface-variant mt-1">{subtitle}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-outline-variant/25 bg-surface-container-low p-5">
      <h3 className="text-sm font-semibold text-on-surface mb-4">{title}</h3>
      {children}
    </div>
  );
}
