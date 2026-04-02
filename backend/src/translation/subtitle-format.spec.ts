import {
  isAssSubtitleCodec,
  subtitleOutputExtensionFromCodec,
} from './subtitle-format';

describe('subtitle-format', () => {
  it('detects ASS/SSA codecs', () => {
    expect(isAssSubtitleCodec('ass')).toBe(true);
    expect(isAssSubtitleCodec('ASS')).toBe(true);
    expect(isAssSubtitleCodec('ssa')).toBe(true);
    expect(isAssSubtitleCodec('ssa_subtitle')).toBe(true);
    expect(isAssSubtitleCodec('subrip')).toBe(false);
  });

  it('maps codec to output extension', () => {
    expect(subtitleOutputExtensionFromCodec('ass')).toBe('ass');
    expect(subtitleOutputExtensionFromCodec('subrip')).toBe('srt');
  });
});
