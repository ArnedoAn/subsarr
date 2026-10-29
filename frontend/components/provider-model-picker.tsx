'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import type { SettingsPayload, TranslationProvider } from '@/lib/types';
import { useApiQuery } from '@/lib/use-api-query';

import { PROVIDERS, isTranslationProvider, savedProviderModel } from '@/lib/provider-selection';
export { isTranslationProvider, savedProviderModel } from '@/lib/provider-selection';
export function useTranslationSelection() {
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [provider, setProvider] = useState<TranslationProvider>('openrouter');
  const [models, setModels] = useState<Partial<Record<TranslationProvider, string>>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void apiGet<SettingsPayload>('/settings', { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      setSettings(value); setProvider(value.defaultProvider);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load translation defaults'); });
    return () => controller.abort();
  }, []);
  return { settings, provider, setProvider, model: models[provider] ?? (settings ? savedProviderModel(settings, provider) : ''), setModel: (model: string) => setModels(previous => ({ ...previous, [provider]: model })), error };
}

interface ModelCatalog { models: Array<{ id: string; name: string }>; source: 'documented' | 'remote'; warning?: string }
const inputClass = 'w-full rounded-lg border border-outline-variant bg-surface-container px-3 py-2 text-on-surface';
export function ProviderModelPicker({ provider, model, onProviderChange, onModelChange, disabled = false, showProvider = true }: {
  provider: TranslationProvider; model: string; onProviderChange: (provider: TranslationProvider) => void; onModelChange: (model: string) => void; disabled?: boolean; showProvider?: boolean;
}) {
  const catalog = useApiQuery<ModelCatalog>(provider === 'opencode-go' ? '/settings/opencode-go/models' : null);
  return <div className="space-y-3">
    {showProvider && <label className="block text-sm">Provider<select className={`${inputClass} mt-1`} value={provider} disabled={disabled} onChange={event => { if (isTranslationProvider(event.target.value)) onProviderChange(event.target.value); }}>{PROVIDERS.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>}
    <label className="block text-sm">Model{provider === 'opencode-go' ? <select className={`${inputClass} mt-1`} value={model} disabled={disabled || !catalog.data} onChange={event => onModelChange(event.target.value)}><option value="">Use saved compatible model</option>{catalog.data?.models.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select> : <input className={`${inputClass} mt-1`} value={model} disabled={disabled} maxLength={128} placeholder="Use saved model" onChange={event => onModelChange(event.target.value)} />}</label>
    {provider === 'opencode-go' && catalog.data && <p className="text-xs text-on-surface-variant">Compatible model catalog source: {catalog.data.source === 'remote' ? 'OpenCode live catalog' : 'Documented fallback list'}.</p>}
    {provider === 'opencode-go' && <><p className="text-xs text-on-surface-variant">Subscription usage, not free tokens or pay-as-you-go pricing. Only documented OpenAI-compatible chat models are listed. Go is designed for coding traffic; subtitle-translation acceptance is unverified. Disable Extra Usage in the OpenCode Console to prevent additional charges. No automatic paid-provider fallback.</p>{catalog.data?.warning && <p role="status" className="text-xs text-warning">{catalog.data.warning}</p>}{catalog.error && <p role="alert" className="text-sm text-error">Model catalog unavailable: {catalog.error.message} <button type="button" className="underline" onClick={catalog.refetch}>Retry catalog</button></p>}{!catalog.data && !catalog.error && <p role="status" className="text-xs">Loading compatible models…</p>}</>}
  </div>;
}
