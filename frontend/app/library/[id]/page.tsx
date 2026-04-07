'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiGet, apiPost, API_URL } from '@/lib/api';
import { type JobResult, type MediaItem, type RuleEvaluation } from '@/lib/types';
import { COMMON_LANGUAGES } from '@/lib/languages';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress-bar';
import { useToast } from '@/components/ui/toast';

interface ItemDetail extends MediaItem { rules: RuleEvaluation[]; }

interface LiveEvent {
  phase: string;
  progressPercent: number;
  message: string;
  timestamp: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  return 'just now';
}

function formatElapsedMs(ms: number): string {
  if (ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function itemJobEtaLabel(job: JobResult, progressPct: number, nowMs: number): string | null {
  if (job.state !== 'active' && job.state !== 'waiting') return null;
  const start = job.processedAt ?? job.createdAt;
  if (!start) return null;
  if (progressPct < 3 || progressPct > 97) return null;
  const elapsed = nowMs - start;
  if (elapsed < 2000) return null;
  const eta = elapsed * (100 / progressPct - 1);
  if (!Number.isFinite(eta) || eta < 0 || eta > 72 * 3600 * 1000) return null;
  return `≈ ${formatElapsedMs(eta)} restantes`;
}

function tryNotifyJobFinish(title: string, body: string) {
  if (typeof document === 'undefined') return;
  if (document.visibilityState === 'visible') return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body });
  } catch {
    /* ignore */
  }
}

export default function LibraryItemPage() {
  const params = useParams<{ id: string }>();
  const { success: toastSuccess, error: toastError } = useToast();

  const [item, setItem]         = useState<ItemDetail | null>(null);
  const [jobs, setJobs]         = useState<JobResult[]>([]);
  const [loading, setLoading]   = useState(true);
  const [queuing, setQueuing]   = useState(false);

  const [sourceTrackIndex, setSourceTrackIndex] = useState<number | null>(null);
  const [sourceLanguage, setSourceLanguage]     = useState('eng');
  const [targetLanguage, setTargetLanguage]     = useState('spa');
  const [forceBypass, setForceBypass]           = useState(false);
  const [provider, setProvider]                 = useState<'openrouter' | 'deepseek'>('openrouter');
  const [targetConflictResolution, setTargetConflictResolution] = useState<
    'default' | 'replace' | 'alternate'
  >('default');
  const [liveJobEvent, setLiveJobEvent] = useState<LiveEvent | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [liveRules, setLiveRules] = useState<RuleEvaluation[] | null>(null);
  const rulesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [itemRes, jobsRes] = await Promise.all([
        apiGet<ItemDetail>(`/library/${params.id}`),
        apiGet<JobResult[]>('/jobs'),
      ]);
      setItem(itemRes);
      setLiveRules(itemRes.rules);
      const firstTrack = itemRes.subtitleTracks[0];
      setSourceTrackIndex(firstTrack?.index ?? null);
      setSourceLanguage(firstTrack?.language ?? 'eng');
      setJobs(jobsRes.filter(j => j.data.mediaItemId === params.id));
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to load media item');
    } finally {
      setLoading(false);
    }
  }, [params.id, toastError]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setTargetConflictResolution('default');
  }, [targetLanguage]);

  // Re-evaluate rules whenever the user changes source/target language or conflict
  // resolution so the Rules Check panel and the blocked state stay accurate.
  useEffect(() => {
    if (!item) return;
    if (rulesDebounceRef.current) clearTimeout(rulesDebounceRef.current);
    rulesDebounceRef.current = setTimeout(() => {
      const params_qs = new URLSearchParams({
        sourceLanguage,
        targetLanguage,
        targetConflictResolution,
      });
      void apiGet<ItemDetail>(`/library/${params.id}?${params_qs.toString()}`)
        .then(res => setLiveRules(res.rules))
        .catch(() => { /* keep last known rules on error */ });
    }, 300);
    return () => {
      if (rulesDebounceRef.current) clearTimeout(rulesDebounceRef.current);
    };
  }, [item, params.id, sourceLanguage, targetLanguage, targetConflictResolution]);

  const activeRules = liveRules ?? item?.rules ?? [];

  const isBlocked = useMemo(() => {
    return activeRules.some(rule => {
      if (!rule.skip) return false;
      if (
        targetConflictResolution !== 'default' &&
        (rule.id === 'already-has-external-subtitle' ||
          rule.id === 'already-has-target-subtitle')
      ) {
        return false;
      }
      return true;
    });
  }, [activeRules, targetConflictResolution]);

  const hasTargetLanguageConflict = useMemo(
    () =>
      activeRules.some(
        r =>
          r.skip &&
          (r.id === 'already-has-external-subtitle' ||
            r.id === 'already-has-target-subtitle'),
      ),
    [activeRules],
  );

  const activeJobForItem = useMemo(
    () =>
      jobs.find(
        j =>
          j.data.mediaItemId === params.id &&
          (j.state === 'active' || j.state === 'waiting'),
      ) ?? null,
    [jobs, params.id],
  );

  useEffect(() => {
    if (!activeJobForItem) {
      setLiveJobEvent(null);
      return;
    }
    const src = new EventSource(`${API_URL}/jobs/${activeJobForItem.id}/stream`);
    src.onmessage = (ev) => {
      const payload = JSON.parse(ev.data) as LiveEvent;
      setLiveJobEvent(payload);
      const ph = payload.phase.toLowerCase();
      if (ph === 'completed') {
        tryNotifyJobFinish('Traducción lista', payload.message || 'Completado');
        void load();
      }
      if (ph === 'failed') {
        tryNotifyJobFinish('Traducción fallida', payload.message || 'Error');
        void load();
      }
    };
    src.onerror = () => {
      src.close();
    };
    return () => src.close();
  }, [activeJobForItem?.id, load]);

  useEffect(() => {
    if (!activeJobForItem) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeJobForItem?.id]);

  const queue = async () => {
    if (!item || sourceTrackIndex === null) return;
    setQueuing(true);
    try {
      await apiPost('/jobs', {
        mediaItemId: item.id,
        mediaItemPath: item.path,
        sourceLanguage,
        targetLanguage,
        sourceTrackIndex,
        triggeredBy: 'manual',
        forceBypassRules: forceBypass,
        provider,
        targetConflictResolution:
          targetConflictResolution === 'default'
            ? undefined
            : targetConflictResolution,
      });
      toastSuccess('Translation job queued');
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        void Notification.requestPermission();
      }
      await load();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to queue job');
    } finally {
      setQueuing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-on-surface-variant">
          <span className="material-symbols-outlined text-[20px] animate-spin">progress_activity</span>
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <EmptyState
        icon="error"
        title="Media item not found"
        description="This item may have been removed or the library rescanned."
        action={<Link href="/" className="btn btn-secondary btn-sm">Back to Library</Link>}
      />
    );
  }

  return (
    <section className="space-y-6">
      {/* Breadcrumbs */}
      <Breadcrumbs
        items={[
          { label: 'Library', href: '/' },
          { label: item.name },
        ]}
      />

      {/* File Info Header */}
      <div className="bg-surface-container rounded-lg p-5">
        <div className="flex items-start gap-3">
          <span
            className="material-symbols-outlined text-[28px] text-on-surface-variant mt-0.5 flex-shrink-0"
            style={{ fontVariationSettings: 'FILL 0' }}
          >
            {item.type === 'movie' ? 'movie' : item.type === 'episode' ? 'tv_gen' : 'video_file'}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-on-surface leading-tight break-words">{item.name}</h1>
            <p className="mt-1 text-xs font-mono text-on-surface-variant break-all">{item.path}</p>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-on-surface-variant">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">storage</span>
                {formatBytes(item.size)}
              </span>
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">schedule</span>
                {formatRelative(item.lastModified)}
              </span>
              <Badge variant="neutral">{item.type}</Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* LEFT: Tracks */}
        <div className="lg:col-span-5 space-y-5">

          {/* Embedded tracks */}
          <div className="bg-surface-container rounded-lg p-5 space-y-3">
            <h2 className="text-sm font-semibold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-on-surface-variant">subtitles</span>
              Subtitle Tracks
            </h2>
            {item.subtitleTracks.length === 0 ? (
              <p className="text-xs text-on-surface-variant">No embedded subtitle tracks found</p>
            ) : (
              <div className="space-y-2">
                {item.subtitleTracks.map(track => {
                  const active = sourceTrackIndex === track.index;
                  return (
                    <label
                      key={track.index}
                      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                        active
                          ? 'bg-primary/10 border border-primary/30 text-on-surface'
                          : 'bg-surface-container-high border border-transparent hover:border-outline-variant/30 text-on-surface-variant'
                      }`}
                    >
                      <input
                        type="radio"
                        checked={active}
                        onChange={() => {
                          setSourceTrackIndex(track.index);
                          setSourceLanguage(track.language);
                        }}
                        className="h-4 w-4 accent-primary"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono font-semibold">
                            #{track.index} · {track.language.toUpperCase()}
                          </span>
                          <span className="text-[10px] text-on-surface-variant font-mono bg-surface-container px-1.5 py-0.5 rounded">
                            {track.codec}
                          </span>
                        </div>
                        {track.title && (
                          <p className="text-xs text-on-surface-variant mt-0.5 truncate">{track.title}</p>
                        )}
                      </div>
                      {active && (
                        <span className="material-symbols-outlined text-[18px] text-primary flex-shrink-0" style={{ fontVariationSettings: 'FILL 1' }}>
                          radio_button_checked
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* External subtitles */}
          {item.externalSubtitles.length > 0 && (
            <div className="bg-surface-container rounded-lg p-5 space-y-3">
              <h2 className="text-sm font-semibold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant">file_present</span>
                External Subtitles
              </h2>
              <ul className="space-y-1.5">
                {item.externalSubtitles.map(sub => (
                  <li
                    key={sub.path}
                    className="flex items-center gap-2 bg-surface-container-high rounded px-3 py-2"
                  >
                    <span className="text-[10px] font-mono font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded flex-shrink-0">
                      {sub.language.toUpperCase()}{sub.forced ? ' F' : ''}
                    </span>
                    <span className="text-xs font-mono text-on-surface-variant truncate" title={sub.path}>
                      {sub.path.split(/[\\/]/).pop()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* RIGHT: Translation Controls */}
        <div className="lg:col-span-7 space-y-5">

          {/* Translation Pipeline */}
          <div className="bg-surface-container rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-semibold text-on-surface">Queue Translation</h2>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="field-label">Source Language</label>
                <div className="relative">
                  <select
                    value={sourceLanguage}
                    onChange={e => {
                      const lang = e.target.value;
                      setSourceLanguage(lang);
                      const track = item.subtitleTracks.find(t => t.language === lang);
                      if (track) setSourceTrackIndex(track.index);
                    }}
                    className="w-full engraved-input text-sm px-3 py-2.5 pr-8 appearance-none cursor-pointer"
                  >
                    {Array.from(new Set(item.subtitleTracks.map(t => t.language))).map(lang => (
                      <option key={lang} value={lang}>{lang.toUpperCase()}</option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant pointer-events-none">expand_more</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="field-label">Target Language</label>
                <div className="relative">
                  <select
                    value={targetLanguage}
                    onChange={e => setTargetLanguage(e.target.value)}
                    className="w-full engraved-input text-sm px-3 py-2.5 pr-8 appearance-none cursor-pointer"
                  >
                    {COMMON_LANGUAGES.map(l => (
                      <option key={l.code} value={l.code}>{l.name} ({l.code})</option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant pointer-events-none">expand_more</span>
                </div>
              </div>
            </div>

            {/* Provider */}
            <div className="flex items-center gap-3">
              <label className="field-label flex-shrink-0">Provider</label>
              <div className="flex gap-2">
                {(['openrouter', 'deepseek'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setProvider(p)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      provider === p
                        ? 'bg-primary/10 text-primary border border-primary/30'
                        : 'bg-surface-container-high text-on-surface-variant border border-outline-variant/30 hover:text-on-surface'
                    }`}
                  >
                    {p === 'openrouter' ? 'OpenRouter (Free)' : 'DeepSeek (Paid)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Target file already exists */}
            {hasTargetLanguageConflict && (
              <div className="rounded-lg border border-outline-variant/30 bg-surface-container-high p-4 space-y-2">
                <p className="text-xs font-semibold text-on-surface">
                  Ya hay subtítulo en el idioma de destino
                </p>
                <p className="text-[11px] text-on-surface-variant leading-relaxed">
                  Elige si quieres sobrescribir el archivo existente o guardar una segunda pista como{' '}
                  <span className="font-mono text-on-surface">.{targetLanguage}.2.srt</span> /{' '}
                  <span className="font-mono text-on-surface">.{targetLanguage}.2.ass</span>.
                </p>
                <div className="flex flex-col gap-2 pt-1">
                  {(
                    [
                      ['default', 'Respetar reglas (no colar si está bloqueado)'],
                      ['replace', 'Sobrescribir el subtítulo existente'],
                      ['alternate', 'Crear segundo archivo (.lang.2.ext)'],
                    ] as const
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className="flex items-start gap-2 cursor-pointer text-xs text-on-surface"
                    >
                      <input
                        type="radio"
                        name="targetConflict"
                        checked={targetConflictResolution === value}
                        onChange={() => setTargetConflictResolution(value)}
                        className="mt-0.5 accent-primary"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Rules Check */}
            <div className="bg-surface-container-high rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-on-surface">Rules Check</h3>
                {isBlocked && <Badge variant="warning" icon="warning">Blocked</Badge>}
                {!isBlocked && <Badge variant="success" icon="check">All pass</Badge>}
              </div>
              <div className="space-y-1.5">
                {activeRules.map(rule => (
                  <div
                    key={rule.id}
                    className="flex items-start gap-2.5 py-1.5"
                  >
                    <span
                      className={`material-symbols-outlined text-[16px] flex-shrink-0 mt-0.5 ${rule.skip ? 'text-error' : 'text-success'}`}
                      style={{ fontVariationSettings: 'FILL 1' }}
                    >
                      {rule.skip ? 'cancel' : 'check_circle'}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-on-surface">{rule.label}</p>
                      {rule.skip && rule.reason && (
                        <p className="text-xs text-error mt-0.5">{rule.reason}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Force bypass */}
            {isBlocked && (
              <label className="flex items-center gap-3 p-3 rounded-lg bg-warning/8 border border-warning/20 cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceBypass}
                  onChange={e => setForceBypass(e.target.checked)}
                  className="h-4 w-4 accent-primary rounded"
                />
                <div>
                  <p className="text-sm font-medium text-warning">Force bypass rules</p>
                  <p className="text-xs text-on-surface-variant">Override all rule checks and queue anyway</p>
                </div>
              </label>
            )}

            {/* Queue button */}
            <Button
              variant="primary"
              loading={queuing}
              disabled={
                item.subtitleTracks.length === 0 ||
                (isBlocked && !forceBypass)
              }
              iconLeft={queuing ? undefined : 'send'}
              onClick={() => void queue()}
              className="w-full justify-center"
            >
              {queuing ? 'Queuing…' : 'Queue Translation'}
            </Button>

            {item.subtitleTracks.length === 0 && (
              <p className="text-xs text-on-surface-variant text-center">
                No subtitle tracks available — cannot queue translation
              </p>
            )}
          </div>
        </div>
      </div>

      {activeJobForItem && (
        <div className="bg-surface-container rounded-lg p-5 space-y-3 border border-primary/20">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-primary animate-pulse">
                progress_activity
              </span>
              Job en curso
            </h2>
            <Link
              href="/jobs"
              className="text-xs text-primary hover:text-primary/80 transition-colors"
            >
              Ver cola
            </Link>
          </div>
          <p className="text-xs font-mono text-on-surface-variant break-all">{activeJobForItem.id}</p>
          <div className="space-y-1">
            <ProgressBar
              value={liveJobEvent?.progressPercent ?? Number(activeJobForItem.progress ?? 0)}
              showLabel
            />
            {(() => {
              const p = liveJobEvent?.progressPercent ?? Number(activeJobForItem.progress ?? 0);
              const eta = itemJobEtaLabel(activeJobForItem, p, nowTick);
              return eta ? (
                <p className="text-[11px] font-mono text-on-surface-variant">{eta}</p>
              ) : null;
            })()}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="primary">
              {liveJobEvent?.phase ?? activeJobForItem.state}
            </Badge>
            {liveJobEvent?.message && (
              <span className="text-xs text-on-surface-variant truncate max-w-full">
                {liveJobEvent.message}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Job History */}
      <div className="bg-surface-container rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-on-surface">Job History</h2>
          <Link href="/jobs" className="text-xs text-primary hover:text-primary/70 transition-colors flex items-center gap-1">
            View all jobs
            <span className="material-symbols-outlined text-[14px]">open_in_new</span>
          </Link>
        </div>

        {jobs.length === 0 ? (
          <p className="text-sm text-on-surface-variant py-4 text-center">No jobs found for this item.</p>
        ) : (
          <div className="space-y-2">
            {jobs.map(job => (
              <div
                key={String(job.id)}
                className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-3 rounded-lg bg-surface-container-high"
              >
                {/* Timeline dot */}
                <div className="hidden sm:flex flex-col items-center gap-1 flex-shrink-0">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      job.state === 'completed' ? 'bg-success' :
                      job.state === 'failed'    ? 'bg-error'   :
                      job.state === 'active'    ? 'bg-primary animate-pulse' :
                      'bg-warning'
                    }`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-on-surface-variant">#{job.id}</span>
                    <span className="text-xs text-on-surface font-medium">
                      {job.data.sourceLanguage.toUpperCase()} → {job.data.targetLanguage.toUpperCase()}
                    </span>
                    {job.returnValue && (
                      <span className="text-xs text-on-surface-variant font-mono">
                        {(job.returnValue.usage.totalTokens / 1000).toFixed(1)}k tokens · {job.returnValue.tierUsed}
                      </span>
                    )}
                    {job.createdAt && (
                      <span className="text-xs text-on-surface-variant">
                        {formatRelative(new Date(job.createdAt).toISOString())}
                      </span>
                    )}
                  </div>
                  {job.state === 'failed' && job.failedReason && (
                    <p className="text-xs text-error mt-1 truncate">{job.failedReason}</p>
                  )}
                </div>
                <Badge
                  variant={
                    job.state === 'completed' ? 'success' :
                    job.state === 'failed'    ? 'error'   :
                    job.state === 'active'    ? 'primary' : 'warning'
                  }
                >
                  {job.state}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
