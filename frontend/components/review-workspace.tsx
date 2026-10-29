'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, apiDelete, apiDownload, apiGet, apiPatch, apiPost } from '@/lib/api';
import type { MediaItem, ReviewOperation, ReviewWorkspacePage } from '@/lib/types';
import { REVIEW_PAGE_SIZE, REVIEW_SELECTION_LIMIT, reviewEdits, reviewPollDelay, reviewWorkspaceLink, toggleReviewCue } from '@/lib/review-workspace';
import { LanguageCombobox } from '@/components/language-combobox';
import { ProviderModelPicker, useTranslationSelection } from '@/components/provider-model-picker';
import { ReviewCueEditor } from '@/components/review-cue-editor';
import { ReviewMemory } from '@/components/review-memory';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

const inputClass = 'engraved-input w-full rounded-lg p-3';
const workspacePath = (id: string) => `/subtitle-workspace/${encodeURIComponent(id)}`;
const operationKey = (id: string) => `subsarr.review.operation.${id}`;
const message = (error: unknown) => error instanceof Error ? error.message : 'Subtitle workspace request failed';

export function ReviewWorkspace() {
  const router = useRouter();
  const search = useSearchParams();
  const id = search.get('id') || search.get('workspace');
  const mediaId = search.get('mediaId');
  const { error: showError, success, warning } = useToast();
  const picker = useTranslationSelection();
  const [page, setPage] = useState<ReviewWorkspacePage | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [targetFile, setTargetFile] = useState<File | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState('eng');
  const [targetLanguage, setTargetLanguage] = useState('spa');
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [subtitlePath, setSubtitlePath] = useState('');
  const [trackIndex, setTrackIndex] = useState('');
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [context, setContext] = useState('');
  const [approved, setApproved] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [budgetOverride, setBudgetOverride] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [operation, setOperation] = useState<ReviewOperation | null>(null);
  const [pollFailure, setPollFailure] = useState('');
  const [pollAttempt, setPollAttempt] = useState(0);
  const currentId = useRef(id);
  const offsetRef = useRef(offset);
  currentId.current = id;
  offsetRef.current = offset;
  const edits = page ? reviewEdits(page.cues, drafts) : [];
  const contextDirty = page !== null && context !== page.contextSheet;
  const dirty = edits.length > 0 || contextDirty;
  const locked = busy || loading || operationId !== null;

  const reload = useCallback(async (workspaceId: string, nextOffset: number, signal?: AbortSignal) => {
    const result = await apiGet<ReviewWorkspacePage>(`${workspacePath(workspaceId)}?offset=${nextOffset}&limit=${REVIEW_PAGE_SIZE}`, { signal });
    if (signal?.aborted || currentId.current !== workspaceId) return;
    setPage(result); setContext(result.contextSheet); setDrafts({}); setFailure('');
  }, []);

  useEffect(() => {
    if (picker.error) showError(picker.error);
  }, [picker.error, showError]);

  useEffect(() => {
    const controller = new AbortController();
    setPage(null); setDrafts({}); setSelected(new Set()); setApproved(false); setContext('');
    setOperation(null); setPollFailure(''); setOffset(0); setFailure('');
    setOperationId(id ? sessionStorage.getItem(operationKey(id)) : null);
    if (!id) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    void reload(id, 0, controller.signal).catch(error => {
      if (!controller.signal.aborted) { setFailure(message(error)); showError(message(error)); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, reload, showError]);

  useEffect(() => {
    const controller = new AbortController();
    setMedia(null); setSubtitlePath(''); setTrackIndex('');
    if (id || !mediaId) return () => controller.abort();
    setLoading(true);
    void apiGet<MediaItem>(`/library/${encodeURIComponent(mediaId)}`, { signal: controller.signal }).then(item => {
      if (controller.signal.aborted) return;
      setMedia(item); setSubtitlePath(item.externalSubtitles[0]?.path ?? '');
    }).catch(error => { if (!controller.signal.aborted) { setFailure(message(error)); showError(message(error)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, mediaId, showError]);

  useEffect(() => {
    if (!id || !operationId) return;
    const controller = new AbortController();
    setPollFailure('');
    void (async () => {
      while (!controller.signal.aborted) {
        const result = await apiGet<ReviewOperation>(`${workspacePath(id)}/operations/${encodeURIComponent(operationId)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setOperation(result);
        if (['completed', 'failed', 'cancelled'].includes(result.status)) {
          await reload(id, offsetRef.current, controller.signal);
          sessionStorage.removeItem(operationKey(id)); setOperationId(null);
          if (result.status === 'failed') showError(result.error || 'Retranslation failed');
          else if (result.status === 'completed') { success('Selected cues retranslated. Review before approving to memory.'); setSelected(new Set()); }
          else warning('Retranslation cancelled. Current workspace reloaded.');
          return;
        }
        await reviewPollDelay(controller.signal);
      }
    })().catch(error => {
      if (!controller.signal.aborted) { setPollFailure(message(error)); showError(`Status polling paused: ${message(error)}`); }
    });
    return () => controller.abort();
  }, [id, operationId, pollAttempt, reload, showError, success, warning]);

  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await action(); }
    catch (error) {
      if (error instanceof ApiError && error.status === 409 && id) {
        warning('This workspace changed elsewhere. Reloading the latest revision; unsaved edits were discarded.');
        try { await reload(id, offset); } catch (reloadError) { showError(message(reloadError)); }
      } else showError(message(error));
    } finally { setBusy(false); }
  };

  const createUpload = () => run(async () => {
    if (!sourceFile) return;
    const form = new FormData();
    form.append('source', sourceFile);
    if (targetFile) form.append('translated', targetFile);
    form.append('sourceLanguage', sourceLanguage); form.append('targetLanguage', targetLanguage);
    const result = await apiPost<{ id: string; revision: number }>('/subtitle-workspace', form);
    router.replace(reviewWorkspaceLink(result.id));
  });

  const createLibrary = () => run(async () => {
    if (!mediaId || !subtitlePath) return;
    const result = await apiPost<{ id: string; revision: number }>(`/subtitle-workspace/library/${encodeURIComponent(mediaId)}`, {
      subtitlePath, sourceLanguage, targetLanguage,
      ...(trackIndex !== '' ? { sourceTrackIndex: Number(trackIndex) } : {}),
    });
    router.replace(reviewWorkspaceLink(result.id));
  });
  const saveChanges = () => run(async () => {
    if (!page || !id) return;
    let revision = page.revision;
    if (edits.length) {
      const updated = await apiPatch<{ revision: number }>(`${workspacePath(id)}/cues`, { expectedRevision: revision, edits });
      revision = updated.revision;
    }
    if (contextDirty) {
      await apiPost(`${workspacePath(id)}/context`, { expectedRevision: revision, contextSheet: context });
    }
    await reload(id, offset); success('Cue and context changes saved.'); setApproved(false);
  });

  const retranslate = () => run(async () => {
    if (!page || !id) return;
    const result = await apiPost<{ operationId: string }>(`${workspacePath(id)}/retranslate`, {
      expectedRevision: page.revision, cueIndices: [...selected], provider: picker.provider,
      ...(picker.model.trim() ? { model: picker.model.trim() } : {}), allowBudgetOverride: budgetOverride,
    });
    sessionStorage.setItem(operationKey(id), result.operationId); setOperation(null); setOperationId(result.operationId); setApproved(false);
  });

  const download = () => run(async () => {
    if (!page || !id) return;
    const blob = await apiDownload(`${workspacePath(id)}/download`);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = page.filename;
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const navigatePage = (next: number) => run(async () => {
    if (!id) return;
    await reload(id, next); setOffset(next);
  });

  return <main className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold">Subtitle review</h1><p className="text-sm text-on-surface-variant">Compare, edit and check subtitles without changing cue timing. AI retranslation consumes provider usage.</p></div>
      {page && <Button disabled={locked} onClick={() => void run(async () => {
        if (dirty && !window.confirm('Discard unsaved cue/context edits and close this workspace?')) return;
        await apiDelete(workspacePath(page.id)); sessionStorage.removeItem(operationKey(page.id)); router.replace('/review');
      })}>Close workspace</Button>}
    </header>
    <p className="text-xs text-on-surface-variant">Uploaded workspaces stay in server memory, expire after one hour idle, and disappear on restart. Only explicit memory approval or Save to library persists subtitle text.</p>
    {loading && <p role="status">Loading workspace…</p>}
    {failure && <div role="alert" className="rounded-lg border border-error p-4 text-error">{failure}{id && <Button className="ml-3" disabled={locked} onClick={() => void run(() => reload(id, offset))}>Reload workspace</Button>}</div>}
    {!id && <section className="rounded-xl border border-outline-variant/30 bg-surface-container p-4 space-y-4">
      <h2 className="font-semibold">{mediaId ? `Open library subtitles${media ? ` — ${media.name}` : ''}` : 'Upload subtitles'}</h2>
      <div className="grid gap-4 sm:grid-cols-2"><div><p className="text-sm mb-1">Source language</p><LanguageCombobox value={sourceLanguage} onChange={setSourceLanguage} ariaLabel="Source language" disabled={locked} /></div><div><p className="text-sm mb-1">Target language</p><LanguageCombobox value={targetLanguage} onChange={setTargetLanguage} ariaLabel="Target language" disabled={locked} /></div></div>
      {mediaId ? <>
        <label className="block text-sm">Existing translated sidecar<select className={`${inputClass} mt-1`} value={subtitlePath} disabled={locked} onChange={event => setSubtitlePath(event.target.value)}><option value="">Select a sidecar</option>{media?.externalSubtitles.map(subtitle => <option key={subtitle.path} value={subtitle.path}>{subtitle.path.split(/[\\/]/).pop()} ({subtitle.language})</option>)}</select></label>
        <label className="block text-sm">Embedded source track (optional)<select className={`${inputClass} mt-1`} value={trackIndex} disabled={locked} onChange={event => setTrackIndex(event.target.value)}><option value="">Use sidecar as source (no original-language comparison)</option>{media?.subtitleTracks.map(track => <option key={track.index} value={track.index}>Track {track.index} — {track.language} {track.title} ({track.codec})</option>)}</select></label>
        {media && !media.externalSubtitles.length && <p role="status">No editable subtitle sidecars found for this library item.</p>}
        <Button variant="primary" disabled={locked || !subtitlePath} loading={busy} onClick={() => void createLibrary()}>Open selected sidecar</Button>
      </> : <>
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Source file<input type="file" accept=".srt,.ass,.ssa,.vtt" disabled={locked} className={`${inputClass} mt-1`} onChange={event => setSourceFile(event.target.files?.[0] ?? null)} /></label><label className="text-sm">Translation file (optional)<input type="file" accept=".srt,.ass,.ssa,.vtt" disabled={locked} className={`${inputClass} mt-1`} onChange={event => setTargetFile(event.target.files?.[0] ?? null)} /></label></div>
        <p className="text-xs text-on-surface-variant">SRT, ASS/SSA and VTT. Without a translation, source text initializes the editable version. Opening a workspace does not call AI.</p>
        <Button variant="primary" loading={busy} disabled={locked || !sourceFile} onClick={() => void createUpload()}>Open workspace</Button>
      </>}
    </section>}
    {page && <>
      <section className="rounded-xl border border-outline-variant/30 bg-surface-container p-4 space-y-3">
        <h2 className="font-semibold break-words">{page.filename}</h2>
        <p className="text-sm">{page.sourceLanguage} → {page.targetLanguage} · {page.cueCount} cues · Revision {page.revision} · {page.quality.warningCount} readability warnings · {page.quality.errorCount} structure errors</p>
        <p className="text-xs text-on-surface-variant">Readability thresholds: 20 characters/second, 42 characters/line, 2 lines, minimum 500 ms duration. Warnings do not automatically change text or timing. Session expires {new Date(page.expiresAt).toLocaleString()}.</p>
        <div className="flex flex-wrap gap-2"><Button disabled={locked || dirty} onClick={() => void download()}>Download translation</Button><Button disabled={locked || dirty} onClick={() => void run(() => reload(page.id, offset))}>Reload</Button></div>
        {page.libraryMediaId && <div className="space-y-2 border-t border-outline-variant/30 pt-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={overwrite} disabled={locked} onChange={event => setOverwrite(event.target.checked)} />Allow overwriting an existing target-language sidecar</label><Button disabled={locked || dirty} onClick={() => void run(async () => {
          if (!window.confirm('Save this reviewed translation to the library? This writes a sidecar file and translation history.')) return;
          try {
            await apiPost(`${workspacePath(page.id)}/save-library`, { expectedRevision: page.revision, overwrite });
          } catch (error) {
            // A 409 here can also mean the sidecar exists; that is not a revision conflict.
            if (error instanceof ApiError && error.status === 409 && /already exists/i.test(error.message)) {
              showError('A subtitle already exists at the library destination. Enable overwrite to replace it.');
              return;
            }
            throw error;
          }
          success('Translation saved to library.');
        })}>Save to library</Button></div>}
        {!page.libraryMediaId && <p className="text-xs text-on-surface-variant">Library saving is available only for workspaces opened from a library item. Uploaded/quick files can be downloaded.</p>}
      </section>
      <details className="rounded-xl border border-outline-variant/30 p-4"><summary className="cursor-pointer font-semibold">Edit context sheet</summary><div className="mt-3 space-y-3"><p className="text-sm text-on-surface-variant">Describe story, speaker voices, terminology and style. Context is sent with selected-cue retranslation; no additional AI call is made when saving it.</p><textarea aria-label="Context sheet" maxLength={12000} className={`${inputClass} min-h-36`} value={context} disabled={locked} onChange={event => setContext(event.target.value)} /><Button disabled={locked || !dirty} onClick={() => void saveChanges()}>Save context and cue changes</Button></div></details>
      <section className="rounded-xl border border-outline-variant/30 p-4 space-y-4">
        <h2 className="font-semibold">Selected cues ({selected.size}/{REVIEW_SELECTION_LIMIT})</h2>
        <div className="grid gap-4 md:grid-cols-2"><ProviderModelPicker provider={picker.provider} model={picker.model} onProviderChange={picker.setProvider} onModelChange={picker.setModel} disabled={locked} /><div className="space-y-3">
          <p className="text-sm text-on-surface-variant">Retranslation uses saved provider credentials, the context sheet and neighboring cues. Selection uses cue position, not the subtitle display index. Save or discard edits before starting.</p>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={budgetOverride} disabled={locked} onChange={event => setBudgetOverride(event.target.checked)} />Explicitly allow this operation to exceed the configured pay-as-you-go budget (does not disable provider quota limits).</label>
          <Button variant="primary" disabled={locked || dirty || !selected.size || !picker.settings || !!picker.error} onClick={() => void retranslate()}>Retranslate selected cues</Button>
        </div></div>
        {operationId && <div role="status" className="space-y-2"><p>{operation ? `${operation.status} — ${operation.progressPercent}%` : 'Retranslation queued…'}</p><progress className="w-full" max={100} value={operation?.progressPercent ?? 0} aria-label="Retranslation progress" /><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void run(async () => {
          await apiDelete(`${workspacePath(page.id)}/operations/${encodeURIComponent(operationId)}`); setPollAttempt(value => value + 1);
        })}>Cancel retranslation</Button>{pollFailure && <Button onClick={() => setPollAttempt(value => value + 1)}>Reconnect status</Button>}</div>{pollFailure && <p role="alert" className="text-error">{pollFailure}. Do not resubmit; reconnect to the accepted operation.</p>}</div>}
        <div className="border-t border-outline-variant/30 pt-3 space-y-2"><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={approved} disabled={locked || dirty} onChange={event => setApproved(event.target.checked)} />I have reviewed the selected translations and explicitly approve storing them in translation memory.</label><p className="text-xs text-on-surface-variant">AI output is never approved automatically. Reuse requires exact source, neighboring context, languages and style; ambiguous matches are not automatically applied.</p><Button disabled={locked || dirty || !approved || !selected.size} onClick={() => void run(async () => {
          const result = await apiPost<{ approved: number }>(`${workspacePath(page.id)}/approve-memory`, { expectedRevision: page.revision, cueIndices: [...selected], approved: true });
          success(`${result.approved} cue(s) approved to translation memory.`); setApproved(false);
        })}>Approve selected to memory</Button></div>
      </section>
      <section className="space-y-3" aria-label="Subtitle cue comparison">
        <div className="flex flex-wrap gap-2 items-center"><Button disabled={locked || !dirty} onClick={() => void saveChanges()}>Save changes ({edits.length} cue edit(s))</Button><Button disabled={locked || !dirty} onClick={() => { setDrafts({}); setContext(page.contextSheet); }}>Discard unsaved edits</Button><Button disabled={locked || !selected.size} onClick={() => { setSelected(new Set()); setApproved(false); }}>Clear selection</Button><Button disabled={locked} onClick={() => { setSelected(previous => {
          const next = new Set(previous); for (const cue of page.cues) { if (next.size >= REVIEW_SELECTION_LIMIT) break; next.add(cue.cueIndex); } return next;
        }); setApproved(false); }}>Select this page</Button></div>
        {dirty && <p role="status" className="text-sm text-warning">Unsaved changes. Save or discard cue/context edits before paging, retranslation, approval or export.</p>}
        {page.cues.map(cue => <ReviewCueEditor key={cue.cueIndex} ordinal={cue.cueIndex} displayIndex={cue.index} timing={`${cue.start} → ${cue.end}`} source={cue.source} text={drafts[cue.cueIndex] ?? cue.text} selected={selected.has(cue.cueIndex)} disabled={locked} issues={cue.issues} metrics={`${cue.charsPerSecond.toFixed(1)} chars/s · line lengths ${cue.lineLengths.join(', ')}`} onSelect={() => { setSelected(previous => toggleReviewCue(previous, cue.cueIndex)); setApproved(false); }} onChange={text => { setDrafts(previous => ({ ...previous, [cue.cueIndex]: text })); setApproved(false); }} />)}
        <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Cue pages"><Button disabled={locked || dirty || offset === 0} onClick={() => void navigatePage(Math.max(0, offset - REVIEW_PAGE_SIZE))}>Previous</Button><span className="text-sm">{page.cueCount ? offset + 1 : 0}–{Math.min(offset + page.cues.length, page.cueCount)} of {page.cueCount}</span><Button disabled={locked || dirty || offset + page.cues.length >= page.cueCount} onClick={() => void navigatePage(offset + REVIEW_PAGE_SIZE)}>Next</Button></nav>
      </section>
    </>}
    <ReviewMemory />
  </main>;
}
