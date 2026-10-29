'use client';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiPost } from '@/lib/api';
import type { BatchEnqueueResultItem, MediaItemWithRuleStatus, TranslationProvider } from '@/lib/types';
import { Dialog } from '@/components/ui/dialog';
import { LanguageCombobox } from '@/components/language-combobox';
import { pushRecentLanguage } from '@/lib/recent-languages';
import { useBatchPreview, type BatchOptions } from '@/components/library/use-batch-preview';
import { BatchSelection, type BatchItemLabel } from '@/components/library/batch-selection';
import { ProviderModelPicker, savedProviderModel, useTranslationSelection } from '@/components/provider-model-picker';
import { INITIAL_QUALITY, TranslationQualityOptions } from '@/components/translation-quality-options';

export function BatchQueueModal({ open, onClose, itemIds, items = [], scopeLabel, initialSource, initialTarget, initialProvider, onEnqueued }: {
  open: boolean; onClose: () => void; itemIds: string[]; items?: MediaItemWithRuleStatus[]; scopeLabel: string;
  initialSource: string; initialTarget: string; initialProvider: TranslationProvider;
  onEnqueued?: (summary: { queued: number; failed: number; errors: string[] }) => void;
}) {
  const [sourceLanguage, setSource] = useState(initialSource);
  const [targetLanguage, setTarget] = useState(initialTarget);
  const [provider, setProvider] = useState(initialProvider);
  const defaults = useTranslationSelection();
  const [models, setModels] = useState<Partial<Record<TranslationProvider, string>>>({});
  const model = models[provider] ?? (defaults.settings ? savedProviderModel(defaults.settings, provider) : '');
  const [quality, setQuality] = useState(INITIAL_QUALITY);
  const [forceBypassRules, setForce] = useState(false);
  const [conflict, setConflict] = useState<'default' | 'replace' | 'alternate'>('default');
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [excludedReady, setExcludedReady] = useState<Record<string, boolean>>({});
  const [labelCache, setLabelCache] = useState<Record<string, BatchItemLabel>>({});
  const [enqueuing, setEnqueuing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [budgetBlocked, setBudgetBlocked] = useState(false);
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({});
  const [queuedCount, setQueuedCount] = useState(0);
  useEffect(() => {
    if (!open) return;
    setSource(initialSource); setTarget(initialTarget); setProvider(initialProvider); setForce(false); setConflict('default'); setExcluded({}); setExcludedReady({}); setSubmitted({}); setQueuedCount(0); setErrors([]); setBudgetBlocked(false);
    setLabelCache({});
    setModels({});
    setQuality(INITIAL_QUALITY);
  }, [open, itemIds, initialSource, initialTarget, initialProvider]);
  const ids = useMemo(() => [...new Set(itemIds)].filter(id => !excluded[id]), [itemIds, excluded]);
  const options = useMemo<BatchOptions>(() => ({ sourceLanguage, targetLanguage, provider, model: model.trim() || undefined, ...quality, forceBypassRules, targetConflictResolution: conflict === 'default' ? undefined : conflict }), [sourceLanguage, targetLanguage, provider, model, quality, forceBypassRules, conflict]);
  useEffect(() => { setBudgetBlocked(false); }, [options, ids]);
  const preview = useBatchPreview(open, ids, options);
  useEffect(() => {
    if (!preview.rows.length) return;
    setLabelCache(previous => {
      const next = { ...previous };
      for (const row of preview.rows) if (row.name && row.path) next[row.mediaItemId] = { name: row.name, path: row.path };
      return next;
    });
  }, [preview.rows]);
  const byId = useMemo(() => {
    const labels = new Map(Object.entries(labelCache));
    for (const item of items) if (!labels.has(item.id)) labels.set(item.id, { name: item.name, path: item.path });
    return labels;
  }, [labelCache, items]);
  const ready = preview.rows.filter(row => row.status === 'ready' && row.sourceTrackIndex !== undefined && !excludedReady[row.mediaItemId] && !submitted[row.mediaItemId]);
  const already = preview.rows.filter(row => row.alreadyTranslated);
  const skipped = preview.rows.filter(row => row.status !== 'ready' && !row.alreadyTranslated);
  async function enqueue(allowBudgetOverride = false) {
    setEnqueuing(true); setErrors([]); setBudgetBlocked(false);
    let queued = 0; const failures: string[] = [];
    try {
      for (let offset = 0; offset < ready.length; offset += 500) {
        const chunk = ready.slice(offset, offset + 500);
        const results = await apiPost<BatchEnqueueResultItem[]>('/jobs/batch', { ...options, allowBudgetOverride, triggeredBy: 'batch', items: chunk.map(row => ({ mediaItemId: row.mediaItemId, sourceTrackIndex: row.sourceTrackIndex })) });
        const returned = new Set(results.map(row => row.mediaItemId));
        for (const row of results) {
          if (row.error) failures.push(`${byId.get(row.mediaItemId)?.name ?? row.mediaItemId}: ${row.error}`);
          else { queued++; setSubmitted(previous => ({ ...previous, [row.mediaItemId]: true })); }
        }
        for (const row of chunk) if (!returned.has(row.mediaItemId)) failures.push(`${row.mediaItemId}: no enqueue result returned`);
      }
      if (queued) { pushRecentLanguage(sourceLanguage); pushRecentLanguage(targetLanguage); }
      if (!failures.length) onClose();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && reason.code === 'TRANSLATION_BUDGET_EXCEEDED') setBudgetBlocked(true);
      else failures.push(`${ready.length - queued} files were not confirmed queued. ${reason instanceof Error ? reason.message : 'Enqueue request failed'}. Completed chunks are retained; retry only the remaining eligible files.`);
    } finally {
      setQueuedCount(previous => previous + queued); setErrors(failures); setEnqueuing(false);
      if (queued || failures.length) onEnqueued?.({ queued, failed: ready.length - queued, errors: failures });
    }
  }
  return <Dialog open={open} onClose={() => { if (!enqueuing) onClose(); }} title="Review translation batch" className="w-full max-w-4xl">
    <div className="space-y-5">
      <p className="text-sm">Scope: <strong>{scopeLabel}</strong> · {itemIds.length} files across all pages. Requests are processed sequentially in chunks of at most 500.</p>
      <BatchSelection ids={itemIds} labels={byId} excluded={excluded} onChange={setExcluded} busy={enqueuing} />
      <fieldset disabled={enqueuing} className="space-y-3"><legend className="font-semibold">Translation options</legend><div className="grid sm:grid-cols-2 gap-3"><div><label className="field-label">Source language</label><LanguageCombobox value={sourceLanguage} onChange={setSource} /></div><div><label className="field-label">Target language</label><LanguageCombobox value={targetLanguage} onChange={value => { setTarget(value); setConflict('default'); }} /></div></div>
        <ProviderModelPicker provider={provider} model={model} onProviderChange={setProvider} onModelChange={value => setModels(previous => ({ ...previous, [provider]: value }))} disabled={!defaults.settings} />
        {defaults.error && <p role="alert" className="text-error">{defaults.error}</p>}
        <TranslationQualityOptions value={quality} onChange={setQuality} />
        <label className="block">Existing target <select className="engraved-input p-2" value={conflict} onChange={event => setConflict(event.target.value as typeof conflict)}><option value="default">Respect rules</option><option value="replace">Replace existing subtitle</option><option value="alternate">Create secondary file (.lang.2.ext)</option></select></label>
        <label className="flex gap-2"><input type="checkbox" checked={forceBypassRules} onChange={event => setForce(event.target.checked)} />Force bypass rules (does not override budget)</label>
      </fieldset>
      <section className="space-y-2" aria-busy={preview.loading}><h3 className="font-semibold">Server preview</h3><p className="text-sm">Estimated cost: unavailable until subtitle content and actual provider usage are known. No estimate is assumed.</p>
        {preview.loading ? <p role="status">Analyzing {preview.processed} / {ids.length}…</p> : <p>{ready.length} eligible · {skipped.length} other skipped/unavailable · {already.length} already translated · {queuedCount} queued</p>}
        {preview.error && <p role="alert" className="text-error">{preview.error}</p>}
        <div className="flex gap-3 text-sm"><button disabled={enqueuing} onClick={() => setExcludedReady({})}>Select all eligible</button><button disabled={enqueuing} onClick={() => setExcludedReady(Object.fromEntries(preview.rows.map(row => [row.mediaItemId, true])))}>Deselect eligible</button></div>
        <div className="max-h-64 overflow-auto space-y-1">{preview.rows.map(row => <label key={row.mediaItemId} className="flex gap-2 p-2 bg-surface-container rounded text-sm"><input type="checkbox" disabled={row.status !== 'ready' || enqueuing || submitted[row.mediaItemId]} checked={row.status === 'ready' && !excludedReady[row.mediaItemId] && !submitted[row.mediaItemId]} onChange={event => setExcludedReady(previous => ({ ...previous, [row.mediaItemId]: !event.target.checked }))} /><span className="break-all">{byId.get(row.mediaItemId)?.name ?? row.mediaItemId} — {submitted[row.mediaItemId] ? 'Queued' : row.status === 'ready' ? `Eligible, track #${row.sourceTrackIndex}` : row.reason ?? row.status}</span></label>)}</div>
      </section>
      {!!errors.length && <div role="alert" className="text-error">{errors.map((error, index) => <p key={index}>{error}</p>)}</div>}
      {budgetBlocked && <section className="border border-warning p-3 rounded space-y-2" role="alert"><p>Monthly budget reached. Only an explicit manual override will enqueue the remaining eligible files. Already queued chunks will not be repeated.</p><button className="btn btn-secondary" disabled={enqueuing} onClick={() => void enqueue(true)}>I approve exceeding the budget — queue remaining</button><button className="btn btn-ghost" onClick={() => setBudgetBlocked(false)}>Do not override</button></section>}
      <div className="flex justify-end gap-3"><button className="btn btn-secondary" disabled={enqueuing} onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={enqueuing || !defaults.settings || preview.loading || !!preview.error || !ready.length || budgetBlocked} onClick={() => void enqueue()}>{enqueuing ? 'Queueing…' : `Queue ${ready.length} eligible`}</button></div>
    </div>
  </Dialog>;
}
