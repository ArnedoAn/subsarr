export const REVIEW_PAGE_SIZE = 50;
export const REVIEW_SELECTION_LIMIT = 100;

/** Cue ordinals, never the subtitle's possibly duplicated display indices. */
export function toggleReviewCue(selected: ReadonlySet<number>, cueIndex: number): Set<number> {
  const next = new Set(selected);
  if (next.has(cueIndex)) next.delete(cueIndex);
  else if (next.size < REVIEW_SELECTION_LIMIT) next.add(cueIndex);
  return next;
}

export function reviewEdits(cues: ReadonlyArray<{ cueIndex: number; text: string }>, drafts: Readonly<Record<number, string>>): Array<{ cueIndex: number; text: string }> {
  return cues.filter(cue => Object.hasOwn(drafts, cue.cueIndex) && drafts[cue.cueIndex] !== cue.text)
    .map(cue => ({ cueIndex: cue.cueIndex, text: drafts[cue.cueIndex] }));
}

export function reviewWorkspaceLink(id: string): string {
  return `/review?id=${encodeURIComponent(id)}`;
}

export function reviewTimestamp(milliseconds: number): string {
  const value = Math.max(0, Math.round(milliseconds));
  return `${String(Math.floor(value / 3600000)).padStart(2, '0')}:${String(Math.floor(value / 60000) % 60).padStart(2, '0')}:${String(Math.floor(value / 1000) % 60).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`;
}

/** Abortable polling delay: closing a workspace never leaves a polling timer running. */
export function reviewPollDelay(signal: AbortSignal, milliseconds = 1000): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  if (signal.aborted) { reject(signal.reason); return promise; }
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
  signal.addEventListener('abort', abort, { once: true });
  return promise;
}
