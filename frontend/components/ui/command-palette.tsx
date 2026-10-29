'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { Dialog } from './dialog';
import { Icon } from './icon';
import { normalizeSearch } from '@/lib/languages';

export const NAVIGATION_COMMANDS = [
  { href: '/', label: 'Library', icon: 'video_library', keywords: 'media movies episodes subtitles search' },
  { href: '/activity', label: 'Activity', icon: 'work_history', keywords: 'jobs queue translations history logs' },
  { href: '/quick-translate', label: 'Quick Translate', icon: 'translate', keywords: 'upload subtitle srt ass ssa vtt' },
  { href: '/dashboard', label: 'Overview', icon: 'dashboard', keywords: 'statistics tokens usage spending' },
  { href: '/settings', label: 'Settings', icon: 'settings', keywords: 'providers keys budget roots language rules' },
  { href: '/rename', label: 'Rename', icon: 'drive_file_rename_outline', keywords: 'tools files organize preview undo' },
  { href: '/review', label: 'Subtitle Review', icon: 'fact_check', keywords: 'quality compare edit cues retranslate memory readability context' },
];
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const container = useRef<HTMLDivElement>(null);
  const matches = NAVIGATION_COMMANDS.filter(item => normalizeSearch(`${item.label} ${item.keywords}`).includes(normalizeSearch(query)));
  useEffect(() => { if (open) { setQuery(''); setActive(0); } }, [open]);
  return <Dialog open={open} onClose={onClose} title="Go to…">
    <div ref={container}>
      <input autoFocus role="combobox" aria-label="Search commands" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined} className="engraved-input w-full p-3" placeholder="Search pages and actions…" value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(index + 1, matches.length - 1)); }
        if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); }
        if (event.key === 'Enter') { event.preventDefault(); container.current?.querySelector<HTMLAnchorElement>(`[data-command="${active}"]`)?.click(); }
      }} />
      <ul id={listId} role="listbox" aria-label="Commands" className="mt-3 space-y-1">
        {matches.map((item, index) => <li key={item.href} id={`${listId}-${index}`} role="option" aria-selected={active === index}><Link data-command={index} href={item.href} onClick={() => onClose()} onMouseEnter={() => setActive(index)} className={`flex items-center gap-3 rounded p-3 ${index === active ? 'bg-primary/10 text-primary' : 'hover:bg-surface-container-high'}`}><Icon name={item.icon} />{item.label}</Link></li>)}
      </ul>
      {!matches.length && <p className="p-4 text-on-surface-variant">No matching commands</p>}
      <p className="mt-3 text-xs text-on-surface-variant">↑ ↓ navigate · Enter open · Escape close</p>
    </div>
  </Dialog>;
}
