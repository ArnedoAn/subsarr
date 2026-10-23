import { SettingsService } from '../settings/settings.service';
import { RenameMetadataService } from './rename-metadata.service';

describe('RenameMetadataService', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });
  it('makes no external request when integrations are not configured', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const settings = {
      getSettings: () => Promise.resolve({}),
    } as unknown as SettingsService;
    const service = new RenameMetadataService(settings);
    const reply = await service.lookup('Movie', 'movie');
    expect(reply.matches).toEqual([]);
    expect(reply.warnings).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('prefers Jellyfin candidates, caches queries, and requires an explicit issued match ID', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            Items: [
              { Name: 'Movie', ProductionYear: 2000 },
              { Name: 'Movie', ProductionYear: 2020 },
            ],
          }),
          { status: 200 },
        ),
      );
    global.fetch = fetchMock;
    const settings = {
      getSettings: () =>
        Promise.resolve({
          jellyfinUrl: 'http://metadata.invalid',
          jellyfinApiKey: 'saved-jellyfin-key',
          tmdbApiKey: 'saved-tmdb-key',
        }),
    } as unknown as SettingsService;
    const service = new RenameMetadataService(settings);
    const reply = await service.lookup('Movie', 'movie');
    expect(reply.matches).toHaveLength(2);
    expect(reply.matches.every((match) => match.source === 'jellyfin')).toBe(
      true,
    );
    expect(service.select(reply.matches[1].id)).toMatchObject({
      title: 'Movie',
      year: 2020,
    });
    expect(() => service.select('external-unissued-id')).toThrow();
    await service.lookup('Movie', 'movie');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0];
    if (!(url instanceof URL)) throw new Error('Expected metadata URL object');
    expect(url.pathname).toBe('/Items');
    expect(url.search).not.toContain('saved-jellyfin-key');
  });
  it('falls back to TMDB on a Jellyfin failure without hiding the provider warning', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              { title: 'Movie', release_date: '2020-01-01' },
              { title: 99 },
            ],
          }),
          { status: 200 },
        ),
      );
    global.fetch = fetchMock;
    const settings = {
      getSettings: () =>
        Promise.resolve({
          jellyfinUrl: 'http://metadata.invalid',
          jellyfinApiKey: 'key',
          tmdbApiKey: 'tmdb',
        }),
    } as unknown as SettingsService;
    const reply = await new RenameMetadataService(settings).lookup(
      'Movie',
      'movie',
    );
    expect(reply.matches).toHaveLength(1);
    expect(reply.matches[0]).toMatchObject({
      title: 'Movie',
      year: 2020,
      source: 'tmdb',
    });
    expect(reply.warnings[0]).toContain('Jellyfin');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('rejects missing or unsupported lookup classifications', async () => {
    const settings = {
      getSettings: () => Promise.resolve({}),
    } as unknown as SettingsService;
    await expect(
      new RenameMetadataService(settings).lookup('', 'movie'),
    ).rejects.toThrow();
  });
  it('does not cache failed or timed-out provider lookups', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Items: [{ Name: 'Recovered: Movie', ProductionYear: 2020 }],
          }),
          { status: 200 },
        ),
      );
    global.fetch = fetchMock;
    const settings = {
      getSettings: () =>
        Promise.resolve({
          jellyfinUrl: 'http://metadata.invalid',
          jellyfinApiKey: 'saved-key',
        }),
    } as unknown as SettingsService;
    const service = new RenameMetadataService(settings);
    const failed = await service.lookup('Recovered', 'movie');
    expect(failed.matches).toEqual([]);
    expect(failed.warnings).toHaveLength(1);
    const recovered = await service.lookup('Recovered', 'movie');
    expect(recovered.matches[0].title).toBe('Recovered: Movie');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await service.lookup('Recovered', 'movie');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
