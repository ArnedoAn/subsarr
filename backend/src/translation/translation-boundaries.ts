export class OutputValidationError extends Error {}
const SUBTITLE_MARKUP =
  /\{[^}\r\n]*\\p[1-9]\d*[^}\r\n]*\}.*?(?:\{[^}\r\n]*\\p0[^}\r\n]*\}|$)|\{[^}\r\n]*\}|<[^>\r\n]*>|\\[Nnh]|&(?:#\d+|#x[\da-f]+|[a-z]+);|[{}<>]/gi;
export function subtitleMarkup(value: string): string[] {
  return value.match(SUBTITLE_MARKUP) ?? [];
}
export interface CueChunk {
  indices: number[];
  before: string[];
  after: string[];
}
/** Never split a cue; context is read-only and never occupies output indices. */
export function chunkCues(
  lines: string[],
  indices = lines.map((_, i) => i),
  maxBytes = 12000,
): CueChunk[] {
  const chunks: CueChunk[] = [];
  let current: number[] = [];
  let bytes = 0;
  for (const index of indices) {
    const size = Buffer.byteLength(JSON.stringify(lines[index]), 'utf8') + 16;
    if (size > maxBytes)
      throw new Error(
        `Subtitle cue ${index + 1} exceeds translation token budget`,
      );
    if (current.length && (bytes + size > maxBytes || current.length >= 60)) {
      chunks.push({ indices: current, before: [], after: [] });
      current = [];
      bytes = 0;
    }
    current.push(index);
    bytes += size;
  }
  if (current.length) chunks.push({ indices: current, before: [], after: [] });
  for (const chunk of chunks) {
    const start = chunk.indices[0];
    const end = chunk.indices[chunk.indices.length - 1];
    // Bounded overlap for discourse context, not translated twice.
    chunk.before = lines
      .slice(Math.max(0, start - 2), start)
      .map((line) => line.slice(0, 500));
    chunk.after = lines
      .slice(end + 1, end + 3)
      .map((line) => line.slice(0, 500));
  }
  return chunks;
}
export interface ProtectedCue {
  text: string;
  restore: (translated: string) => string;
}
export function protectMarkup(source: string): ProtectedCue {
  if (/⟦SUBSARR_\d+⟧/.test(source))
    throw new Error('Source collides with protected markup tokens');
  const markup: string[] = [];
  const text = source.replace(SUBTITLE_MARKUP, (match) => {
    const index = markup.push(match) - 1;
    return `⟦SUBSARR_${index}⟧`;
  });
  return {
    text,
    restore: (translated) => {
      const tokens = translated.match(/⟦SUBSARR_\d+⟧/g) ?? [];
      if (
        tokens.length !== markup.length ||
        tokens.some((token, i) => token !== `⟦SUBSARR_${i}⟧`)
      )
        throw new OutputValidationError(
          'Translation changed protected subtitle markup',
        );
      const restored = translated.replace(
        /⟦SUBSARR_(\d+)⟧/g,
        (_, index: string) => markup[Number(index)],
      );
      if (JSON.stringify(markup) !== JSON.stringify(subtitleMarkup(restored)))
        throw new OutputValidationError(
          'Translation introduced subtitle markup',
        );
      return restored;
    },
  };
}
export function parseTranslationJson(content: string, count: number): string[] {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new OutputValidationError('Provider returned invalid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new OutputValidationError('Expected JSON object with data:string[]');
  const data = (value as Record<string, unknown>).data;
  if (
    !Array.isArray(data) ||
    data.length !== count ||
    !data.every((entry): entry is string => typeof entry === 'string')
  )
    throw new OutputValidationError(
      'Provider must return data:string[] with exact cue count',
    );
  if (
    data.some(
      (entry) =>
        entry.includes('\0') || entry.includes('\ufffd') || !entry.trim(),
    )
  )
    throw new OutputValidationError(
      'Provider returned empty or invalid subtitle text',
    );
  return data.map((entry) => entry.replace(/\r\n?/g, '\n'));
}
