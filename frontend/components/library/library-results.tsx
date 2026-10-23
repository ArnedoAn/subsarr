'use client';
import Link from 'next/link';
import type { MediaItemWithRuleStatus } from '@/lib/types';
export function LibraryResults({ items, selected, onToggle, onDetails, onTranslate, targetLanguage, busy }: {
  items: MediaItemWithRuleStatus[]; selected: Record<string, boolean>; onToggle: (id: string) => void; onDetails: (id: string) => void; onTranslate: (item: MediaItemWithRuleStatus) => void; targetLanguage: string; busy: boolean;
}) {
  return <ul className="min-w-0 w-full max-w-full divide-y divide-outline-variant/20 bg-surface-container rounded-lg" aria-label="Library media">{items.map(item => {
    const hasTarget = item.subtitleTracks.some(track => track.language === targetLanguage) || item.externalSubtitles.some(sub => sub.language === targetLanguage);
    return <li key={item.id} className="min-w-0 w-full max-w-full p-4 flex gap-3 items-start">
      <input className="mt-1 shrink-0" type="checkbox" aria-label={`Select ${item.name}`} checked={!!selected[item.id]} onChange={() => onToggle(item.id)} />
      <div className="min-w-0 max-w-full flex-1 [overflow-wrap:anywhere]">
        <button className="block min-w-0 w-full max-w-full whitespace-normal text-left font-semibold [overflow-wrap:anywhere] hover:text-primary" onClick={() => onDetails(item.id)}>{item.name}</button>
        <p className="min-w-0 max-w-full text-xs text-on-surface-variant [overflow-wrap:anywhere]">{item.path}</p>
        <p className="text-xs mt-1">{item.type === 'unknown' ? 'Unclassified' : item.type}{item.season !== undefined ? ` · Season ${item.season}` : ''}{item.episodes?.length ? ` · Episode ${item.episodes.join(', ')}` : ''} · {(item.size / 1024 ** 3).toFixed(2)} GB · {item.subtitleTracks.length} source tracks · {hasTarget ? `${targetLanguage} present` : `${targetLanguage} missing`}</p>
        <p className={`text-xs ${item.probeStatus === 'failed' ? 'text-error' : 'text-on-surface-variant'}`}>{item.probeStatus !== 'ok' ? `Probe ${item.probeStatus} · ` : ''}{item.ruleStatus.skip ? `Skipped: ${item.ruleStatus.reason ?? 'Rule blocked'}` : 'Eligible for rule evaluation'}</p>
        <div className="min-w-0 max-w-full flex flex-wrap gap-3 mt-2"><button className="btn btn-secondary btn-sm" disabled={busy || item.subtitleTracks.length === 0} onClick={() => onTranslate(item)}>Translate with defaults</button><button className="btn btn-ghost btn-sm" onClick={() => onDetails(item.id)}>Details & options</button><Link className="text-xs text-primary self-center" href={`/library/${item.id}`}>Open page</Link></div>
      </div>
    </li>;
  })}</ul>;
}
