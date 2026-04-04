import { AssParser, splitAssDialogueBody } from './ass-parser';
import { AssBuilder } from './ass-builder';

describe('AssParser and AssBuilder', () => {
  const sample = `[Script Info]
Title: Test

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.23,0:00:03.45,Default,,0,0,0,,Hello world
Dialogue: 0,0:00:05.00,0:00:07.00,Default,,0,0,0,,Line one\\NLine two
Dialogue: 0,0:00:10.00,0:00:12.00,Default,,0,0,0,,Comma, inside, text
Comment: 0,0:00:00.00,0:00:00.00,Default,,0,0,0,,Skip me
`;

  it('parses Dialogue text and preserves header and comments', () => {
    const parser = new AssParser();
    const lines = parser.parse(sample);
    const dialogue = lines.filter((l) => l.kind === 'dialogue');
    expect(dialogue).toHaveLength(3);
    expect(dialogue[0]).toMatchObject({
      kind: 'dialogue',
      text: 'Hello world',
    });
    expect(dialogue[1]).toMatchObject({
      kind: 'dialogue',
      text: 'Line one\\NLine two',
    });
    expect(dialogue[2]).toMatchObject({
      kind: 'dialogue',
      text: 'Comma, inside, text',
    });

    const comment = lines.find(
      (l) => l.kind === 'verbatim' && l.line.includes('Comment:'),
    );
    expect(comment?.kind).toBe('verbatim');
  });

  it('round-trips through builder', () => {
    const parser = new AssParser();
    const builder = new AssBuilder();
    const lines = parser.parse(sample);
    const rebuilt = builder.build(lines);
    const again = parser.parse(rebuilt);
    expect(again).toEqual(lines);
  });

  it('splitAssDialogueBody handles nine commas before text', () => {
    const body = '0,0:00:01.23,0:00:03.45,Default,,0,0,0,,Hello, with, commas';
    const r = splitAssDialogueBody(body);
    expect(r).not.toBeNull();
    expect(r!.text).toBe('Hello, with, commas');
  });
});
