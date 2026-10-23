'use client';
import { LanguageCombobox } from '@/components/language-combobox';
import type { LibraryController } from './use-library';

export function LibraryFilters({ library }: { library: LibraryController }) {
  const { filters, update } = library;
  const activeGroup = library.groups.find(group => group.key === filters.group);
  return <section className="bg-surface-container p-4 rounded-lg space-y-3" aria-label="Library filters">
    <label className="block"><span className="field-label">Search all media</span><input className="engraved-input p-3 w-full" value={library.search} onChange={event => library.setSearch(event.target.value)} placeholder={'Words in any order, "exact phrase", lang:eng, missing:spa, s02e03'} /></label>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <label>Type<select className="engraved-input p-2 w-full" value={filters.type} onChange={event => update({ type: event.target.value as typeof filters.type, group: '', season: '' })}><option value="">All media</option><option value="movie">Movies</option><option value="episode">Episodes</option><option value="unknown">Unclassified</option></select></label>
      <label>Folder<select className="engraved-input p-2 w-full" value={filters.folder} onChange={event => update({ folder: event.target.value, group: '', season: '' })}><option value="">All folders</option>{library.folders.map(folder => <option key={folder} value={folder}>{folder}</option>)}</select></label>
      <label>Status<select className="engraved-input p-2 w-full" value={filters.status} onChange={event => update({ status: event.target.value as typeof filters.status })}><option value="">Any status</option><option value="eligible">Eligible</option><option value="skipped">Rule skipped</option><option value="failed">Probe failed</option></select></label>
      <div><label className="field-label">Target language</label><LanguageCombobox ariaLabel="Filter target language" value={filters.targetLanguage} onChange={value => update({ targetLanguage: value })} /></div>
    </div>
    <div className="flex flex-wrap gap-4 items-center">
      <label className="flex gap-2"><input type="checkbox" checked={filters.missingTarget} onChange={event => update({ missingTarget: event.target.checked })} />Missing target only</label>
      <label>Sort <select className="engraved-input p-2" value={filters.sort} onChange={event => update({ sort: event.target.value as typeof filters.sort })}><option value="name">Name</option><option value="size">Size</option><option value="date">Modified date</option><option value="tracks">Track count</option></select></label>
      <label>Order <select className="engraved-input p-2" value={filters.order} onChange={event => update({ order: event.target.value as typeof filters.order })}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
      <label>Per page <select className="engraved-input p-2" value={filters.limit} onChange={event => update({ limit: Number(event.target.value) })}>{[20, 50, 100, 200].map(limit => <option key={limit}>{limit}</option>)}</select></label>
    </div>
    <div className="grid md:grid-cols-2 gap-3">
      <label>Show / movie / unclassified group<select className="engraved-input p-2 w-full" value={filters.group} onChange={event => update({ group: event.target.value, season: '' })}><option value="">All groups</option>{filters.group && !activeGroup && <option value={filters.group}>Selected group (no current matches)</option>}{library.groups.map(group => <option key={group.key} value={group.key}>{group.type === 'unknown' ? 'Unclassified: ' : ''}{group.label} — {group.count} files{group.seasons.length ? `, ${group.seasons.length} seasons` : ''}</option>)}</select></label>
      <label>Season<select className="engraved-input p-2 w-full" value={filters.season} disabled={!filters.group} onChange={event => update({ season: event.target.value })}><option value="">All seasons</option>{activeGroup?.seasons.map(season => <option key={season} value={season}>Season {season}</option>)}</select></label>
    </div>
    {library.groupsError && <p role="alert" className="text-error">Grouping unavailable: {library.groupsError}</p>}
    <details open={!!filters.group} className="text-xs text-on-surface-variant">
      <summary className="cursor-pointer">Shows, seasons and target subtitle completeness</summary>
      <div className="max-h-72 overflow-auto grid sm:grid-cols-2 gap-2 mt-2">
        {library.groups.filter(group => !filters.group || group.key === filters.group).map(group => <article key={group.key} className="p-3 bg-surface-container-high rounded space-y-2">
          <button className="text-left text-sm font-semibold text-on-surface" onClick={() => update({ group: group.key, season: '' })}>{group.type === 'unknown' ? 'Unclassified: ' : ''}{group.label}</button>
          <p>{group.targetPresent} / {group.count} inventory files have {filters.targetLanguage}; {group.missingTarget} missing.</p>
          <progress className="w-full accent-primary" aria-label={`${group.label} target subtitle completeness`} value={group.targetPresent} max={Math.max(1, group.count)} />
          <div className="flex flex-wrap gap-2">{group.seasons.map(season => <button key={season} className="btn btn-secondary btn-sm" onClick={() => update({ group: group.key, season: String(season) })}>Season {season}</button>)}</div>
        </article>)}
      </div>
      <p className="mt-2">Completeness is measured against discovered inventory. Expected episode counts are unknown without reliable metadata.</p>
    </details>
  </section>;
}
