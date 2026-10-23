'use client';

import { useMemo, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { PathBrowser } from '@/components/path-browser';
import { Dialog } from '@/components/ui/dialog';
import type { RenameBatchResult, RenameClassification, RenameHistoryRow, RenameMetadataMatch, RenamePlan, RenamePlanRow, RenameTemplates } from '@/lib/types';

type Edit = { id: string; filename?: string; classification?: RenameClassification; selected?: boolean };
const defaultTemplates: RenameTemplates = { movie: '{title} ({year})', series: '{title} - {episodes}', anime: '{title} - {absolute}' };

export default function RenamePage() {
  const [directory, setDirectory] = useState('');
  const [templates, setTemplates] = useState(defaultTemplates);
  const [seasonFolders, setSeasonFolders] = useState(false);
  const [plan, setPlan] = useState<RenamePlan | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [episodeTexts, setEpisodeTexts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RenameBatchResult | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [confirm, setConfirm] = useState<'rename' | string | null>(null);
  const [metadataRow, setMetadataRow] = useState<RenamePlanRow | null>(null);
  const [metadataQuery, setMetadataQuery] = useState('');
  const [matches, setMatches] = useState<RenameMetadataMatch[]>([]);
  const [metadataMessage, setMetadataMessage] = useState('');
  const history = useApiQuery<RenameHistoryRow[]>('/rename/history', {});
  const batches = useMemo(() => {
    const grouped = new Map<string, RenameHistoryRow[]>();
    for (const row of history.data ?? []) grouped.set(row.batchId, [...(grouped.get(row.batchId) ?? []), row]);
    return [...grouped.entries()];
  }, [history.data]);
  const pending = Object.keys(edits).length > 0;
  const conflicts = plan?.rows.filter((row) => row.status === 'conflict' || row.status === 'unclassified').length ?? 0;
  const changes = plan?.rows.filter((row) => row.status === 'safe').length ?? 0;

  function update(row: RenamePlanRow, patch: Partial<Edit>) {
    setEdits((previous) => ({ ...previous, [row.id]: { ...previous[row.id], id: row.id, ...patch } }));
    setReviewed(false);
  }
  function classify(row: RenamePlanRow, patch: Partial<RenameClassification>) {
    const current = edits[row.id]?.classification ?? row.classification;
    update(row, { classification: { ...current, ...patch, confidence: 'manual' } });
  }
  async function action(run: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await run(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Request failed'); }
    finally { setBusy(false); }
  }
  async function applyEdits(): Promise<RenamePlan> {
    if (!plan) throw new Error('Preview a folder first');
    const updated = await apiPost<RenamePlan>('/rename/revise', { planId: plan.id, edits: Object.values(edits), templates: plan.templates });
    setPlan(updated); setEdits({}); setReviewed(false);
    return updated;
  }
  async function preview() {
    await action(async () => {
      const next = await apiPost<RenamePlan>('/rename/preview', { directory, templates, seasonFolders });
      setPlan(next); setEdits({}); setReviewed(false); setResult(null);
    });
  }
  async function dryRun() {
    await action(async () => {
      const current = pending ? await applyEdits() : plan;
      if (!current) return;
      const validated = await apiPost<RenamePlan>('/rename/dry-run', { planId: current.id });
      setPlan(validated); setReviewed(true);
    });
  }
  async function execute() {
    const target = confirm;
    setConfirm(null);
    await action(async () => {
      const response = target === 'rename'
        ? await apiPost<RenameBatchResult>('/rename/execute', { planId: plan?.id })
        : await apiPost<RenameBatchResult>(`/rename/history/${encodeURIComponent(target ?? '')}/undo`);
      setResult(response); history.refetch();
      if (target === 'rename') { setPlan(null); setEdits({}); setReviewed(false); }
    });
  }
  async function lookup() {
    if (!metadataRow) return;
    await action(async () => {
      const classification = edits[metadataRow.id]?.classification ?? metadataRow.classification;
      const reply = await apiGet<{ matches: RenameMetadataMatch[]; warnings: string[] }>(`/rename/metadata?q=${encodeURIComponent(metadataQuery)}&kind=${classification.kind === 'movie' ? 'movie' : 'episode'}`);
      setMatches(reply.matches); setMetadataMessage(reply.warnings.join(' ') || (reply.matches.length ? 'Choose a result explicitly. Nothing is applied automatically.' : 'No matches. Try another query or classify manually.'));
    });
  }
  async function selectMetadata(match: RenameMetadataMatch) {
    await action(async () => {
      if (!plan || !metadataRow) return;
      const updated = await apiPost<RenamePlan>('/rename/metadata/select', { planId: plan.id, rowId: metadataRow.id, matchId: match.id, edits: Object.values(edits) });
      setPlan(updated); setEdits({}); setReviewed(false); setMetadataRow(null);
    });
  }

  return <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-8">
    <header><p className="text-sm text-on-surface-variant">Tools</p><h1 className="text-2xl font-bold text-primary">Rename workspace</h1><p className="text-sm text-on-surface-variant mt-2">Preview video and subtitle names together. Changes stay in their folder unless you explicitly enable season folders. No file is overwritten.</p></header>
    {error && <div role="alert" className="rounded-lg border border-error/40 bg-error/10 p-4 text-error">{error}</div>}
    <section className="rounded-xl border border-outline-variant/30 bg-surface-container p-4 flex flex-col gap-4">
      <label className="font-medium">Media directory<PathBrowser value={directory} onChange={setDirectory} placeholder="Choose a configured media folder" /></label>
      <details><summary className="cursor-pointer font-medium">Jellyfin naming templates</summary><div className="grid gap-3 mt-3 md:grid-cols-3">{(['movie', 'series', 'anime'] as const).map((kind) => <label key={kind} className="text-sm capitalize">{kind}<input className="engraved-input w-full rounded p-2 mt-1" value={templates[kind]} onChange={(event) => setTemplates((previous) => ({ ...previous, [kind]: event.target.value }))} /></label>)}</div><p className="text-xs text-on-surface-variant mt-2">Tokens: {'{title}, {year}, {season}, {episodes}, {absolute}'}. Episodes renders S01E01E02. Templates apply when creating a new preview.</p></details>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={seasonFolders} onChange={(event) => setSeasonFolders(event.target.checked)} />Move series files into Season folders (explicit opt-in)</label>
      <p className="text-xs text-on-surface-variant">Moves require a filesystem supporting same-device hard links. Existing destinations, cycles and case-only renames are rejected. Plans expire after 30 minutes.</p>
      <button className="btn btn-primary self-start" onClick={preview} disabled={busy || !directory}>{busy ? 'Working…' : 'Create preview'}</button>
    </section>
    {plan && <section className="flex flex-col gap-4" aria-label="Rename preview">
      <div className="flex flex-wrap items-center gap-3"><h2 className="font-semibold">Preview · {plan.rows.length} files</h2><span className="text-sm">{changes} changes · {conflicts} need attention{pending ? ' · edits not yet validated' : ''}</span><button className="btn btn-secondary" disabled={busy || !pending} onClick={() => action(async () => { await applyEdits(); })}>Apply edits</button><button className="btn btn-secondary" disabled={busy} onClick={dryRun}>Final dry run</button><button className="btn btn-primary" disabled={busy || !reviewed || pending || conflicts > 0 || changes === 0} onClick={() => setConfirm('rename')}>Rename {changes} files</button></div>
      <p className="text-xs text-on-surface-variant">{reviewed ? 'Final dry run complete. Execution revalidates file identity, roots and collisions again.' : 'Edit and classify rows, then run the final dry run. Uncheck files you do not want to rename.'}</p>
      {plan.rows.length === 0 && <p className="rounded-lg bg-surface-container p-4">No supported videos found. SRT, ASS, SSA and VTT sidecars are grouped with matching video stems.</p>}
      <div className="flex flex-col gap-3">{plan.rows.map((row) => {
        const draft = edits[row.id];
        const classification = draft?.classification ?? row.classification;
        const filename = row.proposedPath.split(/[\\/]/).pop() ?? '';
        return <article key={row.id} className={`rounded-xl border p-4 ${row.sidecar ? 'ml-4 border-outline-variant/20 bg-surface-container-low' : 'border-outline-variant/40 bg-surface-container'}`}>
          <div className="flex flex-wrap items-start gap-3"><label className="flex gap-2 items-center"><input type="checkbox" aria-label={`Include ${row.originalPath}`} checked={draft?.selected ?? row.selected} onChange={(event) => {
            if (row.sidecar) update(row, { selected: event.target.checked });
            else {
              const selected = event.target.checked;
              setEdits((previous) => { const next = { ...previous }; for (const member of plan.rows.filter((entry) => entry.groupId === row.groupId)) next[member.id] = { ...next[member.id], id: member.id, selected }; return next; });
              setReviewed(false);
            }
          }} /><span className="text-xs font-semibold uppercase">{row.sidecar ? 'Subtitle' : classification.kind}</span></label><span className={`text-xs ${row.status === 'conflict' || row.status === 'unclassified' ? 'text-error' : 'text-on-surface-variant'}`}>{row.status}{row.reason ? `: ${row.reason}` : ''}</span></div>
          <div className="grid md:grid-cols-2 gap-3 mt-3"><div><p className="text-xs text-on-surface-variant">Current</p><p className="font-mono text-xs break-all mt-1">{row.originalPath}</p></div><label className="text-xs text-on-surface-variant">Proposed filename<input aria-label={`Proposed filename for ${row.originalPath}`} className="engraved-input w-full rounded p-2 font-mono mt-1 text-sm" value={draft?.filename ?? filename} onChange={(event) => update(row, { filename: event.target.value })} /><span className="block break-all mt-1">{row.proposedPath}</span></label></div>
          {!row.sidecar && <details className="mt-3"><summary className="text-sm cursor-pointer">Classification · {classification.confidence} confidence</summary><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mt-3 text-sm">
            <label>Type<select className="engraved-input w-full p-2 rounded" value={classification.kind} onChange={(event) => classify(row, { kind: event.target.value as RenameClassification['kind'], season: classification.season ?? 1, episodes: classification.episodes ?? [1], absolute: classification.absolute ?? 1 })}><option value="unknown">Unclassified</option><option value="movie">Movie</option><option value="episode">Series episode</option><option value="anime">Anime absolute</option></select></label>
            <label>Title<input className="engraved-input w-full p-2 rounded" value={classification.title} onChange={(event) => classify(row, { title: event.target.value })} /></label>
            {classification.kind === 'movie' && <label>Year<input type="number" min="1800" max="2200" className="engraved-input w-full p-2 rounded" value={classification.year ?? ''} onChange={(event) => classify(row, { year: Number(event.target.value) })} /></label>}
            {classification.kind === 'episode' && <><label>Season<input type="number" min="0" max="99" className="engraved-input w-full p-2 rounded" value={classification.season ?? 1} onChange={(event) => classify(row, { season: Number(event.target.value) })} /></label><label>Episodes (comma separated)<input className="engraved-input w-full p-2 rounded" value={episodeTexts[row.id] ?? (classification.episodes ?? []).join(',')} onChange={(event) => { const text = event.target.value; setEpisodeTexts((previous) => ({ ...previous, [row.id]: text })); classify(row, { episodes: text.trim() ? text.split(',').map((value) => Number(value.trim())) : [] }); }} /></label></>}
            {classification.kind === 'anime' && <label>Absolute episode<input type="number" min="0" max="9999" className="engraved-input w-full p-2 rounded" value={classification.absolute ?? ''} onChange={(event) => classify(row, { absolute: Number(event.target.value) })} /></label>}
          </div><div className="flex flex-wrap gap-2 mt-3"><button className="btn btn-secondary" disabled={busy || classification.kind === 'unknown'} onClick={() => classify(row, {})}>Confirm classification</button><button className="btn btn-secondary" disabled={busy || !['movie', 'episode'].includes(classification.kind)} onClick={() => { setMetadataRow(row); setMetadataQuery(classification.title); setMatches([]); setMetadataMessage('Search your Jellyfin library first, then TMDB if no library candidates exist.'); }}>Look up metadata</button></div></details>}
        </article>;
      })}</div>
    </section>}
    {result && <section aria-live="polite" className="rounded-xl bg-surface-container border border-outline-variant/30 p-4"><h2 className="font-semibold">Batch outcome</h2><p className="text-sm mt-2">{result.outcomes.filter((row) => row.status === 'renamed' || row.status === 'undone').length} completed · {result.outcomes.filter((row) => row.status === 'failed').length} failed · {result.outcomes.filter((row) => row.status === 'unchanged').length} unchanged</p><details className="mt-2"><summary>Per-file results</summary><ul className="text-xs font-mono space-y-2 mt-2">{result.outcomes.map((row) => <li key={row.id} className="break-all">{row.status}: {row.originalPath} → {row.proposedPath}{row.reason && <span className="text-error"> · {row.reason}</span>}</li>)}</ul></details></section>}
    <section className="rounded-xl bg-surface-container border border-outline-variant/30 p-4"><div className="flex justify-between items-center"><h2 className="font-semibold">Rename history &amp; undo</h2><button className="btn btn-secondary" disabled={history.loading || busy} onClick={history.refetch}>Refresh</button></div><p className="text-xs text-on-surface-variant mt-2">Latest 1000 file journal entries. Undo checks the saved file identity and refuses to overwrite any existing original name. A partial batch can be undone file by file through its batch action.</p>{history.loading && <p role="status">Loading history…</p>}{history.error && <p role="alert" className="text-error">{history.error.message}</p>}{!history.loading && !history.error && batches.length === 0 && <p className="text-sm mt-3">No rename history yet.</p>}<div className="space-y-3 mt-3">{batches.map(([id, rows]) => <details key={id} className="border border-outline-variant/30 rounded p-3"><summary className="cursor-pointer text-sm">{new Date(rows[0].createdAt).toLocaleString()} · {rows.length} files · {rows.filter((row) => row.state === 'undone').length} undone</summary><button className="btn btn-secondary my-3" disabled={busy || rows.every((row) => row.state === 'undone')} onClick={() => setConfirm(id)}>Undo batch safely</button><ul className="space-y-2 text-xs font-mono">{rows.map((row) => <li key={row.id} className="break-all">{row.state}: {row.originalPath} → {row.destinationPath}{row.error && <span className="text-error"> · {row.error}</span>}</li>)}</ul></details>)}</div></section>
    <Dialog open={confirm !== null} onClose={() => setConfirm(null)} title={confirm === 'rename' ? 'Apply reviewed rename plan?' : 'Undo this rename batch?'}><p className="text-sm">{confirm === 'rename' ? `Rename ${changes} files after one more server-side revalidation? Each outcome is journaled.` : 'Restore original names only where the recorded file is unchanged and the original destination is free. Conflicting files will be reported, never overwritten.'}</p><div className="flex gap-3 mt-4"><button className="btn btn-secondary" onClick={() => setConfirm(null)}>Cancel</button><button className="btn btn-primary" onClick={execute} disabled={busy}>Confirm</button></div></Dialog>
    <Dialog open={metadataRow !== null} onClose={() => setMetadataRow(null)} title="Select metadata"><label className="block text-sm">Search title<input className="engraved-input w-full p-2 rounded mt-1" value={metadataQuery} onChange={(event) => setMetadataQuery(event.target.value)} /></label><button className="btn btn-primary mt-3" disabled={busy || !metadataQuery.trim()} onClick={lookup}>Search Jellyfin / TMDB</button><p role="status" className="text-sm text-on-surface-variant my-3">{metadataMessage}</p><ul className="space-y-2">{matches.map((match) => <li key={match.id}><button className="btn btn-secondary w-full text-left" disabled={busy} onClick={() => selectMetadata(match)}>{match.title}{match.year ? ` (${match.year})` : ''} · {match.source}</button></li>)}</ul></Dialog>
  </div>;
}
