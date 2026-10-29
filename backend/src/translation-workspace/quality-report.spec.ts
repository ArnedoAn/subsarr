import { parseDocument } from '../translation/subtitle-document';
import {
  cueContextHash,
  displaySubtitleText,
  evaluateSubtitleQuality,
} from './quality-report';

describe('subtitle readability report', () => {
  it('uses strict thresholds, counts display spaces, and never changes timings', () => {
    const document = parseDocument(
      '1\n00:00:01,000 --> 00:00:01,500\nHello\n\n2\n00:00:02,000 --> 00:00:03,000\nHello\n',
      'srt',
    );
    const report = evaluateSubtitleQuality(document, [
      '12345 7890',
      '123456789012345678901',
    ]);
    expect(report.cues[0].charsPerSecond).toBe(20);
    expect(report.cues[0].issues).toEqual([]);
    expect(report.cues[1].issues.map((issue) => issue.code)).toEqual(['cps']);
    expect(document.cues[0].start).toBe('00:00:01,000');
    expect(document.cues[0].end).toBe('00:00:01,500');
  });
  it('reports line length, short duration and line count as warnings, not errors', () => {
    const document = parseDocument(
      '1\n00:00:00,000 --> 00:00:00,499\nHello\nthere\nfriend\n',
      'srt',
    );
    const report = evaluateSubtitleQuality(document, [
      'a'.repeat(43) + '\nb\nc',
    ]);
    expect(report.errorCount).toBe(0);
    expect(report.cues[0].issues.map((issue) => issue.code)).toEqual([
      'cps',
      'line-length',
      'line-count',
      'duration',
    ]);
  });
  it('decodes display entities and ASS tags without altering protected source text', () => {
    expect(displaySubtitleText('{\\i1}Hola{\\i0}\\Nqué\\htal', 'ass')).toBe(
      'Hola\nqué tal',
    );
    expect(displaySubtitleText('<i>A &amp; B &#x1f600;</i>', 'srt')).toBe(
      'A & B 😀',
    );
    expect(displaySubtitleText('&#0; &#x110000;', 'srt')).toBe(
      '&#0; &#x110000;',
    );
  });
  it('separates invalid structure from readability and fingerprints neighbors exactly', () => {
    const document = parseDocument(
      '1\n00:00:01,000 --> 00:00:03,000\n<i>Hello</i>\n',
      'srt',
    );
    expect(evaluateSubtitleQuality(document, ['Hola']).errorCount).toBe(1);
    expect(cueContextHash(['a', 'b', 'c'], 1)).not.toBe(
      cueContextHash(['a', 'b', 'd'], 1),
    );
  });
});
