'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { apiDownload, apiGet, apiPost, apiPut } from '@/lib/api';
import { type BudgetStatus, type RuleDefinition, type SettingsPayload } from '@/lib/types';
import { useApiQuery } from '@/lib/use-api-query';
import { PathBrowser } from '@/components/path-browser';
import { LanguageCombobox } from '@/components/language-combobox';
import { pushRecentLanguage } from '@/lib/recent-languages';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { MobilePageHeader } from '@/components/mobile/page-header';
import { SettingsField, SettingsNumberField, settingsInputClass } from '@/components/settings/field';
import { NUMBERS, NUMERIC_SETTINGS, validateNumericSettings, type NumericKey } from './settings-validation';
import { ProviderModelPicker, savedProviderModel } from '@/components/provider-model-picker';
import { SystemPreflight } from '@/components/system-preflight';
import { TranslationProfiles } from '@/components/settings/translation-profiles';

const SECTIONS = [
  { id: 'providers', label: 'Providers', terms: 'openrouter deepseek opencode go subscription models api keys pricing token budget costs default' },
  { id: 'languages', label: 'Languages & quality', terms: 'source target language translation verification quality' },
  { id: 'library', label: 'Library & scanning', terms: 'media directories folders roots scan cache ttl exclusions file size rules skip' },
  { id: 'automation', label: 'Automation', terms: 'scheduled rescan cron auto translate new items' },
  { id: 'integrations', label: 'Integrations', terms: 'jellyfin tmdb metadata telegram bot token chat notifications' },
  { id: 'advanced', label: 'Advanced', terms: 'concurrency performance import export backup reset defaults' },
] as const;
type Section = typeof SECTIONS[number]['id'];
const SECRET_FIELDS = ['openRouterApiKey', 'deepSeekApiKey', 'opencodeGoApiKey', 'telegramBotToken', 'jellyfinApiKey', 'tmdbApiKey'] as const;
type SecretKey = typeof SECRET_FIELDS[number];
const EDITABLE_FIELDS = [
  'mediaDirs', 'sourceLanguage', 'targetLanguage', 'defaultProvider', 'openRouterModel', 'deepSeekModel', 'opencodeGoModel', 'pathContainsExclusions',
  'translationVerificationEnabled', 'rules', 'autoScanEnabled', 'autoScanCronExpression', 'autoTranslateNewItems',
  'telegramChatId', 'telegramEnabled', 'telegramEvents', 'jellyfinUrl', 'pricingUpdatedAt', 'pricingSource',
] as const satisfies readonly (keyof SettingsPayload)[];
const emptySecrets = (): Record<SecretKey, string> => ({ openRouterApiKey: '', deepSeekApiKey: '', opencodeGoApiKey: '', telegramBotToken: '', jellyfinApiKey: '', tmdbApiKey: '' });
const numericDraft = (value: SettingsPayload): Record<NumericKey, string> => Object.fromEntries(NUMBERS.map(key => [key, value[key] == null ? '' : String(value[key])])) as Record<NumericKey, string>;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Request failed. Please try again.';
interface TokenUsageSummary { free: { totalTokens: number }; paid: { totalTokens: number }; subscription?: { totalTokens: number }; estimatedCostUsd: number }
interface ConnectionStatus { ok: boolean; botOk?: boolean; chatOk?: boolean; botUsername?: string; error?: string; message?: string }
const EVENTS = [ ['job.completed', 'Job completed'], ['job.failed', 'Job failed'], ['scan.completed', 'Scheduled scan completed'], ['quota.warning', 'Quota warning (80%)'], ['quota.reached', 'Quota reached'] ];

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <div className="rounded-lg bg-surface-container p-4 sm:p-6 space-y-4"><h2 className="font-semibold text-on-surface">{title}</h2>{children}</div>;
}

export default function SettingsPage() {
  const { success } = useToast();
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [baseline, setBaseline] = useState('');
  const [numbers, setNumbers] = useState<Record<NumericKey, string> | null>(null);
  const [numericBadInputs, setNumericBadInputs] = useState<Partial<Record<NumericKey, boolean>>>({});
  const [secrets, setSecrets] = useState(emptySecrets);
  const [clearSecrets, setClearSecrets] = useState<SecretKey[]>([]);
  const [active, setActive] = useState<Section>('providers');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'reset' | 'discard' | null>(null);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [newExclusion, setNewExclusion] = useState('');
  const [telegramStatus, setTelegramStatus] = useState<ConnectionStatus | null>(null);
  const [jellyfinStatus, setJellyfinStatus] = useState<ConnectionStatus | null>(null);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const requests = useRef(new Set<AbortController>());
  const loadGeneration = useRef(0);
  const form = useRef<HTMLFormElement>(null);
  const usage = useApiQuery<TokenUsageSummary>('/settings/token-usage');
  const rules = useApiQuery<RuleDefinition[]>('/rules');
  const budget = useApiQuery<BudgetStatus>('/settings/budget');
  const currentSnapshot = JSON.stringify({ settings, numbers });
  const dirty = !!settings && (currentSnapshot !== baseline || Object.values(numericBadInputs).some(Boolean) || Object.values(secrets).some(Boolean) || clearSecrets.length > 0 || !!newExclusion.trim());
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const adopt = useCallback((value: SettingsPayload) => {
    const draft = numericDraft(value);
    setSettings(value); setNumbers(draft); setSecrets(emptySecrets()); setNewExclusion('');
    setClearSecrets([]);
    setNumericBadInputs({});
    setBaseline(JSON.stringify({ settings: value, numbers: draft }));
  }, []);
  const load = useCallback(async () => {
    const controller = new AbortController(); requests.current.add(controller);
    const generation = ++loadGeneration.current;
    setLoading(true); setLoadError('');
    try {
      const value = await apiGet<SettingsPayload>('/settings', { signal: controller.signal });
      if (!controller.signal.aborted && generation === loadGeneration.current) adopt(value);
    } catch (error) {
      if (!controller.signal.aborted && generation === loadGeneration.current) setLoadError(errorMessage(error));
    } finally {
      requests.current.delete(controller);
      if (!controller.signal.aborted && generation === loadGeneration.current) setLoading(false);
    }
  }, [adopt]);
  useEffect(() => { const activeRequests = requests.current; void load(); return () => { for (const request of activeRequests) request.abort(); }; }, [load]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    const click = (event: MouseEvent) => {
      if (!dirtyRef.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download') || anchor.target === '_blank') return;
      const url = new URL(anchor.href, location.href);
      if (url.pathname === location.pathname && url.search === location.search) return;
      if (!window.confirm('You have unsaved settings. Leave without saving?')) { event.preventDefault(); event.stopPropagation(); }
    };
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const traverse = (event: Event) => {
      const navigationEvent = event as Event & { navigationType?: string };
      if (navigationEvent.navigationType === 'traverse' && event.cancelable && dirtyRef.current && !window.confirm('You have unsaved settings. Leave without saving?')) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload); document.addEventListener('click', click, true); navigation?.addEventListener('navigate', traverse);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', click, true); navigation?.removeEventListener('navigate', traverse); };
  }, []);

  async function perform<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    const controller = new AbortController(); requests.current.add(controller);
    setBusy(true); setActionError('');
    try { return await action(controller.signal); }
    catch (error) { if (!controller.signal.aborted) setActionError(errorMessage(error)); }
    finally { requests.current.delete(controller); if (!controller.signal.aborted) setBusy(false); }
  }
  async function save() {
    if (!settings || !numbers || busy) return;
    if (newExclusion.trim()) { setActionError('Add your pending path exclusion before saving, or clear its input.'); setActive('library'); setSearch(''); return; }
    if (!settings.mediaDirs.length || settings.mediaDirs.some(value => !value.trim())) {
      setActionError('Select at least one media directory and provide a path for every directory.'); setActive('library'); setSearch(''); return;
    }
    const numericError = validateNumericSettings(numbers, numericBadInputs);
    if (numericError) { setActionError(numericError.message); setActive(numericError.section as Section); setSearch(''); return; }
    if (!settings.openRouterModel.trim() || !settings.deepSeekModel.trim() || !settings.opencodeGoModel.trim()) { setActionError('All provider model IDs are required.'); setActive('providers'); setSearch(''); return; }
    if (!form.current?.reportValidity()) return;
    await perform(async signal => {
      const body: Record<string, unknown> = {};
      for (const key of EDITABLE_FIELDS) body[key] = settings[key];
      for (const key of NUMBERS) body[key] = numbers[key] === '' ? null : Number(numbers[key]);
      for (const key of SECRET_FIELDS) if (secrets[key].trim()) body[key] = secrets[key].trim();
      if (clearSecrets.length) body.clearSecrets = clearSecrets;
      const saved = await apiPut<SettingsPayload>('/settings', body, { signal });
      if (signal.aborted) return;
      adopt(saved); pushRecentLanguage(saved.sourceLanguage); pushRecentLanguage(saved.targetLanguage);
      success('Settings saved'); budget.refetch(); usage.refetch();
    });
  }
  async function exportSettings() {
    await perform(async signal => {
      const blob = await apiDownload(`/settings/export${includeSecrets ? '?includeSecrets=true' : ''}`, { signal });
      if (signal.aborted) return;
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'subsarr-config.zip'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  async function importSettings(file: File) {
    if (file.size > 2 * 1024 * 1024) { setActionError('Import ZIP must be 2 MiB or smaller (8 MiB maximum uncompressed).'); return; }
    if (dirty && !window.confirm('Import replaces saved settings and discards your unsaved changes. Continue?')) return;
    await perform(async signal => {
      const data = new FormData(); data.append('file', file);
      await apiPost('/settings/import', data, { signal });
      const saved = await apiGet<SettingsPayload>('/settings', { signal });
      if (signal.aborted) return;
      adopt(saved); success('Configuration imported'); budget.refetch(); rules.refetch();
    });
  }
  async function checkConnection(kind: 'telegram' | 'jellyfin', test = false) {
    const controller = new AbortController(); requests.current.add(controller); setConnectionBusy(true);
    try {
      const result = kind === 'telegram' && !test
        ? await apiGet<ConnectionStatus>('/settings/telegram/status', { signal: controller.signal })
        : await apiPost<ConnectionStatus>(`/settings/${kind}/test`, undefined, { signal: controller.signal });
      if (!controller.signal.aborted) { if (kind === 'telegram') setTelegramStatus(result); else setJellyfinStatus(result); }
    } catch (error) {
      if (!controller.signal.aborted) { const result = { ok: false, error: errorMessage(error) }; if (kind === 'telegram') setTelegramStatus(result); else setJellyfinStatus(result); }
    } finally { requests.current.delete(controller); if (!controller.signal.aborted) setConnectionBusy(false); }
  }
  if (!settings || !numbers) return <section className="space-y-4 py-8"><h1 className="text-2xl font-bold">Settings</h1>{loadError ? <div role="alert" className="space-y-3 text-error"><p>{loadError}</p><Button onClick={() => void load()} disabled={loading}>Retry loading settings</Button></div> : <p role="status">Loading settings…</p>}</section>;

  const update = <K extends keyof SettingsPayload>(key: K, value: SettingsPayload[K]) => setSettings(previous => previous ? { ...previous, [key]: value } : previous);
  const numeric = (key: NumericKey, label: string, max: number, options: { min?: number; optional?: boolean; integer?: boolean; hint?: string } = {}) => <SettingsNumberField key={key} label={label} value={numbers[key]} badInput={numericBadInputs[key]} onChange={(value, badInput) => { setNumbers(previous => previous ? { ...previous, [key]: value } : previous); setNumericBadInputs(previous => ({ ...previous, [key]: badInput })); }} min={NUMERIC_SETTINGS[key].min} max={max} {...options} />;
  const text = (key: keyof SettingsPayload, label: string, maxLength = 256, hint?: string, type = 'text') => <SettingsField label={label} hint={hint}><input aria-label={label} type={type} maxLength={maxLength} value={String(settings[key] ?? '')} onChange={e => update(key, e.target.value as never)} className={settingsInputClass} /></SettingsField>;
  const secret = (key: SecretKey, label: string) => <SettingsField label={label} hint={clearSecrets.includes(key) ? 'This key will be removed when you save. Cancel removal to keep it.' : settings[`${key}Masked` as keyof SettingsPayload] ? 'Saved securely. Leave empty to keep the saved key; enter a new key only to replace it.' : 'Not configured. Enter a key once and save.'}><input aria-label={label} type="password" autoComplete="new-password" maxLength={4096} value={secrets[key]} disabled={clearSecrets.includes(key)} onChange={e => setSecrets(previous => ({ ...previous, [key]: e.target.value }))} placeholder="Enter a new key" className={settingsInputClass} /><span className="block text-xs text-on-surface-variant">{settings[`${key}Masked` as keyof SettingsPayload] ? `Saved · ${settings[`${key}Masked` as keyof SettingsPayload]}` : 'Not set'}</span>{(settings[`${key}Masked` as keyof SettingsPayload] || clearSecrets.includes(key)) && <button type="button" className="text-xs underline" onClick={() => { setClearSecrets(previous => previous.includes(key) ? previous.filter(field => field !== key) : [...previous, key]); setSecrets(previous => ({ ...previous, [key]: '' })); }}>{clearSecrets.includes(key) ? `Cancel removing ${label}` : `Remove saved ${label} on save`}</button>}</SettingsField>;
  const matched = SECTIONS.filter(section => `${section.label} ${section.terms}`.toLowerCase().includes(search.toLowerCase().trim()));
  const visible = search.trim() ? matched.map(section => section.id) : [active];
  const show = (section: Section) => visible.includes(section);
  const connection = (status: ConnectionStatus | null) => status && <p role="status" className={status.ok ? 'text-sm text-success' : 'text-sm text-error'}>{status.ok ? 'Connection successful' : 'Connection failed'}{status.botUsername ? ` · @${status.botUsername}` : ''}{status.error ? `: ${status.error}` : status.message ? `: ${status.message}` : ''}</p>;

  return <section className="space-y-6 pb-28">
    <MobilePageHeader title="Settings" subtitle="Translation, scanning, automation and integrations" />
    <h1 className="hidden md:block text-2xl font-bold text-on-surface">Settings</h1>
    {!!settings.secretWarnings?.length && <div role="alert" className="rounded-lg border border-warning/40 bg-surface-container p-4 text-warning space-y-2"><h2 className="text-sm font-semibold">Saved credentials need attention</h2><p className="text-xs">Unreadable saved keys have not been removed or changed. Enter a replacement in its provider or integration field to repair it; leaving its input blank preserves the stored value.</p><ul className="list-disc pl-5 text-sm">{settings.secretWarnings.map((warning, index) => <li key={`${warning.field}-${index}`}><span className="font-semibold">{warning.field}</span>: {warning.message}</li>)}</ul></div>}
    <SettingsField label="Search settings"><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search sections or fields…" className={settingsInputClass} /></SettingsField>
    <div className="flex flex-col lg:flex-row gap-6">
      <nav aria-label="Settings sections" className="flex lg:flex-col gap-1 overflow-x-auto lg:w-52 shrink-0">
        {SECTIONS.map(section => <button type="button" key={section.id} onClick={() => { setActive(section.id); setSearch(''); }} aria-current={active === section.id && !search ? 'page' : undefined} className={`shrink-0 rounded-lg px-3 py-2 text-sm text-left ${active === section.id && !search ? 'bg-primary/10 text-primary' : 'text-on-surface-variant hover:bg-surface-container-high'}`}>{section.label}</button>)}
      </nav>
      <form ref={form} onSubmit={event => { event.preventDefault(); void save(); }} className="min-w-0 flex-1 space-y-6">
        <fieldset disabled={busy} className="space-y-6 min-w-0">
          {search && !matched.length && <p role="status">No settings match “{search}”. Try a provider, language, folder or integration name.</p>}
          {show('providers') && <>
            <Panel title="Translation providers">
              <p className="text-sm text-on-surface-variant">Keys are encrypted at rest automatically. Saved keys are never loaded into these inputs; no repeated key entry is needed. The default provider and its saved model apply to future translations, not already queued jobs.</p>
              <ProviderModelPicker provider={settings.defaultProvider} model={savedProviderModel(settings, settings.defaultProvider)} onProviderChange={value => update('defaultProvider', value)} onModelChange={value => update(settings.defaultProvider === 'opencode-go' ? 'opencodeGoModel' : settings.defaultProvider === 'deepseek' ? 'deepSeekModel' : 'openRouterModel', value)} />
              {text('openRouterModel', 'OpenRouter saved model ID', 128)}{secret('openRouterApiKey', 'OpenRouter API key')}
              {text('deepSeekModel', 'DeepSeek saved model ID', 128)}{secret('deepSeekApiKey', 'DeepSeek API key')}
              {secret('opencodeGoApiKey', 'OpenCode Go API key')}
            </Panel>
            <Panel title="OpenCode Go saved model">
              <p className="text-xs text-on-surface-variant">Choose the saved Go model independently of your global default provider. Disable Extra Usage in the OpenCode Console: Subsarr never enables it. Subscription fees and possible Extra Usage charges are not estimated.</p>
              <ProviderModelPicker provider="opencode-go" model={settings.opencodeGoModel} showProvider={false} onProviderChange={value => update('defaultProvider', value)} onModelChange={value => update('opencodeGoModel', value)} />
            </Panel>
            <Panel title="Usage & monthly budget">
              {budget.error ? <div role="alert" className="text-sm text-error">Budget status unavailable: {budget.error.message} <button type="button" onClick={budget.refetch} className="underline">Retry</button></div> : budget.data ? <p role="status" className={`text-sm ${budget.data.level === 'exceeded' ? 'text-error' : budget.data.level === 'warning' ? 'text-warning' : 'text-on-surface'}`}>This month: ${budget.data.spentUsd.toFixed(2)} spent / {budget.data.budgetUsd == null ? 'no budget set' : `$${budget.data.budgetUsd.toFixed(2)} budget`}{budget.data.ratio != null ? ` (${Math.round(budget.data.ratio * 100)}%)` : ''}.</p> : <p role="status" className="text-sm">Loading budget status…</p>}
              <p className="text-xs text-on-surface-variant">At 80% you receive a warning. At 100%, automatic paid translations are blocked; manual paid translations require explicit confirmation. Running translations are not interrupted. Budget status uses saved pricing and settings.</p>
              {numeric('monthlyBudgetUsd', 'Monthly budget (USD)', 1e6, { optional: true, hint: 'Leave empty for no monthly budget. Zero blocks paid automatic requests immediately.' })}
              <div className="grid sm:grid-cols-2 gap-4">{numeric('dailyTokenLimitFree', 'Daily free token limit', 1e12, { optional: true, integer: true })}{numeric('dailyTokenLimitPaid', 'Daily paid token limit', 1e12, { optional: true, integer: true })}</div>
              {usage.error ? <p role="alert" className="text-sm text-error">Usage unavailable: {usage.error.message} <button type="button" className="underline" onClick={usage.refetch}>Retry</button></p> : usage.data ? <p className="text-sm text-on-surface-variant">Free: {usage.data.free.totalTokens.toLocaleString()} tokens · Paid: {usage.data.paid.totalTokens.toLocaleString()} tokens · Subscription: {(usage.data.subscription?.totalTokens ?? 0).toLocaleString()} tokens · estimated pay-as-you-go spend ${usage.data.estimatedCostUsd.toFixed(4)}. Subscription fees and possible Console Extra Usage charges are not estimated.</p> : <p className="text-sm">Loading token usage…</p>}
            </Panel>
            <Panel title="DeepSeek model pricing"><p className="text-xs text-on-surface-variant">USD per million tokens. Update these values when your model pricing changes; no live pricing API is contacted.</p>{numeric('deepSeekInputCacheHitUsdPerMillion', 'Cache-hit input price', 1000)}{numeric('deepSeekInputCacheMissUsdPerMillion', 'Cache-miss input price', 1000)}{numeric('deepSeekOutputUsdPerMillion', 'Output price', 1000)}{text('pricingUpdatedAt', 'Pricing date', 10, 'Date of the pricing information (YYYY-MM-DD).', 'date')}{text('pricingSource', 'Pricing source URL', 2048, undefined, 'url')}</Panel>
          </>}
          {show('languages') && <Panel title="Languages & quality"><div className="grid sm:grid-cols-2 gap-4"><SettingsField label="Source language"><LanguageCombobox value={settings.sourceLanguage} onChange={value => update('sourceLanguage', value)} ariaLabel="Source language" /></SettingsField><SettingsField label="Target language"><LanguageCombobox value={settings.targetLanguage} onChange={value => update('targetLanguage', value)} ariaLabel="Target language" /></SettingsField></div><Toggle checked={settings.translationVerificationEnabled} onChange={value => update('translationVerificationEnabled', value)} label="Translation verification" description="Check translated language and retry rejected translations within the provider retry limits." /></Panel>}
          {show('library') && <>
            <Panel title="Media directories"><p className="text-xs text-on-surface-variant">Choose up to 32 directories inside the configured server media roots. At least one is required.</p>{settings.mediaDirs.map((directory, index) => <div className="flex items-start gap-2" key={index}><div className="flex-1 min-w-0"><PathBrowser value={directory} onChange={value => update('mediaDirs', settings.mediaDirs.map((entry, entryIndex) => entryIndex === index ? value : entry))} placeholder="Select a media directory…" /></div><Button type="button" variant="ghost" aria-label={`Remove directory ${index + 1}`} onClick={() => update('mediaDirs', settings.mediaDirs.filter((_, entryIndex) => entryIndex !== index))} disabled={settings.mediaDirs.length <= 1}>Remove</Button></div>)}<Button type="button" variant="secondary" disabled={settings.mediaDirs.length >= 32} onClick={() => update('mediaDirs', [...settings.mediaDirs, ''])}>Add directory</Button>{settings.mediaDirs.some(value => !value.trim()) && <p role="alert" className="text-xs text-error">Select a path for every directory before saving.</p>}{numeric('scanCacheTtlMinutes', 'Scan cache TTL (minutes)', 10080, { min: 1, integer: true })}{numeric('fileTooLargeBytes', 'Maximum file size (bytes)', Number.MAX_SAFE_INTEGER, { optional: true, integer: true, hint: 'Leave empty for no size limit.' })}<Button type="button" variant="secondary" onClick={() => void perform(async signal => { const result = await apiPost<{ accepted: boolean }>('/library/rescan', undefined, { signal }); if (!signal.aborted) success(result.accepted ? 'Library rescan started (using saved settings)' : 'A scan is already running'); })}>Rescan library</Button></Panel>
            <Panel title="Skip rules">{rules.error && <p role="alert" className="text-sm text-error">Rule descriptions unavailable; saved rules remain unchanged. {rules.error.message} <button type="button" className="underline" onClick={rules.refetch}>Retry</button></p>}{!rules.data && !rules.error && <p>Loading rule descriptions…</p>}{rules.data?.map(definition => { const saved = settings.rules.find(rule => rule.id === definition.id); return <Toggle key={definition.id} checked={saved?.enabled ?? definition.enabled} onChange={enabled => update('rules', saved ? settings.rules.map(rule => rule.id === definition.id ? { ...rule, enabled } : rule) : [...settings.rules, { id: definition.id, enabled }])} label={definition.label} description={definition.description} />; })}</Panel>
            <Panel title="Path exclusions"><p className="text-xs text-on-surface-variant">Skip files whose path contains any of these strings (maximum 200).</p><div className="flex flex-wrap gap-2">{settings.pathContainsExclusions.map((entry, index) => <span className="flex items-center gap-2 rounded bg-surface-container-high p-2 text-xs break-all" key={index}>{entry}<button type="button" aria-label={`Remove exclusion ${entry}`} onClick={() => update('pathContainsExclusions', settings.pathContainsExclusions.filter((_, entryIndex) => entryIndex !== index))}>×</button></span>)}</div><div className="flex gap-2"><input aria-label="New path exclusion" maxLength={500} value={newExclusion} onChange={event => setNewExclusion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (newExclusion.trim() && settings.pathContainsExclusions.length < 200) { update('pathContainsExclusions', [...settings.pathContainsExclusions, newExclusion.trim()]); setNewExclusion(''); } } }} className={settingsInputClass} /><Button type="button" variant="secondary" disabled={!newExclusion.trim() || settings.pathContainsExclusions.length >= 200} onClick={() => { update('pathContainsExclusions', [...settings.pathContainsExclusions, newExclusion.trim()]); setNewExclusion(''); }}>Add</Button></div></Panel>
          </>}
          {show('automation') && <Panel title="Scheduled scanning & translation"><Toggle checked={settings.autoScanEnabled} onChange={value => update('autoScanEnabled', value)} label="Enable scheduled rescan" description="Runs in the server timezone, with a minimum interval of 5 minutes." />{text('autoScanCronExpression', 'Cron expression', 100, 'Five fields: minute hour day month weekday; or six fields with seconds first. Every six hours: 0 */6 * * *. Schedule syntax and frequency are checked when scheduled scanning is enabled.')}<Toggle checked={settings.autoTranslateNewItems} onChange={value => update('autoTranslateNewItems', value)} label="Automatically translate new items" description="New media found by scheduled scans is queued only when language defaults and skip rules allow. Automatic paid jobs stop at the monthly budget." /></Panel>}
          <div hidden={!show('automation')}><TranslationProfiles settings={settings} settingsDirty={dirty} /></div>
          {show('integrations') && <>
            <Panel title="Jellyfin & TMDB metadata">{text('jellyfinUrl', 'Jellyfin URL', 2048, 'Changing the server URL clears its saved API key unless you supply a new key.', 'url')}{secret('jellyfinApiKey', 'Jellyfin API key')}{secret('tmdbApiKey', 'TMDB API key')}<p className="text-xs text-on-surface-variant">Used for media metadata and rename suggestions. Connection tests use saved settings; save changes first.</p><Button type="button" variant="secondary" disabled={connectionBusy || dirty} onClick={() => void checkConnection('jellyfin')}>Test saved Jellyfin connection</Button>{connection(jellyfinStatus)}</Panel>
            <Panel title="Telegram notifications"><Toggle checked={settings.telegramEnabled} onChange={value => update('telegramEnabled', value)} label="Enable Telegram notifications" />{secret('telegramBotToken', 'Telegram bot token')}{text('telegramChatId', 'Telegram chat ID', 100, 'Create a bot using @BotFather, send it a message, then provide your user or group chat ID.')}{EVENTS.map(([id, label]) => <Toggle key={id} checked={settings.telegramEvents.includes(id)} onChange={enabled => update('telegramEvents', enabled ? [...settings.telegramEvents, id] : settings.telegramEvents.filter(event => event !== id))} label={label} />)}<p className="text-xs text-on-surface-variant">Save before checking the connection or sending a test message.</p><div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" disabled={connectionBusy || dirty} onClick={() => void checkConnection('telegram')}>Check saved connection</Button><Button type="button" variant="secondary" disabled={connectionBusy || dirty} onClick={() => void checkConnection('telegram', true)}>Send test message</Button></div>{connection(telegramStatus)}</Panel>
          </>}
          {show('advanced') && <>
            <Panel title="Processing">{numeric('concurrency', 'Concurrent jobs', 16, { min: 1, integer: true })}</Panel>
            <SystemPreflight />
            <Panel title="Configuration backup"><p className="text-sm text-on-surface-variant">Export and import settings, translation profiles and glossary as a ZIP. Import limit: 2 MiB compressed, 8 MiB uncompressed. Imports replace saved configuration.</p><Toggle checked={includeSecrets} onChange={setIncludeSecrets} label="Include API keys and tokens in export" description="Off by default. When enabled the ZIP contains plaintext secrets: keep it private and never attach it to a public issue." /><Button type="button" variant="secondary" onClick={() => void exportSettings()}>Export saved configuration</Button>{dirty && <p className="text-xs text-warning">Exports contain saved settings, not unsaved edits.</p>}<SettingsField label="Import configuration ZIP"><input type="file" accept=".zip,application/zip" className="block w-full text-sm" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importSettings(file); }} /></SettingsField></Panel>
            <Panel title="Reset settings"><p className="text-sm text-on-surface-variant">Restore settings defaults. This replaces your saved configuration and discards unsaved settings.</p><Button type="button" variant="secondary" onClick={() => setConfirmAction('reset')}>Reset to defaults…</Button></Panel>
          </>}
        </fieldset>
      </form>
    </div>
    {actionError && <div role="alert" className="rounded-lg border border-error/30 bg-surface-container p-4 text-error"><p>{actionError}</p><p className="mt-1 text-xs">Your form is preserved. Correct the problem and retry the action.</p></div>}
    {(dirty || busy) && <div className="sticky bottom-[calc(84px+env(safe-area-inset-bottom))] md:bottom-3 z-20 rounded-lg border border-outline-variant bg-surface-container-high p-3 shadow-xl flex flex-wrap items-center justify-between gap-3" role="region" aria-label="Unsaved settings"><p className="text-sm" aria-live="polite">{busy ? 'Applying request…' : 'You have unsaved changes'}</p><div className="flex gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmAction('discard')}>Discard</Button><Button type="button" loading={busy} disabled={busy} onClick={() => { if (settings.mediaDirs.some(value => !value.trim())) { setActionError('Every media directory needs a path.'); setActive('library'); setSearch(''); return; } void save(); }}>Save settings</Button></div></div>}
    <Dialog open={confirmAction !== null} onClose={() => { if (!busy) setConfirmAction(null); }} title={confirmAction === 'reset' ? 'Reset settings to defaults?' : 'Discard unsaved changes?'}>
      <p className="text-sm text-on-surface-variant">{confirmAction === 'reset' ? 'Saved settings will be replaced with defaults. This cannot be undone unless you have a configuration backup.' : 'Your changes and newly entered API keys will be removed from this form.'}</p>
      {confirmAction === 'reset' && actionError && <p role="alert" className="mt-3 text-sm text-error">{actionError} Your form is preserved. Retry reset or cancel.</p>}
      <div className="mt-5 flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmAction(null)}>Cancel</Button><Button type="button" disabled={busy} onClick={() => { if (confirmAction === 'discard') { const previous = JSON.parse(baseline) as { settings: SettingsPayload }; adopt(previous.settings); setActionError(''); setConfirmAction(null); } else { void perform(async signal => { await apiPost('/settings/reset', undefined, { signal }); const value = await apiGet<SettingsPayload>('/settings', { signal }); if (!signal.aborted) { adopt(value); setConfirmAction(null); success('Settings reset to defaults'); budget.refetch(); } }); } }}>Confirm {confirmAction === 'reset' ? 'reset' : 'discard'}</Button></div>
    </Dialog>
  </section>;
}
