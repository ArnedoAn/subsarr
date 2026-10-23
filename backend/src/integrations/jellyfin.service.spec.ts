jest.mock('../settings/settings.service', () => ({
  SettingsService: class {},
}));

import { Logger } from '@nestjs/common';
import type { SettingsService } from '../settings/settings.service';
import { JellyfinService } from './jellyfin.service';

describe('JellyfinService diagnostics', () => {
  const secret = 'private-api-key';
  let service: JellyfinService;
  let settings: { jellyfinUrl: string; jellyfinApiKey: string };
  let fetchMock: jest.SpyInstance<Promise<Response>, Parameters<typeof fetch>>;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    settings = {
      jellyfinUrl: 'https://jellyfin.example/',
      jellyfinApiKey: secret,
    };
    service = new JellyfinService({
      getSettings: jest
        .fn()
        .mockImplementation(() => Promise.resolve(settings)),
    } as unknown as SettingsService);
    fetchMock = jest.spyOn(globalThis, 'fetch');
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('requires configuration without making requests', async () => {
    settings.jellyfinApiKey = ' ';
    await expect(service.testConnection()).resolves.toEqual({
      ok: false,
      error: 'URL or API key missing',
    });
    await service.refreshLibraryAfterSubtitle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('authenticates and prohibits redirects on both endpoints', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(service.testConnection()).resolves.toEqual({ ok: true });
    await service.refreshLibraryAfterSubtitle();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://jellyfin.example/System/Info',
      expect.objectContaining({
        headers: { 'X-Emby-Token': secret },
        redirect: 'error',
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://jellyfin.example/Library/Refresh',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
      }),
    );
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each([401, 403, 500])(
    'reports HTTP %s without exposing response bodies',
    async (status) => {
      fetchMock.mockResolvedValue(new Response(`echo ${secret}`, { status }));
      await expect(service.testConnection()).resolves.toEqual({
        ok: false,
        error: `HTTP ${status}`,
      });
      await service.refreshLibraryAfterSubtitle();
      expect(warn).toHaveBeenCalledWith(
        `Jellyfin refresh failed: HTTP ${status}`,
      );
    },
  );

  it('reports rate limits with Retry-After seconds', async () => {
    fetchMock.mockResolvedValue(
      new Response(secret, { status: 429, headers: { 'Retry-After': '42' } }),
    );
    await expect(service.testConnection()).resolves.toEqual({
      ok: false,
      error: 'HTTP 429: rate limited; retry after 42 seconds',
    });
    await service.refreshLibraryAfterSubtitle();
    expect(warn).toHaveBeenCalledWith(
      'Jellyfin refresh failed: HTTP 429: rate limited; retry after 42 seconds',
    );
  });

  it('supports Retry-After dates without displaying arbitrary header values', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-01T00:00:00Z'));
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 429,
        headers: { 'Retry-After': 'Thu, 01 Jan 2026 00:00:10 GMT' },
      }),
    );
    await expect(service.testConnection()).resolves.toEqual({
      ok: false,
      error: 'HTTP 429: rate limited; retry after 10 seconds',
    });
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { 'Retry-After': secret } }),
    );
    await expect(service.testConnection()).resolves.toEqual({
      ok: false,
      error: 'HTTP 429: rate limited',
    });
  });

  it.each(['TimeoutError', 'AbortError'])(
    'clearly reports %s without leaking request details',
    async (name) => {
      fetchMock.mockRejectedValue(Object.assign(new Error(secret), { name }));
      await expect(service.testConnection()).resolves.toEqual({
        ok: false,
        error: 'Jellyfin request timed out',
      });
      await service.refreshLibraryAfterSubtitle();
      expect(warn).toHaveBeenCalledWith(
        'Jellyfin refresh error: Jellyfin request timed out',
      );
    },
  );

  it('sanitizes connection and redirect failures', async () => {
    fetchMock.mockRejectedValue(
      new TypeError(`failed https://user:${secret}@example`),
    );
    const result = await service.testConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('connection failed');
    expect(result.error).toContain('redirects are not allowed');
    expect(result.error).not.toContain(secret);
    await service.refreshLibraryAfterSubtitle();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
  });

  it('never reports an HTTP redirect as success', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: `https://attacker.example/${secret}` },
      }),
    );
    await expect(service.testConnection()).resolves.toEqual({
      ok: false,
      error: 'HTTP 302: redirects are not allowed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
