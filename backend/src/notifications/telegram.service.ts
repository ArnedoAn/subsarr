import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import * as path from 'node:path';
import { SettingsService } from '../settings/settings.service';
import type { TranslationJobPayload } from '../jobs/jobs.types';
import type { JobReturnValue } from '../jobs/jobs.types';

const RETRY_MS = 3000;

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
    const { enabled, token, chatId, events } = await this.loadTelegramConfig();
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
    if (!s.telegramBotToken || !s.telegramChatId) {
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
        error: e instanceof Error ? e.message : String(e),
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
    if (!s.telegramBotToken) {
      return {
        ok: false,
        botOk: false,
        chatOk: false,
        error: 'Bot token not set',
      };
    }
    const token = s.telegramBotToken;
    try {
      const botRes = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(12_000),
      });
      const botJson = (await botRes.json()) as {
        ok?: boolean;
        result?: { username?: string };
        description?: string;
      };
      const botOk = botJson.ok === true;
      const botUsername = botJson.result?.username;

      let chatOk = false;
      if (s.telegramChatId) {
        const chatRes = await fetch(
          `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(s.telegramChatId)}`,
          { signal: AbortSignal.timeout(12_000) },
        );
        const chatJson = (await chatRes.json()) as { ok?: boolean };
        chatOk = chatJson.ok === true;
      }

      return {
        ok: botOk && (s.telegramChatId ? chatOk : false),
        botOk,
        chatOk: !!s.telegramChatId && chatOk,
        botUsername,
        error: !botOk
          ? (botJson.description ?? 'getMe failed')
          : !s.telegramChatId
            ? 'Chat ID not set'
            : !chatOk
              ? 'Chat not reachable for this bot'
              : undefined,
      };
    } catch (e) {
      return {
        ok: false,
        botOk: false,
        chatOk: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private fireAndForget(fn: () => Promise<void>): void {
    void fn().catch((err) =>
      this.logger.warn(
        `Telegram send failed: ${err instanceof Error ? err.message : err}`,
      ),
    );
  }

  private async postSendMessage(
    token: string,
    chatId: string,
    text: string,
  ): Promise<void> {
    const attempt = async () => {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );
      const body = await res.text();
      if (!res.ok) {
        throw new Error(body || `HTTP ${res.status}`);
      }
    };

    try {
      await attempt();
    } catch (first) {
      this.logger.warn(
        `Telegram first attempt failed, retry in ${RETRY_MS}ms: ${first instanceof Error ? first.message : first}`,
      );
      await new Promise((r) => setTimeout(r, RETRY_MS));
      await attempt();
    }
  }
}
