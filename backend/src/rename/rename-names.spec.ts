import {
  DEFAULT_RENAME_TEMPLATES,
  parseRenameName,
  renderRenameTemplate,
  safeRenameFilename,
} from './rename-names';
describe('rename parsing and templates', () => {
  it.each<[string, number, number[]]>([
    ['Show.S02E03E04.1080p', 2, [3, 4]],
    ['Show.S02E03-E05', 2, [3, 4, 5]],
    ['Show.1x01-02.WEB-DL', 1, [1, 2]],
    ['Show.1x01x02', 1, [1, 2]],
    ['Show.S01E01-03', 1, [1, 2, 3]],
    ['Show.S01.E02', 1, [2]],
  ])('preserves all episode identities in %s', (stem, season, episodes) => {
    const parsed = parseRenameName(stem);
    expect(parsed).toMatchObject({
      kind: 'episode',
      title: 'Show',
      season,
      episodes,
      confidence: 'high',
    });
    expect(renderRenameTemplate(parsed, DEFAULT_RENAME_TEMPLATES)).toContain(
      'E',
    );
  });
  it('classifies anime absolute numbers with low confidence rather than guessing a season', () => {
    expect(parseRenameName('[Group] Anime - 123 [1080p]')).toMatchObject({
      kind: 'anime',
      title: 'Anime',
      absolute: 123,
      confidence: 'low',
    });
    expect(parseRenameName('Uncertain title')).toMatchObject({
      kind: 'unknown',
      confidence: 'low',
    });
  });
  it('parses bracketed movie years', () => {
    expect(parseRenameName('The.Matrix.[1999].2160p')).toMatchObject({
      kind: 'movie',
      title: 'The Matrix',
      year: 1999,
    });
    expect(parseRenameName('2001.A.Space.Odyssey.(1968)')).toMatchObject({
      kind: 'movie',
      title: '2001 A Space Odyssey',
      year: 1968,
    });
  });
  it('renders multi-episode Jellyfin names without dropping the second episode', () => {
    expect(
      renderRenameTemplate(
        {
          kind: 'episode',
          title: 'Show',
          season: 1,
          episodes: [1, 2],
          confidence: 'manual',
        },
        DEFAULT_RENAME_TEMPLATES,
      ),
    ).toBe('Show - S01E01E02');
  });
  it.each([
    '../escape.mkv',
    'folder\\escape.mkv',
    'a/b.mkv',
    'CON.mkv',
    'bad\u0000.mkv',
    'trailing.',
  ])('rejects unsafe filename %s', (name) => {
    expect(() => safeRenameFilename(name)).toThrow();
  });
  it('rejects unknown tokens and invalid episode values', () => {
    expect(() =>
      renderRenameTemplate(
        { kind: 'movie', title: 'Movie', year: 2020, confidence: 'manual' },
        { ...DEFAULT_RENAME_TEMPLATES, movie: '{title}/{year}' },
      ),
    ).toThrow();
    expect(() =>
      renderRenameTemplate(
        {
          kind: 'episode',
          title: 'Show',
          season: 1,
          episodes: [-1],
          confidence: 'manual',
        },
        DEFAULT_RENAME_TEMPLATES,
      ),
    ).toThrow();
  });
  it('sanitizes parsed punctuation and bounds metadata title tokens without changing suffixes', () => {
    const movie = parseRenameName('Spider-Man: No Way Home (2021)');
    expect(renderRenameTemplate(movie, DEFAULT_RENAME_TEMPLATES)).toBe(
      'Spider-Man - No Way Home (2021)',
    );
    const rendered = renderRenameTemplate(
      {
        kind: 'movie',
        title: `${'Long '.repeat(70)}: <unsafe>\u0000.... `,
        year: 2020,
        confidence: 'manual',
      },
      DEFAULT_RENAME_TEMPLATES,
    );
    expect(rendered.length).toBeLessThan(180);
    expect(rendered).toMatch(/ \(2020\)$/);
    expect(() =>
      safeRenameFilename(`${rendered}.eng.forced.srt`),
    ).not.toThrow();
    expect(
      renderRenameTemplate(
        { kind: 'unknown', title: 'Trailing. ', confidence: 'low' },
        DEFAULT_RENAME_TEMPLATES,
      ),
    ).toBe('Trailing');
    expect(() => safeRenameFilename('../escape.mkv')).toThrow();
  });
});
