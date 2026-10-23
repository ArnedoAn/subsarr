import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { SettingsService } from '../settings/settings.service';
import type { TranslationJobPayload } from '../jobs/jobs.types';
import type { JobReturnValue } from '../jobs/jobs.types';

const MAX_RETRY_AFTER_SECONDS = 30;

interface TelegramResponse {
  ok?: boolean;
  error_code?: number;
  parameters?: { retry_after?: number };
  result?: { username?: string };
}

class TelegramRequestError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    @Inject(forwardRef(() => SettingsService))
    private readonly settingsService: SettingsService,
  ) {}

  private async loadTelegramConfig(): Promise<{
    enabled: boolean;
    token?: string;
    chatId?: string;
    events: string[];
  }> {
    const s = await this.settingsService.getSettings();
    return {
      enabled: s.telegramEnabled,
      token: s.telegramBotToken,
      chatId: s.telegramChatId,
      events: s.telegramEvents ?? [],
    };
  }

  wantsEvent(events: string[], event: string): boolean {
    return events.includes(event);
  }

  async sendMessage(text: string): Promise<void> {
    const { enabled, token, chatId } = await this.loadTelegramConfig();
    if (!enabled || !token || !chatId) {
      return;
    }
    await this.postSendMessage(token, chatId, text);
  }

  async notifyJobCompleted(
    jobId: string,
    data: TranslationJobPayload,
    returnValue: JobReturnValue,
    startedAtMs: number,
  ): Promise<void> {
    const { enabled, token, chatId, events } = await this.loadTelegramConfig();
    if (
      !enabled ||
      !token ||
      !chatId ||
      !this.wantsEvent(events, 'job.completed')
    ) {
      return;
    }
    const base = path.basename(data.mediaItemPath ?? data.mediaItemId);
    const durSec = ((Date.now() - startedAtMs) / 1000).toFixed(1);
    const text = [
      '✅ Subsarr — job completado',
      `ID: ${jobId}`,
      `Archivo: ${base}`,
      `${data.sourceLanguage} → ${data.targetLanguage}`,
      `Tokens: ${returnValue.usage.totalTokens} (${returnValue.tierUsed})`,
      `Líneas: ${returnValue.lineCount}`,
      `Duración: ${durSec}s`,
    ].join('\n');
    void this.fireAndForget(() => this.postSendMessage(token, chatId, text));
  }

  async notifyJobFailed(
    jobId: string,
    data: TranslationJobPayload,
    reason: string,
  ): Promise<void> {
    const { enabled, token, chatId, events } = await this.loadTelegramConfig();
    if (
      !enabled ||
      !token ||
      !chatId ||
      !this.wantsEvent(events, 'job.failed')
    ) {
      return;
    }
    const base = path.basename(data.mediaItemPath ?? data.mediaItemId);
    const short = reason.length > 500 ? `${reason.slice(0, 497)}...` : reason;
    const text = [
      '❌ Subsarr — job fallido',
      `ID: ${jobId}`,
      `Archivo: ${base}`,
      `${data.sourceLanguage} → ${data.targetLanguage}`,
      `Motivo: ${short}`,
    ].join('\n');
    void this.fireAndForget(() => this.postSendMessage(token, chatId, text));
  }

  async notifyScanCompleted(summary: {
    totalItems: number;
    newItems: number;
    seconds: string;
  }): Promise<void> {
    const { enabled, token, chatId, events } = await this.loadTelegramConfig();
    if (
      !enabled ||
      !token ||
      !chatId ||
      !this.wantsEvent(events, 'scan.completed')
    ) {
      return;
    }
    const text = [
      '🔎 Subsarr — escaneo automático',
      `Items en biblioteca: ${summary.totalItems}`,
      `Nuevos desde caché: ${summary.newItems}`,
      `Duración: ${summary.seconds}s`,
    ].join('\n');
    void this.fireAndForget(() => this.postSendMessage(token, chatId, text));
  }

  async notifyQuotaWarning(message: string): Promise<void> {
    const { enabled, token, chatId, events } = await this.loadTelegramConfig();
    if (
      !enabled ||
      !token ||
      !chatId ||
      !this.wantsEvent(events, 'quota.warning')
    ) {
      return;
    }
    void this.fireAndForget(() =>
      this.postSendMessage(token, chatId, `⚠️ Subsarr — cuota\n${message}`),
    );
  }

  async notifyQuotaReached(message: string): Promise<void> {
    const { enabled, token, chatId, events } = await this.loadTelegramConfig();
    if (
      !enabled ||
      !token ||
      !chatId ||
      !this.wantsEvent(events, 'quota.reached')
    ) {
      return;
    }
    void this.fireAndForget(() =>
      this.postSendMessage(token, chatId, `🚫 Subsarr — cuota\n${message}`),
    );
  }

  async sendTestMessage(): Promise<{ ok: boolean; error?: string }> {
    const s = await this.settingsService.getSettings();
    if (!s.telegramBotToken?.trim() || !s.telegramChatId?.trim()) {
      return { ok: false, error: 'Configure bot token and chat ID first' };
    }
    try {
      await this.postSendMessage(
        s.telegramBotToken,
        s.telegramChatId,
        '✅ Subsarr — mensaje de prueba',
      );
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: this.requestError(e).message,
      };
    }
  }

  async getConnectionStatus(): Promise<{
    ok: boolean;
    botOk: boolean;
    chatOk: boolean;
    botUsername?: string;
    error?: string;
  }> {
    const s = await this.settingsService.getSettings();
    if (!s.telegramBotToken?.trim()) {
      return {
        ok: false,
        botOk: false,
        chatOk: false,
        error: 'Bot token not set',
      };
    }
    const token = s.telegramBotToken.trim();
    let botOk = false;
    let botUsername: string | undefined;
    try {
      const bot = await this.request(token, 'getMe');
      botOk = true;
      botUsername =
        typeof bot.result?.username === 'string'
          ? bot.result.username
          : undefined;
      if (!s.telegramChatId?.trim()) {
        return {
          ok: false,
          botOk,
          chatOk: false,
          botUsername,
          error: 'Chat ID not set',
        };
      }
      await this.request(
        token,
        `getChat?chat_id=${encodeURIComponent(s.telegramChatId.trim())}`,
      );
      return { ok: true, botOk, chatOk: true, botUsername };
    } catch (e) {
      return {
        ok: false,
        botOk,
        chatOk: false,
        botUsername,
        error: this.requestError(e).message,
      };
    }
  }

  private fireAndForget(fn: () => Promise<void>): void {
    void fn().catch((err) =>
      this.logger.warn(
        `Telegram send failed: ${this.requestError(err).message}`,
      ),
    );
  }

  private async postSendMessage(
    token: string,
    chatId: string,
    text: string,
  ): Promise<void> {
    const attempt = () =>
      this.request(token.trim(), 'sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId.trim(),
          text,
          disable_web_page_preview: true,
        }),
      });
    try {
      await attempt();
    } catch (error) {
      if (
        !(error instanceof TelegramRequestError) ||
        error.retryAfterSeconds === undefined ||
        error.retryAfterSeconds > MAX_RETRY_AFTER_SECONDS
      ) {
        throw error;
      }
      await delay(error.retryAfterSeconds * 1000);
      await attempt();
    }
  }

  private async request(
    token: string,
    method: string,
    init: RequestInit = {},
  ): Promise<TelegramResponse> {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${token}/${method}`,
        {
          ...init,
          redirect: 'error',
          signal: AbortSignal.timeout(20_000),
        },
      );
      let body: TelegramResponse | undefined;
      try {
        const json: unknown = await response.json();
        if (json !== null && typeof json === 'object' && !Array.isArray(json)) {
          body = json as TelegramResponse;
        }
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError')
        ) {
          throw error;
        }
        // HTTP failures still report their status when the response is not JSON.
      }
      if (!response.ok || body?.ok !== true) {
        const code = Number.isInteger(body?.error_code)
          ? body?.error_code
          : undefined;
        const limited = response.status === 429 || code === 429;
        const retry = body?.parameters?.retry_after;
        const retryAfter =
          limited &&
          typeof retry === 'number' &&
          Number.isFinite(retry) &&
          retry >= 0
            ? Math.ceil(retry)
            : undefined;
        const status = `HTTP ${response.status}`;
        const detail = limited
          ? `rate limited${retryAfter === undefined ? '' : `; retry after ${retryAfter} seconds`}`
          : response.status >= 300 && response.status < 400
            ? 'redirects are not allowed'
            : code !== undefined
              ? `Telegram API error ${code}`
              : 'Telegram API did not confirm success';
        throw new TelegramRequestError(`${status}: ${detail}`, retryAfter);
      }
      return body;
    } catch (error) {
      throw this.requestError(error);
    }
  }

  private requestError(error: unknown): TelegramRequestError {
    if (error instanceof TelegramRequestError) return error;
    const timeout =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError');
    return new TelegramRequestError(
      timeout
        ? 'Telegram request timed out'
        : 'Telegram connection failed; check the network and TLS configuration (redirects are not allowed)',
    );
  }
}
