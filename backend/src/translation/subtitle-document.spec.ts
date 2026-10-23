import * as iconv from 'iconv-lite';
import {
  parseDocument,
  buildDocument,
  decodeSubtitle,
} from './subtitle-document';
import { AssParser } from './ass-parser';
import { AssBuilder } from './ass-builder';
import { VttParser } from './vtt-parser';
import { VttBuilder } from './vtt-builder';
import {
  chunkCues,
  parseTranslationJson,
  protectMarkup,
} from './translation-boundaries';
describe('subtitle document boundaries', () => {
  it('parses BOM, CR-only and missing blank cue separators without dropping cues', () => {
    const input =
      '\ufeff1\r00:00:01,000 --> 00:00:02,000\rHello\r2\r00:00:03,000 --> 00:00:04,000\rWorld\r';
    const document = parseDocument(input, 'srt');
    expect(document.cues.map((cue) => cue.text)).toEqual(['Hello', 'World']);
    expect(buildDocument(document, ['Hola', 'Mundo'])).toBe(
      input.replace('Hello', 'Hola').replace('World', 'Mundo'),
    );
  });
  it('does not mistake numeric dialogue and literal arrows for cue headers', () => {
    const input = '1\n00:00:01,000 --> 00:00:02,000\n2\r\nGo --> there\rLast';
    const document = parseDocument(input, 'srt');
    expect(document.cues).toHaveLength(1);
    expect(buildDocument(document, ['2\nVe --> alli\nUltimo'])).toBe(
      input.replace('Go --> there', 'Ve --> alli').replace('Last', 'Ultimo'),
    );
  });
  it.each([
    '1\nnot a timestamp\nHello',
    '1\n00:00:03,000 --> 00:00:02,000\nHello',
    '1\n00:00:00,000 --> 00:00:01,000\nHello\n\nbroken cue',
  ])(
    'rejects malformed cues rather than silently discarding them: %s',
    (input) => {
      expect(() => parseDocument(input, 'srt')).toThrow();
    },
  );
  it('preserves exact ASS casing, whitespace, mixed newlines, custom fields and missing trailing newline', () => {
    const input =
      '\ufeff[Events]\r\nFormat: Start, End, Text\n  dIaLoGuE: 0:00:01.00,0:00:02.00,{\\i1}Hello, world{\\i0}\rComment: untouched';
    expect(new AssBuilder().build(new AssParser().parse(input))).toBe(input);
    const document = parseDocument(input, 'ssa');
    expect(buildDocument(document, ['{\\i1}Hola, mundo{\\i0}'])).toBe(
      input.replace('Hello, world', 'Hola, mundo'),
    );
  });
  it('round-trips VTT identifiers, settings, NOTE, STYLE and markup', () => {
    const input =
      '\ufeffWEBVTT example\r\n\r\nSTYLE\r\n::cue { color: white; }\r\n\r\nNOTE preserved\r\ncomment\r\n\r\nscene-1\r\n00:01.000 --> 00:02.500 align:start position:10%\r\n<v Alice>Hello</v>\r\n';
    const document = new VttParser().parse(input);
    expect(document.cues).toHaveLength(1);
    expect(new VttBuilder().build(document)).toBe(input);
    expect(buildDocument(document, ['<v Alice>Hola</v>'])).toBe(
      input.replace('Hello', 'Hola'),
    );
  });
  it('decodes UTF8 BOM and rejects malformed UTF8', () => {
    expect(decodeSubtitle(Buffer.from('\ufeffHello'))).toBe('\ufeffHello');
    expect(() =>
      decodeSubtitle(Buffer.from([0xef, 0xbb, 0xbf, 0xc3, 0x28])),
    ).toThrow('Invalid UTF-8');
  });
  it('detects a real Windows-1252 subtitle without replacement corruption', () => {
    const dialogue =
      '¡Qué extraño! José llegó al corazón de la ciudad. “Mañana habrá música”, dijo María. El café cuesta 10 €.';
    const input = `1\r\n00:00:01,000 --> 00:00:05,000\r\n${Array.from({ length: 20 }, () => dialogue).join('\r\n')}\r\n`;
    expect(decodeSubtitle(iconv.encode(input, 'windows-1252'))).toBe(input);
  });
  it.each([
    [
      'ass',
      '[Events]\nFormat: Start, End, Text\nDialogue: 0:00:03.00,0:00:02.00,',
    ],
    ['srt', '1\n00:00:03,000 --> 00:00:02,000\n'],
    ['vtt', 'WEBVTT\n\n00:03.000 --> 00:02.000\n'],
  ] as const)(
    'rejects reverse-time %s cues even when text is empty',
    (extension, input) => {
      expect(() => parseDocument(input, extension)).toThrow('precedes');
    },
  );
  it('maps every cue exactly once across budget chunks with read-only overlap', () => {
    const lines = Array.from({ length: 7 }, (_, i) => `${i}:` + 'x'.repeat(70));
    const chunks = chunkCues(lines, undefined, 220);
    expect(chunks.flatMap((chunk) => chunk.indices)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(chunks[1].before).toEqual(lines.slice(0, 2));
    expect(() => chunkCues(['x'.repeat(300)], undefined, 220)).toThrow(
      'budget',
    );
  });
  it('protects ASS drawings, HTML, entities and line markers without token loss or invention', () => {
    const source = '{\\p1}m 0 0 l 10 10{\\p0}<i>Hello</i>\\N&amp;';
    const protectedCue = protectMarkup(source);
    expect(protectedCue.text).not.toContain('m 0 0');
    expect(
      protectedCue.restore(protectedCue.text.replace('Hello', 'Hola')),
    ).toBe(source.replace('Hello', 'Hola'));
    expect(() => protectedCue.restore('Hola')).toThrow('markup');
    expect(() => protectMarkup('Hello').restore('<b>Hola</b>')).toThrow(
      'markup',
    );
  });
  it.each([
    '["Hola"]',
    '{"translations":["Hola"]}',
    '{"data":[3]}',
    '{"data":[]}',
    'not json',
  ])('strictly rejects invalid provider payload %s', (payload) => {
    expect(() => parseTranslationJson(payload, 1)).toThrow();
  });
});
