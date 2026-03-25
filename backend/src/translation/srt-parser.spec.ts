import { SrtParser } from './srt-parser';
import { SrtBuilder } from './srt-builder';

describe('SRT parser and builder', () => {
  it('roundtrips a multiline subtitle file', () => {
    const parser = new SrtParser();
    const builder = new SrtBuilder();

    const input = `1
00:00:01,000 --> 00:00:03,500
Hello there.

2
00:00:04,000 --> 00:00:06,800
General Kenobi.
You are a bold one.
`;

    const cues = parser.parse(input);
    expect(cues).toHaveLength(2);
    expect(cues[1]?.text).toContain('You are a bold one.');

    const rebuilt = builder.build(cues);
    expect(rebuilt).toContain('00:00:04,000 --> 00:00:06,800');
    expect(rebuilt).toContain('General Kenobi.');
  });
});
