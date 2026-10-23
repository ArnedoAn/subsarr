'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL, ApiError, apiDownload, apiGet, apiPost } from '@/lib/api';
import type { QuickBatchSnapshot, QuickTranslationOptions, SettingsPayload } from '@/lib/types';
import { LanguageCombobox } from '@/components/language-combobox';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';

interface SelectedFile { id: string; file: File; error?: string }
const MB = 1024 * 1024;
const inputClass = 'w-full rounded-lg border border-outline-variant bg-surface-container px-3 py-2 text-on-surface';

// getRandomValues also works on trusted-LAN HTTP, unlike randomUUID.
function createQuickId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export default function QuickTranslatePage() {
  const toast = useToast();
  const picker = useRef<HTMLInputElement>(null);
  const requestId = useRef<string | null>(null);
  const sending = useRef(false);
  const [selected, setSelected] = useState<SelectedFile[]>([]);
  const [source, setSource] = useState('eng');
  const [target, setTarget] = useState('spa');
  const [provider, setProvider] = useState('');
  const [verification, setVerification] = useState(true);
  const [ready, setReady] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [batch, setBatch] = useState<QuickBatchSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [connection, setConnection] = useState('');
  const [confirmBudget, setConfirmBudget] = useState<'upload' | 'retry' | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [restoreId, setRestoreId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void apiGet<SettingsPayload>('/settings', { signal: controller.signal }).then((settings) => {
      let previous: Partial<QuickTranslationOptions> = {};
      if (requestId.current) {
        try { previous = JSON.parse(sessionStorage.getItem('subsarr.quick.options') || '{}') as Partial<QuickTranslationOptions>; }
        catch { setActionError('Saved upload choices could not be restored. Recover the accepted upload before resubmitting.'); }
      }
      setSource(typeof previous.sourceLanguage === 'string' ? previous.sourceLanguage : settings.sourceLanguage || 'eng');
      setTarget(typeof previous.targetLanguage === 'string' ? previous.targetLanguage : settings.targetLanguage || 'spa');
      setProvider(previous.provider === 'deepseek' || previous.provider === 'openrouter' ? previous.provider : '');
      setVerification(typeof previous.verificationEnabled === 'boolean' ? previous.verificationEnabled : settings.translationVerificationEnabled); setReady(true);
    }).catch((error: unknown) => { if (!controller.signal.aborted) setSettingsError(error instanceof Error ? error.message : 'Unable to load saved settings'); });
    setRestoreId(sessionStorage.getItem('subsarr.quick.batch'));
    requestId.current = sessionStorage.getItem('subsarr.quick.request');
    if (requestId.current) setUncertain(true);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!restoreId) return;
    const controller = new AbortController();
    void apiGet<QuickBatchSnapshot>(`/quick-translate/${restoreId}`, { signal: controller.signal }).then(setBatch).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setActionError(error instanceof Error ? error.message : 'Unable to restore batch');
      if (error instanceof ApiError && error.status === 404) sessionStorage.removeItem('subsarr.quick.batch');
    });
    return () => controller.abort();
  }, [restoreId]);

  const batchId = batch?.id;
  const active = batch !== null && batch.expiresAt === null;
  useEffect(() => {
    if (!batchId || !active) return;
    const stream = new EventSource(`${API_URL}/quick-translate/${batchId}/events`);
    const controller = new AbortController();
    let checking = false;
    const update = (event: MessageEvent<string>) => {
      try {
        const snapshot = JSON.parse(event.data) as QuickBatchSnapshot;
        setBatch((previous) => previous?.id === snapshot.id && snapshot.revision >= previous.revision ? snapshot : previous);
        setConnection('Live updates connected');
      } catch { setConnection('Invalid status update; use Refresh status to fetch the current snapshot.'); }
    };
    stream.addEventListener('snapshot', update as EventListener);
    stream.onopen = () => setConnection('Live updates connected');
    stream.onerror = () => {
      setConnection('Connection interrupted; reconnecting automatically. You can refresh status below.');
      if (checking) return;
      checking = true;
      void apiGet<QuickBatchSnapshot>(`/quick-translate/${batchId}`, { signal: controller.signal }).then(setBatch).catch((error: unknown) => {
        if (!controller.signal.aborted && error instanceof ApiError && error.status === 404) {
          stream.close(); setBatch(null); sessionStorage.removeItem('subsarr.quick.batch');
          setActionError('This in-memory batch expired or the server restarted. Files must be uploaded again.');
        }
      }).finally(() => { checking = false; });
    };
    return () => { stream.close(); controller.abort(); };
  }, [batchId, active]);

  const addFiles = useCallback((incoming: File[]) => {
    if (sending.current || active) return;
    if (!uncertain) requestId.current = null;
    if (incoming.length + selected.length > 20) toast.error('A batch supports at most 20 files. Extra files were not added.');
    const additions = incoming.slice(0, 20).map((file) => ({
      id: createQuickId(), file,
      error: !/\.(srt|ass|ssa|vtt)$/i.test(file.name) ? 'Supported formats: SRT, ASS, SSA, VTT' : file.size === 0 ? 'File is empty' : file.size > 2 * MB ? 'Exceeds the 2 MB per-file limit' : undefined,
    }));
    setSelected((previous) => [...previous, ...additions].slice(0, 20));
  }, [active, uncertain, toast, selected.length]);

  useEffect(() => {
    let depth = 0;
    const over = (event: DragEvent) => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = active || busy || uncertain ? 'none' : 'copy'; } };
    const enter = (event: DragEvent) => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); depth++; setDragging(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const drop = (event: DragEvent) => { event.preventDefault(); depth = 0; setDragging(false); if (event.dataTransfer) addFiles(Array.from(event.dataTransfer.files)); };
    window.addEventListener('dragover', over); window.addEventListener('dragenter', enter); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, [addFiles, active, busy, uncertain]);

  function accept(snapshot: QuickBatchSnapshot) {
    setBatch(snapshot); setSelected([]); setUncertain(false); setActionError('');
    sessionStorage.setItem('subsarr.quick.batch', snapshot.id);
    sessionStorage.removeItem('subsarr.quick.request');
    sessionStorage.removeItem('subsarr.quick.options');
    requestId.current = null;
  }

  async function recover() {
    if (!requestId.current) return;
    setRecovering(true);
    try { accept(await apiGet<QuickBatchSnapshot>(`/quick-translate/requests/${requestId.current}`)); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to find accepted upload'); }
    finally { setRecovering(false); }
  }

  async function upload(allowBudgetOverride = false) {
    if (sending.current) return;
    sending.current = true; setBusy(true); setActionError('');
    const id = requestId.current ?? createQuickId(); requestId.current = id;
    sessionStorage.setItem('subsarr.quick.request', id);
    sessionStorage.setItem('subsarr.quick.options', JSON.stringify({ sourceLanguage: source, targetLanguage: target, provider: provider || undefined, verificationEnabled: verification }));
    const body = new FormData();
    for (const entry of selected) body.append('files', entry.file);
    body.append('requestId', id); body.append('sourceLanguage', source); body.append('targetLanguage', target);
    if (provider) body.append('provider', provider);
    body.append('verificationEnabled', String(verification)); body.append('allowBudgetOverride', String(allowBudgetOverride));
    try { accept(await apiPost<QuickBatchSnapshot>('/quick-translate', body)); }
    catch (error) {
      if (error instanceof ApiError && error.status === 409) { setConfirmBudget('upload'); sessionStorage.removeItem('subsarr.quick.request'); }
      else if (error instanceof ApiError && error.status >= 400 && error.status < 500) { setActionError(error.message); sessionStorage.removeItem('subsarr.quick.request'); }
      else { setUncertain(true); setActionError('The upload response was interrupted. Do not create a second batch: recover the accepted upload, or submit the same files with the same request ID. This never starts a duplicate accepted batch.'); }
    } finally { sending.current = false; setBusy(false); }
  }

  async function action(path: string, body?: unknown) {
    setBusy(true); setActionError('');
    try { setBatch(await apiPost<QuickBatchSnapshot>(path, body)); }
    catch (error) {
      if (error instanceof ApiError && error.status === 409 && path.endsWith('/retry')) setConfirmBudget('retry');
      else { const message = error instanceof Error ? error.message : 'Action failed'; setActionError(message); toast.error(message); }
    } finally { setBusy(false); }
  }

  async function download(path: string, name: string) {
    setBusy(true);
    try {
      const blob = await apiDownload(path); const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Download failed'); }
    finally { setBusy(false); }
  }

  const totalBytes = selected.reduce((sum, entry) => sum + entry.file.size, 0);
  const invalid = selected.some((entry) => entry.error) || totalBytes > 20 * MB;
  const locked = busy || active || uncertain;

  return <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
    <header><h1 className="text-2xl font-bold text-on-surface">Quick Translate</h1><p className="mt-2 text-sm text-on-surface-variant">Translate subtitle files without adding them to your library. Files and results stay in server memory only and expire one hour after the batch finishes, or when the server restarts. Queued and working files do not expire.</p></header>
    {!ready && !settingsError && <p role="status" className="text-sm text-on-surface-variant">Loading saved translation settings…</p>}
    {settingsError && <div role="alert" className="rounded-lg bg-error-container p-4 text-error">{settingsError} <a className="underline" href="/settings">Check saved provider settings</a>, then reload this page.</div>}
    <section aria-label="Translation options" className="grid gap-4 rounded-lg bg-surface-container p-4 sm:grid-cols-2">
      <div><p id="quick-source-label" className="mb-2 text-sm">Source language</p><LanguageCombobox value={source} onChange={setSource} ariaLabel="Source language" disabled={locked || !ready} /></div>
      <div><p className="mb-2 text-sm">Target language</p><LanguageCombobox value={target} onChange={setTarget} ariaLabel="Target language" disabled={locked || !ready} /></div>
      <label className="text-sm">Provider<select className={`${inputClass} mt-2`} value={provider} onChange={(event) => setProvider(event.target.value)} disabled={locked || !ready}><option value="">Saved provider preference</option><option value="deepseek">DeepSeek</option><option value="openrouter">OpenRouter</option></select></label>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={verification} disabled={locked || !ready} onChange={(event) => setVerification(event.target.checked)} />Verify translation quality</label>
      <p className="text-xs text-on-surface-variant sm:col-span-2">Uses your saved models, glossary and API keys. Keys never leave the server. Provider usage, including verification and retries, counts toward your budget.</p>
    </section>
    <section className="space-y-4" aria-label="Upload subtitles">
      <div className="rounded-xl border-2 border-dashed border-outline-variant p-6 text-center">
        <p className="font-semibold">Drop subtitle files anywhere in this window</p><p id="quick-limits" className="my-3 text-sm text-on-surface-variant">SRT, ASS, SSA and VTT · up to 20 files · 2 MB per file · 20 MB per batch · 10,000 cues per file. Content is decoded and checked on the server before translation.</p>
        <input ref={picker} type="file" multiple accept=".srt,.ass,.ssa,.vtt" className="sr-only" tabIndex={-1} aria-label="Choose subtitle files" onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
        <Button variant="secondary" disabled={busy || active} aria-describedby="quick-limits" onClick={() => picker.current?.click()}>{uncertain ? 'Choose original files for the same request' : 'Choose files'}</Button>
      </div>
      {selected.length > 0 && <div className="rounded-lg bg-surface-container p-4"><ul className="divide-y divide-outline-variant">{selected.map((entry) => <li key={entry.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="break-all text-sm">{entry.file.name}</p><p className="text-xs text-on-surface-variant">{(entry.file.size / 1024).toFixed(1)} KB</p>{entry.error && <p className="text-sm text-error" role="alert">{entry.error}</p>}</div><Button size="sm" disabled={busy || active} aria-label={`Remove ${entry.file.name}`} onClick={() => { setSelected((files) => files.filter((file) => file.id !== entry.id)); if (!uncertain) requestId.current = null; }}>Remove</Button></li>)}</ul><p className="mt-3 text-sm">{selected.length}/20 files · {(totalBytes / MB).toFixed(2)}/20 MB</p>{totalBytes > 20 * MB && <p role="alert" className="text-error">Remove files to bring the batch below 20 MB.</p>}</div>}
      {selected.length > 0 && !uncertain && <Button variant="primary" loading={busy} disabled={!ready || active || invalid} onClick={() => void upload()}>Upload and translate {selected.length} file{selected.length === 1 ? '' : 's'}</Button>}
      {uncertain && <div className="space-y-3 rounded-lg border border-outline-variant p-4"><p className="text-sm">An upload may already have been accepted. Recover it before starting another batch.</p><div className="flex flex-wrap gap-2"><Button loading={recovering} disabled={busy} onClick={() => void recover()}>Recover accepted upload</Button>{selected.length > 0 && <Button disabled={busy || recovering || invalid} onClick={() => void upload()}>Resubmit same request safely</Button>}</div><p className="break-all text-xs text-on-surface-variant">Request ID: {requestId.current}</p></div>}
    </section>
    {actionError && <p role="alert" className="rounded-lg bg-error-container p-4 text-sm text-error">{actionError}</p>}
    {batch && <section className="space-y-4" aria-label="Translation results"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Files</h2><p className="text-xs text-on-surface-variant">{batch.expiresAt ? `Expires ${new Date(batch.expiresAt).toLocaleString()}` : 'Retained while queued or working; expires one hour after this batch finishes.'}</p></div><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => { void apiGet<QuickBatchSnapshot>(`/quick-translate/${batch.id}`).then(setBatch).catch((error: unknown) => setActionError(error instanceof Error ? error.message : 'Unable to refresh status')); }}>Refresh status</Button>{active && <Button variant="danger" disabled={busy} onClick={() => void action(`/quick-translate/${batch.id}/cancel`)}>Cancel all</Button>}{batch.files.some((file) => file.state === 'failed') && <Button disabled={busy} onClick={() => { if (batch.files.some((file) => file.errorCode === 'BUDGET_OVERRIDE_REQUIRED')) setConfirmBudget('retry'); else void action(`/quick-translate/${batch.id}/retry`, {}); }}>Retry failed only</Button>}<Button disabled={busy || !batch.files.some((file) => file.state === 'completed')} onClick={() => void download(`/quick-translate/${batch.id}/download`, 'subsarr-translations.zip')}>Download completed ZIP</Button></div></div>
      {active && <p className="text-xs text-on-surface-variant" role="status">{connection || 'Connecting to live updates…'}</p>}
      <ul className="space-y-3">{batch.files.map((file) => <li key={file.id} className="space-y-2 rounded-lg bg-surface-container p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h3 className="break-all text-sm font-semibold">{file.name}</h3><p className="text-xs text-on-surface-variant">{file.state} · {file.cueCount.toLocaleString()} cues</p></div>{(file.state === 'queued' || file.state === 'translating') && <Button size="sm" disabled={busy} aria-label={`Cancel ${file.name}`} onClick={() => void action(`/quick-translate/${batch.id}/files/${file.id}/cancel`)}>Cancel</Button>}{file.state === 'completed' && <Button size="sm" disabled={busy} aria-label={`Download ${file.downloadName}`} onClick={() => void download(`/quick-translate/${batch.id}/files/${file.id}/download`, file.downloadName)}>Download</Button>}</div><progress className="h-2 w-full accent-primary" value={file.progress} max={100} aria-label={`${file.name} translation progress`} /><p className="text-xs">{file.progress}%</p>{file.error && <p role="alert" className="break-words text-sm text-error">{file.error}</p>}{file.warnings.map((warning, index) => <p key={index} className="text-sm text-warning">{warning}</p>)}</li>)}</ul>
    </section>}
    {dragging && !locked && <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center border-4 border-primary bg-surface/95 p-8"><p className="text-center text-2xl font-bold">Drop SRT, ASS, SSA or VTT files to add them</p></div>}
    <Dialog open={confirmBudget !== null} onClose={() => setConfirmBudget(null)} title="Monthly translation budget reached"><p className="text-sm">Your configured monthly budget has been reached. Continue this manual translation anyway? This may incur additional provider charges.</p><div className="mt-5 flex justify-end gap-3"><Button onClick={() => setConfirmBudget(null)}>Cancel</Button><Button variant="danger" onClick={() => { const operation = confirmBudget; setConfirmBudget(null); if (operation === 'upload') void upload(true); else if (batch) void action(`/quick-translate/${batch.id}/retry`, { allowBudgetOverride: true }); }}>Confirm budget override</Button></div></Dialog>
  </div>;
}
