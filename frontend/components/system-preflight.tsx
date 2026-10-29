'use client';

import { useEffect } from 'react';
import { useToast } from '@/components/ui/toast';
import { useApiQuery } from '@/lib/use-api-query';
import { diagnosticText } from '@/lib/diagnostics';
import type { PreflightReport } from '@/lib/types';

const statusLabel = { ok: 'Ready', warning: 'Needs attention', error: 'Unavailable' };

/** Read-only checks: never reveals credentials or triggers migrations/provider requests. */
export function SystemPreflight() {
  const { data, error, loading, refreshing, refetch } = useApiQuery<PreflightReport>('/system/preflight');
  const { error: showError } = useToast();
  useEffect(() => {
    if (error) showError(`Preflight checks failed: ${diagnosticText(error.message)}`);
  }, [error, showError]);
  return <section className="rounded-lg bg-surface-container p-4 space-y-4" aria-label="System preflight" aria-busy={loading || refreshing}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold">System preflight</h2><p className="text-sm text-on-surface-variant">Local readiness checks only. No provider requests or migrations are run.</p></div>
      <button type="button" className="btn btn-secondary btn-sm" disabled={loading || refreshing} onClick={refetch}>{loading || refreshing ? 'Checking…' : error ? 'Retry checks' : 'Refresh checks'}</button>
    </div>
    {loading && <p role="status">Checking system readiness…</p>}
    {error && <p role="alert" className="text-error">Unable to load preflight checks. Retry to check the current status.</p>}
    {data && <>
      <p role="status">{statusLabel[data.status]} · Subsarr {diagnosticText(data.app.version)}{error ? ' · Showing previous results' : ''}</p>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div><dt className="font-medium">Data directory</dt><dd className="text-sm break-all">{diagnosticText(data.data.path)} · {data.data.available ? 'Available' : 'Unavailable'} · Read: {data.data.readable ? 'yes' : 'no'} · Write: {data.data.writable ? 'yes' : 'no'}</dd>{data.data.error && <dd className="text-sm text-error">{diagnosticText(data.data.error)}</dd>}</div>
        <div><dt className="font-medium">Database</dt><dd className="text-sm">{data.database.accessible ? 'Accessible' : 'Unavailable'} · Migrations: {data.database.migrationsPending === null ? 'unknown' : data.database.migrationsPending ? 'pending; restart/upgrade required' : 'up to date'}</dd>{data.database.error && <dd className="text-sm text-error">{diagnosticText(data.database.error)}</dd>}</div>
        <div><dt className="font-medium">Settings encryption key</dt><dd className="text-sm">{statusLabel[data.secretKey.status]} · {data.secretKey.available ? 'Available' : 'Missing'} · Source: {data.secretKey.source === 'environment' ? 'environment' : 'key file'}</dd>{data.secretKey.error && <dd className="text-sm text-error">{diagnosticText(data.secretKey.error)}</dd>}</div>
        <div><dt className="font-medium">Redis</dt><dd className="text-sm">{data.redis.ready ? 'Ready' : 'Unavailable'}</dd>{data.redis.error && <dd className="text-sm text-error">{diagnosticText(data.redis.error)}</dd>}</div>
        <div className="sm:col-span-2"><dt className="font-medium">Provider defaults</dt><dd className="text-sm">{statusLabel[data.providers.status]} · Provider: {diagnosticText(data.providers.defaultProvider ?? 'not configured')} · Model: {diagnosticText(data.providers.defaultModel ?? 'not configured')}</dd>
          <dd className="text-sm">OpenRouter key: {data.providers.keys.openrouter ? 'configured' : 'missing'} · DeepSeek key: {data.providers.keys.deepseek ? 'configured' : 'missing'} · OpenCode Go key: {data.providers.keys['opencode-go'] ? 'configured' : 'missing'}</dd>
          {data.providers.error && <dd className="text-sm text-error">{diagnosticText(data.providers.error)}</dd>}
        </div>
      </dl>
      <div className="space-y-2"><h3 className="font-medium">Media roots</h3><p className="text-sm text-on-surface-variant">Environment-allowed roots and saved library selections are checked independently. Selections outside allowed roots need repair in Settings.</p>
        {data.roots.length === 0 && <p className="text-sm">No media roots configured.</p>}
        <ul className="space-y-2">{data.roots.map((root, index) => <li key={`${root.path}-${index}`} className="rounded border border-outline-variant p-3 text-sm">
          <p className="break-all font-medium">{diagnosticText(root.path)}</p><p>{root.selected ? 'Selected' : 'Not selected'} · {root.allowed ? 'Allowed' : 'Outside allowed roots — repair selection'} · {root.available ? 'Available' : 'Unavailable'} · Read: {root.readable ? 'yes' : 'no'} · Write: {root.writable ? 'yes' : 'no'}</p>
          {root.error && <p className="text-error">{diagnosticText(root.error)}</p>}
        </li>)}</ul>
      </div>
      {data.warnings.length > 0 && <ul className="text-sm text-error space-y-1" aria-label="Preflight warnings">{data.warnings.map((warning, index) => <li key={index}>{diagnosticText(warning)}</li>)}</ul>}
    </>}
  </section>;
}
