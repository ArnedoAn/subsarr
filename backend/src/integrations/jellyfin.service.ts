import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class JellyfinService {
  private readonly logger = new Logger(JellyfinService.name);

  constructor(
    @Inject(forwardRef(() => SettingsService))
    private readonly settingsService: SettingsService,
  ) {}

  async refreshLibraryAfterSubtitle(): Promise<void> {
    const s = await this.settingsService.getSettings();
    if (!s.jellyfinUrl?.trim() || !s.jellyfinApiKey?.trim()) {
      return;
    }
    const base = s.jellyfinUrl.trim().replace(/\/$/, '');
    const url = `${base}/Library/Refresh`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'X-Emby-Token': s.jellyfinApiKey.trim(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        this.logger.warn(`Jellyfin refresh failed: ${this.httpError(res)}`);
      }
    } catch (e) {
      this.logger.warn(`Jellyfin refresh error: ${this.connectionError(e)}`);
    }
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    const s = await this.settingsService.getSettings();
    if (!s.jellyfinUrl?.trim() || !s.jellyfinApiKey?.trim()) {
      return { ok: false, error: 'URL or API key missing' };
    }
    const base = s.jellyfinUrl.trim().replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/System/Info`, {
        redirect: 'error',
        headers: { 'X-Emby-Token': s.jellyfinApiKey.trim() },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        return { ok: false, error: this.httpError(res) };
      }
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: this.connectionError(e),
      };
    }
  }

  private httpError(response: Response): string {
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const seconds =
        retryAfter && /^\d+$/.test(retryAfter)
          ? Number(retryAfter)
          : retryAfter
            ? Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000)
            : NaN;
      return Number.isFinite(seconds) && seconds >= 0
        ? `HTTP 429: rate limited; retry after ${seconds} seconds`
        : 'HTTP 429: rate limited';
    }
    if (response.status >= 300 && response.status < 400) {
      return `HTTP ${response.status}: redirects are not allowed`;
    }
    return `HTTP ${response.status}`;
  }

  private connectionError(error: unknown): string {
    return error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
      ? 'Jellyfin request timed out'
      : 'Jellyfin connection failed; check the URL, network, and TLS configuration (redirects are not allowed)';
  }
}
