import { createHash } from 'node:crypto';
import { subtitleMarkup } from '../translation/translation-boundaries';
import {
  timestamp,
  type SubtitleDocument,
} from '../translation/subtitle-document';
import type {
  SubtitleQualityIssue,
  SubtitleQualityReport,
} from './workspace.types';

/**
 * Machine output must keep the source line count. Human-authored text (manual
 * edits, uploaded translations) may re-break lines; that is how readability
 * warnings get fixed. Protected markup is always enforced.
 */
export function validateCueText(
  source: string,
  target: string,
  { allowLineBreakChanges = false }: { allowLineBreakChanges?: boolean } = {},
): void {
  if (typeof target !== 'string' || !target.trim() || target.length > 32000)
    throw new Error('Cue text must contain 1 to 32000 characters');
  if (
    JSON.stringify(subtitleMarkup(source)) !==
    JSON.stringify(subtitleMarkup(target))
  )
    throw new Error('Cue changed protected markup');
  if (
    !allowLineBreakChanges &&
    (source.match(/\r\n|\r|\n/g)?.length ?? 0) !==
      (target.match(/\r\n|\r|\n/g)?.length ?? 0)
  )
    throw new Error('Cue changed line structure');
}

export function cueContextHash(sources: string[], index: number): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        sources[index - 1] ?? null,
        sources[index],
        sources[index + 1] ?? null,
      ]),
    )
    .digest('hex');
}

export function memorySignature(glossary: string, context: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify({ glossary, context, revision: 'subtitle-quality-v1' }),
    )
    .digest('hex');
}

export function displaySubtitleText(text: string, extension: string): string {
  const visible =
    extension === 'ass' || extension === 'ssa'
      ? text
          .replace(/\{[^}]*\}/g, '')
          .replace(/\\[Nn]/g, '\n')
          .replace(/\\h/g, ' ')
      : text.replace(/<[^>]*>/g, '');
  return visible.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi,
    (
      entity: string,
      decimal: string | undefined,
      hex: string | undefined,
      named: string | undefined,
    ) => {
      if (decimal || hex) {
        const value = parseInt(decimal ?? hex!, decimal ? 10 : 16);
        return value > 0 &&
          value <= 0x10ffff &&
          !(value >= 0xd800 && value <= 0xdfff)
          ? String.fromCodePoint(value)
          : entity;
      }
      return (
        (
          {
            amp: '&',
            lt: '<',
            gt: '>',
            quot: '"',
            apos: "'",
            nbsp: ' ',
          } as Record<string, string>
        )[named?.toLowerCase() ?? ''] ?? entity
      );
    },
  );
}

export function evaluateSubtitleQuality(
  document: SubtitleDocument,
  translations: string[],
): SubtitleQualityReport {
  if (translations.length !== document.cues.length)
    throw new Error('Quality report requires unchanged cue count');
  const format = document.extension === 'ssa' ? 'ass' : document.extension;
  const cues = document.cues.map((cue, cueIndex) => {
    const text = translations[cueIndex];
    const issues: SubtitleQualityIssue[] = [];
    try {
      validateCueText(cue.text, text, { allowLineBreakChanges: true });
    } catch (error) {
      issues.push({
        code: 'structure',
        message:
          error instanceof Error ? error.message : 'Invalid cue structure',
        severity: 'error',
      });
    }
    const visible = displaySubtitleText(text, document.extension);
    const lineLengths = visible
      .split(/\r\n|\r|\n/)
      .map((line) => Array.from(line).length);
    const duration = timestamp(cue.end, format) - timestamp(cue.start, format);
    const charsPerSecond =
      duration > 0
        ? Math.round(
            (Array.from(visible.replace(/\r\n|\r|\n/g, '')).length * 100000) /
              duration,
          ) / 100
        : 0;
    if (charsPerSecond > 20)
      issues.push({
        code: 'cps',
        message: 'Reading speed exceeds 20 characters per second',
        severity: 'warning',
      });
    if (lineLengths.some((length) => length > 42))
      issues.push({
        code: 'line-length',
        message: 'A line exceeds 42 characters',
        severity: 'warning',
      });
    if (lineLengths.length > 2)
      issues.push({
        code: 'line-count',
        message: 'Cue has more than two lines',
        severity: 'warning',
      });
    if (duration < 500)
      issues.push({
        code: 'duration',
        message: 'Cue duration is shorter than 500ms',
        severity: 'warning',
      });
    if (text === cue.text && /[\p{L}]/u.test(text))
      issues.push({
        code: 'unchanged',
        message: 'Target equals source; verify whether translation is needed',
        severity: 'warning',
      });
    return {
      cueIndex,
      index: cue.index,
      start: cue.start,
      end: cue.end,
      source: cue.text,
      text,
      charsPerSecond,
      lineLengths,
      issues,
    };
  });
  return {
    cues,
    warningCount: cues.reduce(
      (sum, cue) =>
        sum + cue.issues.filter((issue) => issue.severity === 'warning').length,
      0,
    ),
    errorCount: cues.reduce(
      (sum, cue) =>
        sum + cue.issues.filter((issue) => issue.severity === 'error').length,
      0,
    ),
    suspectCueIndices: cues
      .filter((cue) => cue.issues.length > 0)
      .map((cue) => cue.cueIndex),
  };
}
