'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPut } from '@/lib/api';
import type { SettingsPayload, TranslationProvider } from '@/lib/types';
import { ProviderModelPicker, savedProviderModel } from '@/components/provider-model-picker';
import { LanguageCombobox } from '@/components/language-combobox';
import { PathBrowser } from '@/components/path-browser';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

interface Profile {
  id: string;
  name: string;
  pathPrefix: string;
  sourceLanguage: string;
  targetLanguage: string;
  provider?: TranslationProvider;
  model?: string;
}
interface ProfileDraft extends Profile { models: Partial<Record<TranslationProvider, string>> }
const draft = (profile: Profile): ProfileDraft => ({ ...profile, models: profile.provider && profile.model ? { [profile.provider]: profile.model } : {} });
function createId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function TranslationProfiles({ settings, settingsDirty }: { settings: SettingsPayload; settingsDirty: boolean }) {
  const toast = useToast();
  const [profiles, setProfiles] = useState<ProfileDraft[]>([]);
  const [baseline, setBaseline] = useState('[]');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void apiGet<{ profiles: Profile[] }>('/profiles', { signal: controller.signal }).then(response => {
      if (controller.signal.aborted) return;
      const next = response.profiles.map(draft); setProfiles(next); setBaseline(JSON.stringify(next));
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load profiles'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [generation]);
  const update = (id: string, change: Partial<ProfileDraft>) => setProfiles(previous => previous.map(profile => profile.id === id ? { ...profile, ...change } : profile));
  async function save() {
    setBusy(true);
    try {
      const response = await apiPut<{ profiles: Profile[] }>('/profiles', { profiles: profiles.map(profile => ({ id: profile.id, name: profile.name.trim(), pathPrefix: profile.pathPrefix.trim(), sourceLanguage: profile.sourceLanguage, targetLanguage: profile.targetLanguage, ...(profile.provider ? { provider: profile.provider, ...(profile.models[profile.provider]?.trim() ? { model: profile.models[profile.provider]!.trim() } : {}) } : {}) })) });
      const next = response.profiles.map(draft); setProfiles(next); setBaseline(JSON.stringify(next)); toast.success('Translation profiles saved');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Unable to save profiles'); }
    finally { setBusy(false); }
  }
  const dirty = JSON.stringify(profiles) !== baseline;
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download') || anchor.target === '_blank') return;
      const url = new URL(anchor.href, location.href);
      if (url.pathname === location.pathname && url.search === location.search) return;
      if (!window.confirm('You have unsaved translation profiles. Leave without saving?')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', beforeUnload); document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', click, true); };
  }, [dirty]);
  return <section className="rounded-lg bg-surface-container p-4 sm:p-6 space-y-4" aria-label="Translation profiles">
    <h2 className="font-semibold">Translation profiles</h2>
    <p className="text-xs text-on-surface-variant">The longest matching path prefix chooses a profile for automatic translations. Explicit operation choices override profiles; otherwise the saved global provider and its model apply. Save settings before editing profiles. Profile changes affect future jobs only.</p>
    {settingsDirty && <p role="status" className="text-sm text-warning">Save or discard settings changes before saving profiles.</p>}
    {loading ? <p role="status">Loading profiles…</p> : error ? <div role="alert"><p className="text-error">{error}</p><Button type="button" onClick={() => setGeneration(value => value + 1)}>Retry profiles</Button></div> : <>
      <fieldset disabled={busy || settingsDirty} className="space-y-4">
        {profiles.map(profile => <div key={profile.id} className="space-y-3 rounded-lg border border-outline-variant p-3">
          <label className="block text-sm">Profile name<input className="engraved-input mt-1 w-full p-2" maxLength={200} value={profile.name} onChange={event => update(profile.id, { name: event.target.value })} /></label>
          <PathBrowser value={profile.pathPrefix} onChange={pathPrefix => update(profile.id, { pathPrefix })} placeholder="Matching media directory" />
          <div className="grid sm:grid-cols-2 gap-3"><LanguageCombobox ariaLabel="Profile source language" value={profile.sourceLanguage} onChange={sourceLanguage => update(profile.id, { sourceLanguage })} /><LanguageCombobox ariaLabel="Profile target language" value={profile.targetLanguage} onChange={targetLanguage => update(profile.id, { targetLanguage })} /></div>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={profile.provider === undefined} onChange={event => update(profile.id, { provider: event.target.checked ? undefined : settings.defaultProvider })} />Use global default provider and model</label>
          {profile.provider && <ProviderModelPicker provider={profile.provider} model={profile.models[profile.provider] ?? ''} onProviderChange={provider => update(profile.id, { provider })} onModelChange={model => update(profile.id, { models: { ...profile.models, [profile.provider!]: model } })} />}
          {profile.provider && <p className="text-xs text-on-surface-variant">An empty model uses this provider’s saved model: {savedProviderModel(settings, profile.provider)}.</p>}
          <Button type="button" variant="danger" size="sm" onClick={() => setProfiles(previous => previous.filter(value => value.id !== profile.id))}>Remove profile</Button>
        </div>)}
        <Button type="button" disabled={profiles.length >= 500} onClick={() => setProfiles(previous => [...previous, draft({ id: createId(), name: '', pathPrefix: '', sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage })])}>Add profile</Button>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="primary" disabled={!dirty || profiles.some(profile => !profile.name.trim() || !profile.pathPrefix.trim())} loading={busy} onClick={() => void save()}>Save profiles</Button><Button type="button" disabled={!dirty} onClick={() => setProfiles(JSON.parse(baseline) as ProfileDraft[])}>Discard profile changes</Button></div>
        {dirty && <p role="status" className="text-xs text-warning">Unsaved profile changes. Save profiles before leaving this section.</p>}
      </fieldset>
    </>}
  </section>;
}
