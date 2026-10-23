import * as jschardet from 'jschardet';
import * as iconv from 'iconv-lite';
export const SUPPORTED_SUBTITLE_FORMATS = ['srt', 'ass', 'ssa', 'vtt'] as const;
export type DocumentExtension = (typeof SUPPORTED_SUBTITLE_FORMATS)[number];
export interface DocumentCue {
  index: number;
  start: string;
  end: string;
  text: string;
  textStart: number;
  textEnd: number;
}
export interface SubtitleDocument {
  content: string;
  extension: DocumentExtension;
  cues: DocumentCue[];
  cueCount: number;
  preservedCues: Array<Pick<DocumentCue, 'index' | 'start' | 'end'>>;
}
interface SourceLine {
  text: string;
  start: number;
  end: number;
}
export function decodeSubtitle(input: Buffer | string): string {
  if (typeof input === 'string') return input;
  const utf16 =
    input[0] === 0xff && input[1] === 0xfe
      ? 'utf-16le'
      : input[0] === 0xfe && input[1] === 0xff
        ? 'utf-16be'
        : undefined;
  if (utf16) {
    try {
      return new TextDecoder(utf16, { fatal: true, ignoreBOM: true }).decode(
        input,
      );
    } catch {
      throw new Error(
        'Invalid UTF-16 subtitle. Re-save the file as UTF-8 or UTF-16 with a BOM.',
      );
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      input,
    );
  } catch {
    if (input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf)
      throw new Error(
        'Invalid UTF-8 subtitle despite its BOM. Re-save the file as valid UTF-8.',
      );
  }
  const ambiguous =
    'Subtitle encoding is ambiguous or unsupported. Re-save the file as UTF-8 (recommended) or UTF-16 with a BOM.';
  const detected = jschardet.detect(input);
  if (
    !detected.encoding ||
    !Number.isFinite(detected.confidence) ||
    detected.confidence < 0.9 ||
    detected.confidence > 1 ||
    /^(?:utf-?8|ascii)$/i.test(detected.encoding) ||
    !iconv.encodingExists(detected.encoding)
  )
    throw new Error(ambiguous);
  const decoded = iconv.decode(input, detected.encoding);
  if (
    decoded.includes('\ufffd') ||
    !iconv.encode(decoded, detected.encoding).equals(input)
  )
    throw new Error(ambiguous);
  return decoded;
}
function sourceLines(content: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const re = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  for (const m of content.matchAll(re)) {
    if (m[0] === '') break;
    lines.push({ text: m[1], start: m.index, end: m.index + m[1].length });
  }
  return lines;
}
export function timestamp(
  value: string,
  format: 'srt' | 'vtt' | 'ass',
): number {
  const pattern =
    format === 'ass'
      ? /^(\d+):([0-5]\d):([0-5]\d)\.(\d{2})$/
      : format === 'srt'
        ? /^(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})$/
        : /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/;
  const match = pattern.exec(value.trim());
  if (!match)
    throw new Error(`Invalid ${format.toUpperCase()} timestamp: ${value}`);
  const milliseconds =
    (Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3])) *
      1000 +
    Number(match[4]) * (format === 'ass' ? 10 : 1);
  if (!Number.isSafeInteger(milliseconds))
    throw new Error('Subtitle timestamp exceeds safe range');
  return milliseconds;
}
export function parseDocument(
  content: string,
  extension: DocumentExtension,
): SubtitleDocument {
  if (content.includes('\0') || content.includes('\ufffd'))
    throw new Error('Subtitle contains invalid encoding or NUL characters');
  const lines = sourceLines(content);
  const cues: DocumentCue[] = [];
  const preservedCues: SubtitleDocument['preservedCues'] = [];
  let cueCount = 0;
  if (extension === 'ass' || extension === 'ssa') {
    let inEvents = false;
    let fields = [
      'layer',
      'start',
      'end',
      'style',
      'name',
      'marginl',
      'marginr',
      'marginv',
      'effect',
      'text',
    ];
    for (const line of lines) {
      const text = line.text.replace(/^\ufeff/, '');
      if (/^\s*\[/.test(text)) inEvents = /^\s*\[Events\]\s*$/i.test(text);
      if (inEvents && /^\s*Format:/i.test(text)) {
        fields = text
          .slice(text.indexOf(':') + 1)
          .split(',')
          .map((s) => s.trim().toLowerCase());
        if (
          fields.at(-1) !== 'text' ||
          !fields.includes('start') ||
          !fields.includes('end')
        )
          throw new Error(
            'ASS Events Format must end with Text and include Start/End',
          );
      }
      if (!/^\s*Dialogue:/i.test(text)) continue;
      const bodyStart = line.text.indexOf(':') + 1;
      const values: string[] = [];
      let start = bodyStart;
      for (let i = 0; i < fields.length - 1; i++) {
        const comma = line.text.indexOf(',', start);
        if (comma < 0) throw new Error('Malformed ASS dialogue fields');
        values.push(line.text.slice(start, comma));
        start = comma + 1;
      }
      const from = values[fields.indexOf('start')];
      const to = values[fields.indexOf('end')];
      const duration = timestamp(to, 'ass') - timestamp(from, 'ass');
      if (duration < 0) throw new Error('ASS cue end precedes start');
      const dialogue = line.text.slice(start);
      const index = ++cueCount;
      if (duration === 0 || !dialogue.trim()) {
        preservedCues.push({ index, start: from, end: to });
        continue;
      }
      cues.push({
        index,
        start: from,
        end: to,
        text: dialogue,
        textStart: line.start + start,
        textEnd: line.end,
      });
    }
  } else {
    let i = 0;
    if (extension === 'vtt') {
      if (!/^\ufeff?WEBVTT(?:[ \t].*)?$/.test(lines[0]?.text ?? ''))
        throw new Error('Missing WEBVTT header');
      i = 1;
      while (i < lines.length && lines[i].text.trim()) i++;
    }
    while (i < lines.length) {
      if (!lines[i].text.trim()) {
        i++;
        continue;
      }
      if (
        extension === 'vtt' &&
        /^(NOTE(?:[ \t]|$)|STYLE$|REGION$)/.test(lines[i].text)
      ) {
        while (i < lines.length && lines[i].text.trim()) i++;
        continue;
      }
      let index = cueCount + 1;
      if (extension === 'srt') {
        const id = lines[i].text.replace(/^\ufeff/, '').trim();
        if (!/^\d+$/.test(id))
          throw new Error(`Invalid SRT cue index at line ${i + 1}`);
        index = Number(id);
        if (!Number.isSafeInteger(index))
          throw new Error('SRT cue index exceeds safe range');
        i++;
      } else if (!lines[i].text.includes('-->')) i++;
      const timing = /^\s*(\S+)\s+-->\s+(\S+)(.*)$/.exec(lines[i]?.text ?? '');
      if (!timing)
        throw new Error(
          `Invalid ${extension.toUpperCase()} cue timing at line ${i + 1}`,
        );
      if (
        extension === 'srt' &&
        timing[3].trim() &&
        !/^\s*(?:[XY][12]:\d+\s*)+$/.test(timing[3])
      )
        throw new Error('Invalid SRT timing suffix');
      const duration =
        timestamp(timing[2], extension) - timestamp(timing[1], extension);
      if (duration < 0) throw new Error('Cue end precedes start');
      i++;
      const first = i;
      while (i < lines.length && lines[i].text.trim()) {
        if (
          extension === 'srt' &&
          /^\d+$/.test(lines[i].text.trim()) &&
          /^\s*[\d:,.]+\s+-->/.test(lines[i + 1]?.text ?? '')
        )
          break;
        if (
          lines[i].text.includes('-->') &&
          (extension === 'vtt' || /^\s*[\d:,.]+\s+-->/.test(lines[i].text))
        )
          throw new Error(`Unexpected cue boundary at line ${i + 1}`);
        i++;
      }
      cueCount++;
      if (duration === 0 || i === first) {
        preservedCues.push({ index, start: timing[1], end: timing[2] });
        continue;
      }
      cues.push({
        index,
        start: timing[1],
        end: timing[2],
        text: lines
          .slice(first, i)
          .map((l) => l.text)
          .join('\n'),
        textStart: lines[first].start,
        textEnd: lines[i - 1].end,
      });
    }
  }
  return { content, extension, cues, cueCount, preservedCues };
}
export function buildDocument(
  document: SubtitleDocument,
  translations: string[],
): string {
  if (translations.length !== document.cues.length)
    throw new Error('Subtitle cue count changed');
  let output = '';
  let cursor = 0;
  for (let i = 0; i < translations.length; i++) {
    const cue = document.cues[i];
    const original = document.content.slice(cue.textStart, cue.textEnd);
    const newlines = original.match(/\r\n|\r|\n/g) ?? [];
    let newlineIndex = 0;
    output +=
      document.content.slice(cursor, cue.textStart) +
      translations[i].replace(
        /\r\n|\r|\n/g,
        () => newlines[newlineIndex++] ?? '\n',
      );
    cursor = cue.textEnd;
  }
  return output + document.content.slice(cursor);
}
