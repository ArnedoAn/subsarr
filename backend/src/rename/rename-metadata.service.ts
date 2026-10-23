import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SettingsService } from '../settings/settings.service';
import type { RenameMetadataMatch } from './rename.types';

export interface MetadataReply {
  matches: RenameMetadataMatch[];
  warnings: string[];
}
interface MetadataRecord {
  Name?: string;
  ProductionYear?: number;
  Type?: string;
  id?: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
}
function isMetadataRecord(value: unknown): value is MetadataRecord {
  if (!value || typeof value !== 'object') return false;
  for (const [key, entry] of Object.entries(value)) {
    if (
      [
        'Name',
        'Type',
        'title',
        'name',
        'release_date',
        'first_air_date',
      ].includes(key) &&
      (typeof entry !== 'string' || entry.length > 300)
    )
      return false;
    if (
      ['ProductionYear', 'id'].includes(key) &&
      (typeof entry !== 'number' || !Number.isFinite(entry))
    )
      return false;
  }
  return true;
}
@Injectable()
export class RenameMetadataService {
  private readonly cache = new Map<
    string,
    { expires: number; reply: MetadataReply }
  >();
  private readonly selections = new Map<
    string,
    { expires: number; match: RenameMetadataMatch }
  >();
  constructor(private readonly settings: SettingsService) {}
  async lookup(
    query: string,
    kind: 'movie' | 'episode',
  ): Promise<MetadataReply> {
    if (
      !query?.trim() ||
      query.length > 180 ||
      !['movie', 'episode'].includes(kind)
    )
      throw new BadRequestException(
        'A title and movie/episode classification are required',
      );
    const settings = await this.settings.getSettings();
    const key = JSON.stringify([
      query.trim().toLowerCase(),
      kind,
      settings.jellyfinUrl,
      settings.jellyfinApiKey,
      settings.tmdbApiKey,
    ]);
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.reply;
    const warnings: string[] = [];
    let matches: RenameMetadataMatch[] = [];
    if (settings.jellyfinUrl && settings.jellyfinApiKey) {
      try {
        const url = new URL(`${settings.jellyfinUrl.replace(/\/$/, '')}/Items`);
        url.search = new URLSearchParams({
          SearchTerm: query.trim(),
          IncludeItemTypes: kind === 'movie' ? 'Movie' : 'Series',
          Recursive: 'true',
          Limit: '20',
        }).toString();
        const data = await this.request(url, {
          'X-Emby-Token': settings.jellyfinApiKey,
        });
        if (
          !data ||
          typeof data !== 'object' ||
          !('Items' in data) ||
          !Array.isArray(data.Items)
        )
          throw new Error('Invalid Jellyfin response');
        const items: unknown[] = data.Items;
        matches = items
          .filter(isMetadataRecord)
          .filter((item) => typeof item.Name === 'string' && item.Name.trim())
          .map((item) => ({
            id: randomUUID(),
            source: 'jellyfin',
            title: item.Name!,
            year: item.ProductionYear,
            kind,
          }));
      } catch {
        warnings.push(
          'Jellyfin lookup failed or timed out. Check saved connection settings.',
        );
      }
    }
    // Prefer library metadata. TMDB is used only when Jellyfin has no candidates.
    if (!matches.length && settings.tmdbApiKey) {
      try {
        const url = new URL(
          `https://api.themoviedb.org/3/search/${kind === 'movie' ? 'movie' : 'tv'}`,
        );
        url.search = new URLSearchParams({
          api_key: settings.tmdbApiKey,
          query: query.trim(),
          include_adult: 'false',
        }).toString();
        const data = await this.request(url);
        if (
          !data ||
          typeof data !== 'object' ||
          !('results' in data) ||
          !Array.isArray(data.results)
        )
          throw new Error('Invalid TMDB response');
        const items: unknown[] = data.results;
        matches = items
          .slice(0, 20)
          .filter(isMetadataRecord)
          .filter(
            (item) =>
              typeof (item.title || item.name) === 'string' &&
              (item.title || item.name)!.trim(),
          )
          .map((item) => {
            const year = Number(
              (item.release_date || item.first_air_date || '').slice(0, 4),
            );
            return {
              id: randomUUID(),
              source: 'tmdb',
              title: (item.title || item.name)!,
              year: year || undefined,
              kind,
            };
          });
      } catch {
        warnings.push(
          'TMDB lookup failed or timed out. Check the saved TMDB key.',
        );
      }
    }
    if (!settings.jellyfinApiKey && !settings.tmdbApiKey)
      warnings.push(
        'Save Jellyfin or TMDB credentials in Settings to enable lookup. Manual classification remains available.',
      );
    for (const [id, selection] of this.selections)
      if (selection.expires < Date.now()) this.selections.delete(id);
    if (this.selections.size > 4000) this.selections.clear();
    for (const match of matches)
      this.selections.set(match.id, {
        match,
        expires: Date.now() + 10 * 60_000,
      });
    if (this.cache.size >= 100) {
      const [oldestKey] = this.cache.keys();
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    const reply = { matches, warnings };
    if (matches.length > 0 || warnings.length === 0)
      this.cache.set(key, { reply, expires: Date.now() + 5 * 60_000 });
    return reply;
  }
  select(id: string): RenameMetadataMatch {
    const selected = this.selections.get(id);
    if (!selected || selected.expires < Date.now())
      throw new BadRequestException(
        'Metadata selection expired. Search again.',
      );
    return selected.match;
  }
  private async request(
    url: URL,
    headers?: Record<string, string>,
  ): Promise<unknown> {
    if (!['http:', 'https:'].includes(url.protocol))
      throw new BadRequestException('Metadata URL must use HTTP(S)');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok)
        throw new ServiceUnavailableException(
          'Metadata provider rejected request',
        );
      const text = await response.text();
      if (text.length > 2_000_000)
        throw new ServiceUnavailableException(
          'Metadata response exceeds limit',
        );
      return JSON.parse(text) as unknown;
    } finally {
      clearTimeout(timer);
    }
  }
}
