'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiPost } from '@/lib/api';
import { COMMON_LANGUAGES } from '@/lib/languages';
import {
  type BatchEnqueueResultItem,
  type BatchPreviewRow,
  type MediaItem,
  type MediaItemWithRuleStatus,
} from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function parentDir(path: string): string {
  const n = normalizePath(path);
  const i = n.lastIndexOf('/');
  return i <= 0 ? '' : n.slice(0, i);
}

function commonPathPrefix(paths: string[]): string {
  if (paths.length === 0) return '';
  const split = paths.map((p) => normalizePath(p).split('/').filter(Boolean));
  const first = split[0];
  if (!first?.length) return '';
  let len = 0;
  for (let i = 0; i < first.length; i += 1) {
    if (split.every((s) => s[i] === first[i])) len = i + 1;
    else break;
  }
  return first.slice(0, len).join('/');
}

function trackSignature(item: MediaItem): string {
  const langs = [...new Set(item.subtitleTracks.map((t) => t.language))].sort();
  return langs.length ? langs.join(', ') : '—';
}

function dominantTrackSignature(items: MediaItem[]): string | null {
  const counts = new Map<string, number>();
  for (const it of items) {
    if (it.subtitleTracks.length === 0) continue;
    const s = trackSignature(it);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [s, c] of counts) {
    if (c > n) {
      n = c;
      best = s;
    }
  }
  return best;
}

function itemHasTargetLangPresent(item: MediaItem, targetLang: string): boolean {
  const t = targetLang.toLowerCase();
  return (
    item.subtitleTracks.some((x) => x.language === t) ||
    item.externalSubtitles.some((x) => x.language === t)
  );
}

const STATUS_LABEL: Record<BatchPreviewRow['status'], string> = {
  ready: 'Listo',
  no_source_track: 'Sin pista origen',
  rule_blocked: 'Bloqueado (reglas)',
  not_found: 'No encontrado',
  error: 'Error',
};

export function BatchQueueModal({
  open,
  onClose,
  items,
  initialSource,
  initialTarget,
  initialProvider,
  onEnqueued,
}: {
  open: boolean;
  onClose: () => void;
  items: MediaItemWithRuleStatus[];
  initialSource: string;
  initialTarget: string;
  initialProvider: 'openrouter' | 'deepseek';
  onEnqueued?: (summary: {
    queued: number;
    failed: number;
    errors: string[];
  }) => void;
}) {
  const [sourceLanguage, setSourceLanguage] = useState(initialSource);
  const [targetLanguage, setTargetLanguage] = useState(initialTarget);
  const [provider, setProvider] = useState(initialProvider);
  const [forceBypass, setForceBypass] = useState(false);
  const [targetConflictResolution, setTargetConflictResolution] = useState<
    'default' | 'replace' | 'alternate'
  >('default');

  const [previewRows, setPreviewRows] = useState<BatchPreviewRow[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [includedReady, setIncludedReady] = useState<Record<string, boolean>>({});
  const [enqueuing, setEnqueuing] = useState(false);
  const [lastEnqueueErrors, setLastEnqueueErrors] = useState<string[]>([]);

  const itemById = useMemo(() => {
    const m = new Map<string, MediaItemWithRuleStatus>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  const prevOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (open && !wasOpen) {
      setSourceLanguage(initialSource);
      setTargetLanguage(initialTarget);
      setProvider(initialProvider);
      setForceBypass(false);
      setTargetConflictResolution('default');
      setPreviewRows(null);
      setPreviewError(null);
      setIncludedReady({});
      setLastEnqueueErrors([]);
    }
  }, [open, initialSource, initialTarget, initialProvider]);

  useEffect(() => {
    setTargetConflictResolution('default');
  }, [targetLanguage]);

  const hasTargetConflictHint = useMemo(
    () =>
      items.some((it) => itemHasTargetLangPresent(it, targetLanguage)),
    [items, targetLanguage],
  );

  const summaryTypes = useMemo(() => {
    let episode = 0;
    let movie = 0;
    let unknown = 0;
    for (const it of items) {
      if (it.type === 'episode') episode += 1;
      else if (it.type === 'movie') movie += 1;
      else unknown += 1;
    }
    return { episode, movie, unknown, total: items.length };
  }, [items]);

  const folderHint = useMemo(
    () => commonPathPrefix(items.map((i) => i.path)),
    [items],
  );

  const dominantSig = useMemo(() => dominantTrackSignature(items), [items]);
  const outlierItems = useMemo(() => {
    if (!dominantSig) return [] as MediaItemWithRuleStatus[];
    return items.filter(
      (it) =>
        it.subtitleTracks.length > 0 && trackSignature(it) !== dominantSig,
    );
  }, [items, dominantSig]);

  const fetchPreview = useCallback(async () => {
    if (items.length === 0) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const uniqueIds = [...new Set(items.map(i => i.id))];
      const body = {
        items: uniqueIds.map((mediaItemId) => ({ mediaItemId })),
        sourceLanguage,
        targetLanguage,
        forceBypassRules: forceBypass,
        targetConflictResolution:
          targetConflictResolution === 'default'
            ? undefined
            : targetConflictResolution,
      };
      const rows = await apiPost<BatchPreviewRow[]>('/jobs/batch/preview', body);
      setPreviewRows(rows);
      const nextIncluded: Record<string, boolean> = {};
      for (const r of rows) {
        if (r.status === 'ready') nextIncluded[r.mediaItemId] = true;
      }
      setIncludedReady(nextIncluded);
    } catch (e) {
      setPreviewRows(null);
      setPreviewError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  }, [
    items,
    sourceLanguage,
    targetLanguage,
    forceBypass,
    targetConflictResolution,
  ]);

  useEffect(() => {
    if (!open || items.length === 0) return;
    void fetchPreview();
  }, [open, items, fetchPreview]);

  const readySelected = useMemo(() => {
    if (!previewRows) return [];
    return previewRows.filter(
      (r) =>
        r.status === 'ready' &&
        r.sourceTrackIndex !== undefined &&
        includedReady[r.mediaItemId],
    );
  }, [previewRows, includedReady]);

  const countsByStatus = useMemo(() => {
    const c: Record<BatchPreviewRow['status'], number> = {
      ready: 0,
      no_source_track: 0,
      rule_blocked: 0,
      not_found: 0,
      error: 0,
    };
    if (!previewRows) return c;
    for (const r of previewRows) c[r.status] += 1;
    return c;
  }, [previewRows]);

  const toggleReady = (id: string) => {
    setIncludedReady((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectAllReady = () => {
    if (!previewRows) return;
    const next: Record<string, boolean> = { ...includedReady };
    for (const r of previewRows) {
      if (r.status === 'ready') next[r.mediaItemId] = true;
    }
    setIncludedReady(next);
  };

  const deselectAllReady = () => {
    if (!previewRows) return;
    const next: Record<string, boolean> = { ...includedReady };
    for (const r of previewRows) {
      if (r.status === 'ready') next[r.mediaItemId] = false;
    }
    setIncludedReady(next);
  };

  const runEnqueue = async () => {
    if (readySelected.length === 0) return;
    setEnqueuing(true);
    setLastEnqueueErrors([]);
    try {
      const results = await apiPost<BatchEnqueueResultItem[]>('/jobs/batch', {
        items: readySelected.map((r) => ({
          mediaItemId: r.mediaItemId,
          sourceTrackIndex: r.sourceTrackIndex!,
        })),
        sourceLanguage,
        targetLanguage,
        triggeredBy: 'batch',
        forceBypassRules: forceBypass,
        provider,
        targetConflictResolution:
          targetConflictResolution === 'default'
            ? undefined
            : targetConflictResolution,
      });

      const failed = results.filter((r) => r.error);
      const queued = results.length - failed.length;
      const errors = failed.map((r) => {
        const name = itemById.get(r.mediaItemId)?.name ?? r.mediaItemId;
        return `${name}: ${r.error ?? 'Unknown error'}`;
      });
      setLastEnqueueErrors(errors);
      onEnqueued?.({
        queued,
        failed: failed.length,
        errors,
      });
      if (failed.length === 0) onClose();
    } catch (e) {
      setLastEnqueueErrors([
        e instanceof Error ? e.message : 'Enqueue request failed',
      ]);
    } finally {
      setEnqueuing(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-queue-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface-container-highest border border-outline-variant/30 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-outline-variant/15">
          <div className="min-w-0">
            <h2
              id="batch-queue-title"
              className="text-lg font-semibold text-on-surface"
            >
              Revisión de lote
            </h2>
            <p className="text-xs text-on-surface-variant mt-1">
              {summaryTypes.total} archivo{summaryTypes.total !== 1 ? 's' : ''} —{' '}
              episodios {summaryTypes.episode}, películas {summaryTypes.movie}
              {summaryTypes.unknown ? `, otros ${summaryTypes.unknown}` : ''}
            </p>
            {folderHint ? (
              <p
                className="text-[11px] font-mono text-on-surface-variant mt-1 truncate"
                title={folderHint}
              >
                {folderHint}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon btn-sm flex-shrink-0"
            aria-label="Cerrar"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Opciones globales */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="field-label">Idioma origen</label>
              <div className="relative">
                <select
                  value={sourceLanguage}
                  onChange={e => setSourceLanguage(e.target.value)}
                  className="w-full engraved-input text-sm px-3 py-2.5 pr-8 appearance-none cursor-pointer"
                >
                  {COMMON_LANGUAGES.map(l => (
                    <option key={l.code} value={l.code}>
                      {l.name} ({l.code})
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant pointer-events-none">
                  expand_more
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="field-label">Idioma destino</label>
              <div className="relative">
                <select
                  value={targetLanguage}
                  onChange={e => setTargetLanguage(e.target.value)}
                  className="w-full engraved-input text-sm px-3 py-2.5 pr-8 appearance-none cursor-pointer"
                >
                  {COMMON_LANGUAGES.map(l => (
                    <option key={l.code} value={l.code}>
                      {l.name} ({l.code})
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant pointer-events-none">
                  expand_more
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <span className="field-label flex-shrink-0">Proveedor</span>
            <div className="flex gap-2">
              {(['openrouter', 'deepseek'] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    provider === p
                      ? 'bg-primary/10 text-primary border border-primary/30'
                      : 'bg-surface-container-high text-on-surface-variant border border-outline-variant/30 hover:text-on-surface'
                  }`}
                >
                  {p === 'openrouter' ? 'OpenRouter' : 'DeepSeek'}
                </button>
              ))}
            </div>
          </div>

          {hasTargetConflictHint && (
            <div className="rounded-lg border border-outline-variant/30 bg-surface-container-high p-4 space-y-2">
              <p className="text-xs font-semibold text-on-surface">
                Subtítulo en idioma de destino
              </p>
              <p className="text-[11px] text-on-surface-variant leading-relaxed">
                Al menos un archivo ya tiene pista o archivo externo en{' '}
                <span className="font-mono">{targetLanguage.toUpperCase()}</span>.
                Elige cómo resolver el conflicto.
              </p>
              <div className="flex flex-col gap-2 pt-1">
                {(
                  [
                    ['default', 'Respetar reglas (omitir si aplica)'],
                    ['replace', 'Sobrescribir subtítulo existente'],
                    ['alternate', 'Segundo archivo (.lang.2.ext)'],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className="flex items-start gap-2 cursor-pointer text-xs text-on-surface"
                  >
                    <input
                      type="radio"
                      name="batchTargetConflict"
                      checked={targetConflictResolution === value}
                      onChange={() =>
                        setTargetConflictResolution(value)
                      }
                      className="mt-0.5 accent-primary"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <label className="flex items-center gap-3 p-3 rounded-lg bg-surface-container rounded-lg border border-outline-variant/20 cursor-pointer">
            <input
              type="checkbox"
              checked={forceBypass}
              onChange={e => setForceBypass(e.target.checked)}
              className="h-4 w-4 accent-primary rounded"
            />
            <div>
              <p className="text-sm font-medium text-on-surface">
                Forzar omitir reglas
              </p>
              <p className="text-xs text-on-surface-variant">
                Encola aunque las reglas marquen bloqueo (misma semántica que en detalle de archivo).
              </p>
            </div>
          </label>

          {outlierItems.length > 0 && dominantSig && (
            <div className="rounded-lg border border-warning/25 bg-warning/8 p-3 space-y-2">
              <p className="text-xs font-semibold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-warning">
                  diversity_3
                </span>
                Perfil de pistas distinto ({outlierItems.length})
              </p>
              <p className="text-[11px] text-on-surface-variant">
                La mayoría comparte pistas:{' '}
                <span className="font-mono text-on-surface">{dominantSig}</span>.
                Estos archivos tienen otro conjunto de idiomas embebidos; revisa la tabla inferior.
              </p>
              <ul className="text-[11px] font-mono text-on-surface-variant max-h-24 overflow-y-auto space-y-0.5">
                {outlierItems.slice(0, 12).map(it => (
                  <li key={it.id} className="truncate" title={it.path}>
                    {it.name} — {trackSignature(it)}
                  </li>
                ))}
                {outlierItems.length > 12 && (
                  <li>… +{outlierItems.length - 12} más</li>
                )}
              </ul>
            </div>
          )}

          {/* Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-on-surface">
                Previsualización (servidor)
              </h3>
              {previewRows && !previewLoading && (
                <div className="flex items-center gap-2 text-[11px] text-on-surface-variant">
                  <span className="text-success">Listos {countsByStatus.ready}</span>
                  <span>·</span>
                  <span>Bloqueados {countsByStatus.rule_blocked}</span>
                  <span>·</span>
                  <span>Sin pista {countsByStatus.no_source_track}</span>
                </div>
              )}
            </div>

            {previewLoading && (
              <p className="text-sm text-on-surface-variant flex items-center gap-2 py-6">
                <span className="material-symbols-outlined text-[18px] animate-spin">
                  progress_activity
                </span>
                Analizando…
              </p>
            )}

            {previewError && (
              <p className="text-sm text-error py-2">{previewError}</p>
            )}

            {previewRows && !previewLoading && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={selectAllReady}
                    className="text-xs text-primary hover:underline"
                  >
                    Marcar todos los listos
                  </button>
                  <button
                    type="button"
                    onClick={deselectAllReady}
                    className="text-xs text-on-surface-variant hover:underline"
                  >
                    Desmarcar todos
                  </button>
                </div>

                <div className="border border-outline-variant/20 rounded-lg overflow-hidden max-h-[280px] overflow-y-auto">
                  <table className="w-full text-xs data-table">
                    <thead>
                      <tr className="bg-surface-container-low border-b border-outline-variant/15">
                        <th className="px-2 py-2 w-10 text-left" />
                        <th className="px-2 py-2 text-left">Archivo</th>
                        <th className="px-2 py-2 text-left">Estado</th>
                        <th className="px-2 py-2 text-left">Detalle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map(row => {
                        const it = itemById.get(row.mediaItemId);
                        const isReady = row.status === 'ready';
                        return (
                          <tr
                            key={row.mediaItemId}
                            className="border-b border-outline-variant/10"
                          >
                            <td className="px-2 py-2">
                              {isReady ? (
                                <input
                                  type="checkbox"
                                  checked={Boolean(
                                    includedReady[row.mediaItemId],
                                  )}
                                  onChange={() => toggleReady(row.mediaItemId)}
                                  className="h-3.5 w-3.5 accent-primary rounded"
                                />
                              ) : (
                                <span className="text-on-surface-variant/40">
                                  —
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-2 max-w-[200px]">
                              <div className="font-medium text-on-surface truncate">
                                {it?.name ?? row.mediaItemId.slice(0, 8)}
                              </div>
                              <div
                                className="text-[10px] font-mono text-on-surface-variant truncate"
                                title={it?.path}
                              >
                                {parentDir(it?.path ?? '')}
                              </div>
                            </td>
                            <td className="px-2 py-2 whitespace-nowrap">
                              <Badge
                                variant={
                                  row.status === 'ready'
                                    ? 'success'
                                    : row.status === 'rule_blocked'
                                      ? 'warning'
                                      : 'error'
                                }
                              >
                                {STATUS_LABEL[row.status]}
                              </Badge>
                            </td>
                            <td className="px-2 py-2 text-on-surface-variant break-words max-w-[220px]">
                              {row.reason ??
                                (isReady
                                  ? `pista #${row.sourceTrackIndex}`
                                  : '—')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {lastEnqueueErrors.length > 0 && (
            <div className="rounded-lg border border-error/30 bg-error/8 p-3 space-y-1">
              <p className="text-xs font-semibold text-error">
                Errores al encolar
              </p>
              <ul className="text-[11px] text-on-surface-variant list-disc pl-4 max-h-32 overflow-y-auto space-y-0.5">
                {lastEnqueueErrors.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-outline-variant/15 bg-surface-container-low">
          <p className="text-xs text-on-surface-variant">
            Se encolarán{' '}
            <span className="font-semibold text-on-surface">
              {readySelected.length}
            </span>{' '}
            trabajo{readySelected.length !== 1 ? 's' : ''}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary btn-sm"
            >
              Cancelar
            </button>
            <Button
              variant="primary"
              size="sm"
              loading={enqueuing}
              disabled={readySelected.length === 0 || previewLoading}
              iconLeft={enqueuing ? undefined : 'send'}
              onClick={() => void runEnqueue()}
            >
              Encolar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
