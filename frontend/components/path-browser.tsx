'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { apiGet } from '@/lib/api';

interface PathBrowserProps { value: string; onChange: (path: string) => void; placeholder?: string }
interface FileSystemEntry { name: string; isDirectory: boolean; path: string; available?: boolean; error?: string }

export function PathBrowser({ value, onChange, placeholder = 'Enter a path or browse…' }: PathBrowserProps) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<FileSystemEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const listId = useId();

  const load = async (nextPath: string) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPath(nextPath); setLoading(true); setLoaded(false); setError(null); setEntries([]);
    try {
      const result = await apiGet<FileSystemEntry[]>(`/system/directory?path=${encodeURIComponent(nextPath)}`, { signal: controller.signal });
      if (!controller.signal.aborted) { setEntries(result); setLoaded(true); }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to list this directory');
    } finally { if (!controller.signal.aborted) setLoading(false); }
  };
  const close = () => { setOpen(false); request.current?.abort(); };
  useEffect(() => {
    const outside = (event: MouseEvent) => { if (!wrapper.current?.contains(event.target as Node)) { setOpen(false); request.current?.abort(); } };
    document.addEventListener('mousedown', outside);
    return () => { document.removeEventListener('mousedown', outside); request.current?.abort(); };
  }, []);
  const browse = () => { setOpen(true); void load(value || ''); };
  return <div ref={wrapper} className="relative w-full" onKeyDown={event => { if (event.key === 'Escape') close(); }}>
    <div className="flex gap-2">
      <input type="text" aria-label="Directory path" value={value} onChange={event => { onChange(event.target.value); if (open) close(); }} placeholder={placeholder} className="engraved-input min-w-0 flex-1 px-3 py-2.5 text-sm" />
      <button type="button" className="btn btn-secondary" aria-expanded={open} aria-controls={listId} onClick={open ? close : browse}>Browse</button>
    </div>
    {open && <div id={listId} className="absolute z-50 mt-2 w-full rounded-lg border border-outline-variant bg-surface-container-high shadow-xl">
      <div className="flex items-center gap-2 p-3 border-b border-outline-variant/30">
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>{path || 'Configured media roots'}</span>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => void load('')}>Roots</button>
        <button type="button" disabled={!path || !loaded || loading || !!error} className="btn btn-primary btn-xs" onClick={() => { onChange(path); close(); }}>Select</button>
      </div>
      <div className="max-h-64 overflow-y-auto p-2" aria-busy={loading}>
        {loading && <p role="status" className="p-3 text-sm">Loading directories…</p>}
        {error && <div role="alert" className="p-3 text-sm text-error"><p>{error}</p><button type="button" className="btn btn-secondary mt-2" onClick={() => void load(path)}>Retry</button></div>}
        {!loading && !error && loaded && entries.filter(entry => entry.isDirectory).length === 0 && <p className="p-3 text-sm text-on-surface-variant">No subdirectories</p>}
        {!loading && !error && entries.filter(entry => entry.isDirectory).map(entry => <button type="button" key={entry.path} disabled={entry.available === false} title={entry.error} className="flex w-full items-center gap-2 rounded p-3 text-left text-sm hover:bg-surface-container-highest disabled:opacity-50" onClick={() => void load(entry.path)}><span aria-hidden="true">▸</span><span className="truncate">{entry.name}{entry.available === false ? ` — Unavailable${entry.error ? `: ${entry.error}` : ''}` : ''}</span></button>)}
      </div>
      <p className="border-t border-outline-variant/30 p-3 text-xs text-on-surface-variant">Manual paths are checked when saved. Browse only lists accessible configured media roots.</p>
    </div>}
  </div>;
}
