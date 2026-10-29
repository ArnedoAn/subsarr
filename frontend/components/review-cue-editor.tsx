'use client';

export interface ReviewCueEditorProps {
  ordinal: number;
  displayIndex: number;
  timing: string;
  source: string;
  text: string;
  selected: boolean;
  disabled: boolean;
  issues: ReadonlyArray<{ code: string; message: string; severity: 'warning' | 'error' }>;
  metrics: string;
  onSelect: () => void;
  onChange: (text: string) => void;
}

/** Controlled plain text only: subtitle tags are displayed, never executed as HTML. */
export function ReviewCueEditor({ ordinal, displayIndex, timing, source, text, selected, disabled, issues, metrics, onSelect, onChange }: ReviewCueEditorProps) {
  return <article className={`rounded-xl border p-4 space-y-3 ${selected ? 'border-primary bg-primary/5' : 'border-outline-variant/30 bg-surface-container'}`}>
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={selected} disabled={disabled} onChange={onSelect} aria-label={`Select cue ${ordinal + 1}`} />Cue {ordinal + 1} <span className="text-xs text-on-surface-variant">(subtitle index {displayIndex})</span></label>
      <span className="font-mono text-xs">{timing}</span>
      <span className="text-xs text-on-surface-variant">{metrics}</span>
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      <div><p className="text-xs text-on-surface-variant mb-1">Source</p><pre className="whitespace-pre-wrap break-words font-sans text-sm rounded-lg bg-surface p-3 min-h-24">{source}</pre></div>
      <label className="text-xs text-on-surface-variant">Translation<textarea aria-label={`Translation for cue ${ordinal + 1}`} className="engraved-input w-full mt-1 rounded-lg p-3 min-h-24 text-sm text-on-surface" value={text} disabled={disabled} onChange={event => onChange(event.target.value)} /></label>
    </div>
    {issues.length > 0 && <ul className="text-sm space-y-1" aria-label={`Issues for cue ${ordinal + 1}`}>{issues.map((issue, index) => <li key={`${issue.code}-${index}`} className={issue.severity === 'error' ? 'text-error' : 'text-on-surface-variant'}><strong>{issue.severity === 'error' ? 'Structure error' : 'Readability warning'}:</strong> {issue.message}</li>)}</ul>}
  </article>;
}
