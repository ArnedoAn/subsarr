'use client';
import { useMemo, useState } from 'react';
export type BatchItemLabel = { name: string; path: string };
export function BatchSelection({ ids, labels, excluded, onChange, busy }: {
  ids: string[]; labels: Map<string, BatchItemLabel>; excluded: Record<string, boolean>; onChange: (value: Record<string, boolean>) => void; busy: boolean;
}) {
  const [query, setQuery] = useState('');
  const folders = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const id of ids) {
      const item = labels.get(id);
      if (!`${item?.name ?? ''} ${item?.path ?? ''} ${id}`.toLowerCase().includes(query.toLowerCase())) continue;
      const folder = item?.path.replace(/\\/g, '/').split('/').slice(0, -1).join('/') || 'Awaiting preview metadata';
      const members = groups.get(folder) ?? []; members.push(id); groups.set(folder, members);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [ids, labels, query]);
  return <section className="space-y-2"><h3 className="font-semibold">Batch selection</h3><input aria-label="Search batch selection" className="engraved-input w-full p-2" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find selected file by name, path or ID" />
    <div className="flex gap-3 text-sm"><button disabled={busy} onClick={() => onChange({})}>Include all</button><button disabled={busy} onClick={() => onChange(Object.fromEntries(ids.map(id => [id, true])))}>Exclude all</button><span>{ids.filter(id => !excluded[id]).length} included</span></div>
    <div className="max-h-56 overflow-auto space-y-2">{folders.map(([folder, members]) => <details key={folder} open={ids.length <= 50} className="p-2 rounded border border-outline-variant/20"><summary className="cursor-pointer text-xs break-all">{folder} · {members.filter(id => !excluded[id]).length} / {members.length} matching files included</summary><div className="flex gap-3 text-xs my-2"><button disabled={busy} onClick={() => { const value = { ...excluded }; for (const id of members) delete value[id]; onChange(value); }}>Include folder matches</button><button disabled={busy} onClick={() => { const value = { ...excluded }; for (const id of members) value[id] = true; onChange(value); }}>Exclude folder matches</button></div>{members.map(id => <label key={id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={!excluded[id]} disabled={busy} onChange={event => onChange({ ...excluded, [id]: !event.target.checked })} /><span className="break-all">{labels.get(id)?.name ?? id}</span></label>)}</details>)}</div>
  </section>;
}
