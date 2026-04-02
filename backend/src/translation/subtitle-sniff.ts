/**
 * Detect ASS/SSA text after extraction (requires extracting with .ass, not .srt).
 */
export function looksLikeAssSubtitle(text: string): boolean {
  const s = text.replace(/^\uFEFF/, '').trimStart();
  if (s.length === 0) {
    return false;
  }
  return (
    /^\[Script Info\]/im.test(s) ||
    /\[V4\+\s*Styles\]/i.test(s) ||
    /^\[Events\]/im.test(s) ||
    /^Dialogue:/im.test(s)
  );
}
