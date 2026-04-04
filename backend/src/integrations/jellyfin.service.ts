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
    const base = s.jellyfinUrl.replace(/\/$/, '');
    const url = `${base}/Library/Refresh`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Emby-Token': s.jellyfinApiKey.trim(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const t = await res.text();
        this.logger.warn(`Jellyfin refresh failed: HTTP ${res.status} ${t.slice(0, 200)}`);
      }
    } catch (e) {
      this.logger.warn(
        `Jellyfin refresh error: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    const s = await this.settingsService.getSettings();
    if (!s.jellyfinUrl?.trim() || !s.jellyfinApiKey?.trim()) {
      return { ok: false, error: 'URL or API key missing' };
    }
    const base = s.jellyfinUrl.replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/System/Info`, {
        headers: { 'X-Emby-Token': s.jellyfinApiKey.trim() },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
