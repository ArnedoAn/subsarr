'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import type { MediaItem, SubtitleSyncConflictResolution, SubtitleSyncReferenceMode, SubtitleSyncTask } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui/progress-bar';
import { useToast } from '@/components/ui/toast';
import { LanguageCombobox } from '@/components/language-combobox';

const TEXT_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']);
const MAX_OFFSETS = [60, 120, 300, 600] as const;

function describeReference(task: SubtitleSyncTask): string {
  if (!task.reference) return 'Pending reference';
  return task.reference.kind === 'audio'
    ? 'Audio speech'
    : `Embedded track #${task.reference.trackIndex} (${task.reference.language.toUpperCase()})`;
}

function formatOffset(seconds: number): string {
  return `${seconds >= 0 ? '+' : ''}${seconds.toFixed(2)} s`;
}

export function SubtitleSyncPanel({ item, onCompleted }: { item: MediaItem; onCompleted: () => void }) {
  const { success: toastSuccess, error: toastError } = useToast();
  const textTracks = item.subtitleTracks.filter(track => TEXT_CODECS.has(track.codec.toLowerCase()));

  const [source, setSource] = useState<'upload' | 'sidecar'>(item.externalSubtitles.length ? 'sidecar' : 'upload');
  const [file, setFile] = useState<File | null>(null);
  const [sidecarPath, setSidecarPath] = useState(item.externalSubtitles[0]?.path ?? '');
  const [language, setLanguage] = useState(item.externalSubtitles[0]?.language ?? 'spa');
  const [forced, setForced] = useState(item.externalSubtitles[0]?.forced ?? false);
  const [reference, setReference] = useState<SubtitleSyncReferenceMode>('auto');
  const [referenceTrackIndex, setReferenceTrackIndex] = useState<number | null>(textTracks[0]?.index ?? null);
  const [allowSplits, setAllowSplits] = useState(false);
  const [maxOffsetSeconds, setMaxOffsetSeconds] = useState<number>(60);
  const [conflict, setConflict] = useState<SubtitleSyncConflictResolution>('fail');
  const [starting, setStarting] = useState(false);
  const [tasks, setTasks] = useState<SubtitleSyncTask[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Tasks seen queued/running here; only their transitions are announced, not history loaded on mount.
  const watched = useRef(new Set<string>());

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await apiGet<{ tasks: SubtitleSyncTask[] }>(`/subtitle-sync?mediaItemId=${encodeURIComponent(item.id)}`, { signal });
      setTasks(result.tasks);
      setListError(null);
      for (const task of result.tasks) {
        if (task.state === 'queued' || task.state === 'running') { watched.current.add(task.id); continue; }
        if (!watched.current.delete(task.id)) continue;
        if (task.state === 'completed') { toastSuccess(`Subtitle synchronized: ${task.result?.outputPath.split(/[\\/]/).pop() ?? task.inputName}`); onCompleted(); }
        else if (task.state === 'failed') toastError(task.error ?? 'Subtitle sync failed');
      }
    } catch (reason) {
      if (!signal?.aborted) setListError(reason instanceof Error ? reason.message : 'Sync tasks unavailable');
    }
  }, [item.id, onCompleted, toastError, toastSuccess]);

  const busy = tasks.some(task => task.state === 'queued' || task.state === 'running');
  useEffect(() => {
    const abort = new AbortController();
    void refresh(abort.signal);
    if (!busy) return () => abort.abort();
    const timer = setInterval(() => void refresh(abort.signal), 1500);
    return () => { clearInterval(timer); abort.abort(); };
  }, [refresh, busy]);

  const chooseSidecar = (path: string) => {
    setSidecarPath(path);
    const sidecar = item.externalSubtitles.find(entry => entry.path === path);
    if (sidecar) { setLanguage(sidecar.language); setForced(sidecar.forced); }
  };

  const start = async () => {
    const form = new FormData();
    form.set('mediaItemId', item.id);
    if (source === 'upload') { if (!file) return; form.set('file', file); }
    else form.set('sidecarPath', sidecarPath);
    form.set('language', language);
    form.set('forced', String(forced));
    form.set('reference', reference);
    if (reference === 'track' && referenceTrackIndex !== null) form.set('referenceTrackIndex', String(referenceTrackIndex));
    form.set('allowSplits', String(allowSplits));
    form.set('maxOffsetSeconds', String(maxOffsetSeconds));
    form.set('conflict', conflict);
    setStarting(true);
    try {
      await apiPost<SubtitleSyncTask>('/subtitle-sync', form);
      toastSuccess('Subtitle sync queued');
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await refresh();
    } catch (reason) {
      toastError(reason instanceof Error ? reason.message : 'Failed to start subtitle sync');
    } finally {
      setStarting(false);
    }
  };

  const cancel = async (id: string) => {
    try { await apiPost(`/subtitle-sync/${encodeURIComponent(id)}/cancel`); await refresh(); }
    catch (reason) { toastError(reason instanceof Error ? reason.message : 'Failed to cancel sync'); }
  };

  const canStart = item.probeStatus === 'ok' && !starting &&
    (source === 'upload' ? !!file : !!sidecarPath) &&
    (reference !== 'track' || referenceTrackIndex !== null);

  return (
    <div className="bg-surface-container rounded-lg p-5 space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-on-surface flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-on-surface-variant">sync</span>
          Sync Subtitle to This Video
        </h2>
        <p className="text-[11px] text-on-surface-variant leading-relaxed">
          Re-time a subtitle made for another release: fixes constant offsets and framerate drift, and optionally cuts in the middle.
        </p>
      </div>

      <div className="flex gap-4 text-xs text-on-surface">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="radio" name="syncSource" className="accent-primary" checked={source === 'upload'} onChange={() => setSource('upload')} />
          Upload file
        </label>
        <label className={`flex items-center gap-2 ${item.externalSubtitles.length ? 'cursor-pointer' : 'opacity-50'}`}>
          <input type="radio" name="syncSource" className="accent-primary" disabled={!item.externalSubtitles.length} checked={source === 'sidecar'} onChange={() => setSource('sidecar')} />
          Existing external subtitle
        </label>
      </div>

      {source === 'upload' ? (
        <input
          ref={fileInput}
          type="file"
          accept=".srt,.ass,.ssa,.vtt"
          aria-label="Subtitle file to synchronize"
          onChange={event => setFile(event.target.files?.[0] ?? null)}
          className="block w-full text-xs text-on-surface-variant file:btn file:btn-secondary file:btn-sm file:mr-3"
        />
      ) : (
        <select
          value={sidecarPath}
          onChange={event => chooseSidecar(event.target.value)}
          aria-label="External subtitle to synchronize"
          className="w-full engraved-input text-sm px-3 py-2.5 cursor-pointer"
        >
          {item.externalSubtitles.map(sub => (
            <option key={sub.path} value={sub.path}>{sub.path.split(/[\\/]/).pop()}</option>
          ))}
        </select>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <span className="field-label">Subtitle language</span>
          <LanguageCombobox value={language} onChange={setLanguage} ariaLabel="Subtitle language" disabled={starting} />
        </div>
        <div className="space-y-1.5">
          <label className="field-label" htmlFor="sync-reference">Timing reference</label>
          <select
            id="sync-reference"
            value={reference === 'track' ? `track:${referenceTrackIndex}` : reference}
            onChange={event => {
              const value = event.target.value;
              if (value.startsWith('track:')) { setReference('track'); setReferenceTrackIndex(Number(value.slice(6))); }
              else setReference(value as SubtitleSyncReferenceMode);
            }}
            className="w-full engraved-input text-sm px-3 py-2.5 cursor-pointer"
          >
            <option value="auto">Auto ({textTracks.length ? 'embedded text track' : 'audio'})</option>
            <option value="audio">Audio speech (slower)</option>
            {textTracks.map(track => (
              <option key={track.index} value={`track:${track.index}`}>
                Track #{track.index} · {track.language.toUpperCase()}{track.title ? ` · ${track.title}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="field-label" htmlFor="sync-max-offset">Max offset</label>
          <select id="sync-max-offset" value={maxOffsetSeconds} onChange={event => setMaxOffsetSeconds(Number(event.target.value))} className="w-full engraved-input text-sm px-3 py-2.5 cursor-pointer">
            {MAX_OFFSETS.map(value => <option key={value} value={value}>{value} s</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="field-label" htmlFor="sync-conflict">If the output exists</label>
          <select id="sync-conflict" value={conflict} onChange={event => setConflict(event.target.value as SubtitleSyncConflictResolution)} className="w-full engraved-input text-sm px-3 py-2.5 cursor-pointer">
            <option value="fail">Do not overwrite</option>
            <option value="replace">Replace (keeps a history copy)</option>
            <option value="alternate">Write .{language}.2 file</option>
          </select>
        </div>
      </div>

      <div className="space-y-2 text-xs text-on-surface">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={forced} onChange={event => setForced(event.target.checked)} />
          Forced subtitle
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" className="h-4 w-4 mt-0.5 accent-primary" checked={allowSplits} onChange={event => setAllowSplits(event.target.checked)} />
          <span>Allow mid-file cuts <span className="text-on-surface-variant">(ad breaks, director&apos;s cut, joined discs)</span></span>
        </label>
      </div>

      <Button variant="primary" loading={starting} disabled={!canStart} iconLeft={starting ? undefined : 'sync'} onClick={() => void start()} className="w-full justify-center">
        {starting ? 'Starting…' : 'Synchronize'}
      </Button>
      {item.probeStatus !== 'ok' && <p className="text-xs text-on-surface-variant text-center">Available once the media file is probed.</p>}

      {listError && <p role="alert" className="text-error text-xs">{listError}</p>}
      {tasks.length > 0 && (
        <ul className="space-y-2">
          {tasks.map(task => (
            <li key={task.id} className="rounded-lg bg-surface-container-high p-3 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono text-on-surface truncate max-w-full" title={task.inputName}>{task.inputName}</span>
                <Badge variant={task.state === 'completed' ? 'success' : task.state === 'failed' ? 'error' : task.state === 'cancelled' ? 'neutral' : 'primary'}>{task.state}</Badge>
                {(task.state === 'queued' || task.state === 'running') && (
                  <Button size="xs" variant="ghost" onClick={() => void cancel(task.id)}>Cancel</Button>
                )}
              </div>
              <p className="text-[11px] text-on-surface-variant">{describeReference(task)} · {task.message}</p>
              {task.state === 'running' && task.progressPercent !== null && <ProgressBar value={task.progressPercent} showLabel />}
              {task.result && (
                <p className="text-[11px] font-mono text-on-surface-variant break-all">
                  {formatOffset(task.result.offsetSeconds)}
                  {task.result.framerateScaleFactor !== 1 ? ` · fps ×${task.result.framerateScaleFactor.toFixed(4)}` : ''}
                  {task.allowSplits ? ' · cuts allowed' : ''} · {task.result.cueCount} cues → {task.result.outputPath}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
