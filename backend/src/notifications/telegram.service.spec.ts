jest.mock('../settings/settings.service', () => ({
  SettingsService: class {},
}));
jest.mock('node:timers/promises', () => ({
  setTimeout: jest.fn().mockResolvedValue(undefined),
}));

import { Logger } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import type { SettingsService } from '../settings/settings.service';
import { TelegramService } from './telegram.service';

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe('TelegramService diagnostics', () => {
  const token = '123:private-token';
  const chat = 'private-chat-id';
  let service: TelegramService;
  let settings: {
    telegramBotToken: string;
    telegramChatId: string;
    telegramEnabled: boolean;
    telegramEvents: string[];
  };
  let fetchMock: jest.SpyInstance<Promise<Response>, Parameters<typeof fetch>>;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    settings = {
      telegramBotToken: token,
      telegramChatId: chat,
      telegramEnabled: true,
      telegramEvents: ['scan.completed'],
    };
    service = new TelegramService({
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

  it('requires credentials for tests without making requests', async () => {
    settings.telegramBotToken = ' ';
    expect(await service.sendTestMessage()).toMatchObject({ ok: false });
    expect(await service.getConnectionStatus()).toMatchObject({
      ok: false,
      botOk: false,
      chatOk: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts HTTP and API success and prevents redirects for every method', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        response({ ok: true, result: { username: 'subsarr_bot' } }),
      ),
    );
    expect(await service.sendTestMessage()).toEqual({ ok: true });
    expect(await service.getConnectionStatus()).toEqual({
      ok: true,
      botOk: true,
      chatOk: true,
      botUsername: 'subsarr_bot',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://api.telegram.org/bot${token}/sendMessage`,
    );
    const body: unknown = JSON.parse(
      fetchMock.mock.calls[0][1]?.body as string,
    );
    expect(body).toMatchObject({ chat_id: chat });
    expect(fetchMock.mock.calls[2][0]).toContain(
      `/getChat?chat_id=${encodeURIComponent(chat)}`,
    );
  });

  it.each([
    [
      200,
      { ok: false, error_code: 400, description: token },
      'HTTP 200: Telegram API error 400',
    ],
    [
      401,
      { ok: true, description: token },
      'HTTP 401: Telegram API did not confirm success',
    ],
    [
      403,
      { ok: false, error_code: 403, description: token },
      'HTTP 403: Telegram API error 403',
    ],
    [200, {}, 'HTTP 200: Telegram API did not confirm success'],
    [200, null, 'HTTP 200: Telegram API did not confirm success'],
  ])('rejects HTTP/API failures honestly (%s)', async (status, body, error) => {
    fetchMock.mockImplementation(() => Promise.resolve(response(body, status)));
    await expect(service.sendTestMessage()).resolves.toEqual({
      ok: false,
      error,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('does not treat malformed JSON or a proxy error as successful', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(`<html>${token}</html>`, { status: 502 }),
    );
    expect(await service.sendTestMessage()).toEqual({
      ok: false,
      error: 'HTTP 502: Telegram API did not confirm success',
    });
    fetchMock.mockResolvedValueOnce(new Response('not JSON'));
    expect(await service.sendTestMessage()).toEqual({
      ok: false,
      error: 'HTTP 200: Telegram API did not confirm success',
    });
  });

  it('does not query a chat after the bot fails HTTP validation', async () => {
    fetchMock.mockResolvedValue(response({ ok: true }, 401));
    const result = await service.getConnectionStatus();
    expect(result).toMatchObject({ ok: false, botOk: false, chatOk: false });
    expect(result.error).toContain('HTTP 401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves bot success when the chat fails API validation', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({ ok: true, result: { username: 'subsarr_bot' } }),
      )
      .mockResolvedValueOnce(
        response({ ok: false, error_code: 400, description: token }),
      );
    expect(await service.getConnectionStatus()).toEqual({
      ok: false,
      botOk: true,
      chatOk: false,
      botUsername: 'subsarr_bot',
      error: 'HTTP 200: Telegram API error 400',
    });
  });

  it('reports a missing chat honestly after checking the bot', async () => {
    settings.telegramChatId = '';
    fetchMock.mockResolvedValue(response({ ok: true }));
    expect(await service.getConnectionStatus()).toMatchObject({
      ok: false,
      botOk: true,
      chatOk: false,
      error: 'Chat ID not set',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([200, 429])(
    'retries a rate limit once using retry_after (%s)',
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(
          response(
            { ok: false, error_code: 429, parameters: { retry_after: 2 } },
            status,
          ),
        )
        .mockResolvedValueOnce(response({ ok: true }));
      expect(await service.sendTestMessage()).toEqual({ ok: true });
      expect(delay).toHaveBeenCalledTimes(1);
      expect(delay).toHaveBeenCalledWith(2000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it.each([31, 3600, -1, '2', undefined])(
    'does not wait or retry an unsupported retry_after (%s)',
    async (retryAfter) => {
      fetchMock.mockResolvedValue(
        response(
          {
            ok: false,
            error_code: 429,
            parameters: { retry_after: retryAfter },
            description: token,
          },
          429,
        ),
      );
      const result = await service.sendTestMessage();
      expect(result.ok).toBe(false);
      expect(result.error).toContain('HTTP 429: rate limited');
      expect(delay).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('bounds retries and reports a second rate limit honestly', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        response(
          { ok: false, error_code: 429, parameters: { retry_after: 1 } },
          429,
        ),
      ),
    );
    expect(await service.sendTestMessage()).toEqual({
      ok: false,
      error: 'HTTP 429: rate limited; retry after 1 seconds',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it.each(['TimeoutError', 'AbortError'])(
    'reports %s without leaking secrets or retrying',
    async (name) => {
      fetchMock.mockRejectedValue(
        Object.assign(new Error(`${token} ${chat}`), { name }),
      );
      expect(await service.sendTestMessage()).toEqual({
        ok: false,
        error: 'Telegram request timed out',
      });
      expect(delay).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('reports a timeout while reading the API response body', async () => {
    const pendingBody = response({ ok: true });
    jest
      .spyOn(pendingBody, 'json')
      .mockRejectedValue(
        Object.assign(new Error(token), { name: 'TimeoutError' }),
      );
    fetchMock.mockResolvedValue(pendingBody);
    expect(await service.sendTestMessage()).toEqual({
      ok: false,
      error: 'Telegram request timed out',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('sanitizes network errors for test and status endpoints', async () => {
    fetchMock.mockRejectedValue(new TypeError(`fetch ${token} ${chat}`));
    for (const result of [
      await service.sendTestMessage(),
      await service.getConnectionStatus(),
    ]) {
      expect(result.ok).toBe(false);
      expect(result.error).toContain('connection failed');
      expect(result.error).not.toContain(token);
      expect(result.error).not.toContain(chat);
    }
    expect(delay).not.toHaveBeenCalled();
  });

  it('rejects redirects without following them', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://attacker.example' },
      }),
    );
    expect(await service.sendTestMessage()).toEqual({
      ok: false,
      error: 'HTTP 302: redirects are not allowed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('error');
  });

  it('keeps periodic notifications best-effort while logging sanitized failure', async () => {
    fetchMock.mockRejectedValue(new Error(`${token} ${chat}`));
    await service.notifyScanCompleted({
      totalItems: 1,
      newItems: 1,
      seconds: '1',
    });
    // Flush the asynchronous fire-and-forget rejection without real network or timers.
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Telegram connection failed'),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(chat);
  });
});
