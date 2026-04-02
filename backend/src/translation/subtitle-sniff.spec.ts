import { looksLikeAssSubtitle } from './subtitle-sniff';

describe('subtitle-sniff', () => {
  it('detects ASS headers', () => {
    expect(looksLikeAssSubtitle('[Script Info]\nTitle: Test')).toBe(true);
    expect(looksLikeAssSubtitle('[V4+ Styles]\n')).toBe(true);
    expect(looksLikeAssSubtitle('1\n00:00:00,000 --> 00:00:01,000\nHi')).toBe(
      false,
    );
  });
});
