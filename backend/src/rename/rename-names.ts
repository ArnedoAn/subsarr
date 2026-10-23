import { BadRequestException } from '@nestjs/common';
import type { RenameClassification, RenameTemplates } from './rename.types';

export const DEFAULT_RENAME_TEMPLATES: RenameTemplates = {
  movie: '{title} ({year})',
  series: '{title} - {episodes}',
  anime: '{title} - {absolute}',
};
function clean(value: string): string {
  return value
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[._]+/g, ' ')
    .replace(
      /\b(?:2160p|1080p|720p|480p|WEB-DL|WEBRip|BluRay|x26[45]|HEVC|HDR|AAC|DTS)\b.*$/i,
      '',
    )
    .replace(/^[-\s]+|[-\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
export function parseRenameName(
  stem: string,
  folderTitle = '',
  folderSeason = 1,
): RenameClassification {
  const normalized = stem.replace(/[._]+/g, ' ');
  const episode = normalized.match(
    /^(.*?)\b(?:S(\d{1,2})\s*E(\d{1,3})((?:\s*(?:E|-E?)\d{1,3})*)|(\d{1,2})x(\d{1,3})((?:\s*(?:x|-x?)\d{1,3})*))\b/i,
  );
  if (episode) {
    const first = Number(episode[3] || episode[6]);
    const tail = episode[4] || episode[7] || '';
    const extra = [...tail.matchAll(/\d+/g)].map((match) => Number(match[0]));
    const episodes =
      tail.trimStart().startsWith('-') &&
      extra.length === 1 &&
      extra[0] > first &&
      extra[0] - first <= 20
        ? Array.from(
            { length: extra[0] - first + 1 },
            (_, index) => first + index,
          )
        : [first, ...extra];
    return {
      kind: 'episode',
      title: clean(episode[1]) || folderTitle,
      season: Number(episode[2] || episode[5]),
      episodes,
      confidence: 'high',
    };
  }
  const nested = normalized.match(/^Episode\s*(\d{1,3})\b/i);
  if (nested && folderTitle)
    return {
      kind: 'episode',
      title: folderTitle,
      season: folderSeason,
      episodes: [Number(nested[1])],
      confidence: 'medium',
    };
  const year = [
    ...normalized.matchAll(/(?:^|[\s([])((?:19|20)\d{2})(?=$|[\s)\]])/g),
  ]
    .filter(
      (match) =>
        match.index !== undefined && clean(normalized.slice(0, match.index)),
    )
    .pop();
  if (year && year.index !== undefined)
    return {
      kind: 'movie',
      title: clean(normalized.slice(0, year.index)),
      year: Number(year[1]),
      confidence: 'high',
    };
  const absolute = normalized
    .replace(/^\[[^\]]*\]\s*/, '')
    .match(/^(.*?)\s+(?:-\s+)?(\d{1,4})(?:v\d)?(?:\s|$|\[)/i);
  if (absolute)
    return {
      kind: 'anime',
      title: clean(absolute[1]),
      absolute: Number(absolute[2]),
      confidence: 'low',
    };
  return { kind: 'unknown', title: clean(stem) || stem, confidence: 'low' };
}
export function safeRenameFilename(name: string): string {
  if (
    !name ||
    name.length > 240 ||
    /[<>:"/\\|?*]/.test(name) ||
    [...name].some((character) => character.charCodeAt(0) < 32) ||
    /[. ]$/.test(name) ||
    name === '.' ||
    name === '..' ||
    /^(CON|PRN|AUX|NUL|COM\d|LPT\d)(?:\.|$)/i.test(name)
  )
    throw new BadRequestException(
      'Invalid filename: use a single safe filename, not a path',
    );
  return name;
}
export function sanitizeRenameTitle(title: string): string {
  const cleaned = [...title.replace(/:/g, ' - ').replace(/[<>"/\\|?*]/g, ' ')]
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
    .replace(/[. ]+$/g, '');
  if (!cleaned)
    throw new BadRequestException('Title has no usable filename characters');
  return /^(CON|PRN|AUX|NUL|COM\d|LPT\d)(?:\.|$)/i.test(cleaned)
    ? `_${cleaned}`
    : cleaned;
}
export function renderRenameTemplate(
  value: RenameClassification,
  templates: RenameTemplates,
): string {
  if (!value.title?.trim())
    throw new BadRequestException('A title is required');
  const title = sanitizeRenameTitle(value.title);
  if (value.kind === 'unknown') return safeRenameFilename(title);
  const numeric = (number: number | undefined, label: string, max = 9999) => {
    if (!Number.isInteger(number) || number! < 0 || number! > max)
      throw new BadRequestException(`Invalid ${label}`);
    return number!;
  };
  const tokens: Record<string, string> = {
    title,
    year: value.year === undefined ? '' : String(numeric(value.year, 'year')),
    season: '',
    episodes: '',
    absolute: '',
  };
  if (value.kind === 'movie' && !value.year)
    throw new BadRequestException('Movie year required');
  if (value.kind === 'episode') {
    tokens.season = String(numeric(value.season, 'season', 99)).padStart(
      2,
      '0',
    );
    if (!value.episodes?.length || value.episodes.length > 30)
      throw new BadRequestException('Episodes required (maximum 30)');
    tokens.episodes = `S${tokens.season}${value.episodes.map((episode) => `E${String(numeric(episode, 'episode', 999)).padStart(2, '0')}`).join('')}`;
  }
  if (value.kind === 'anime')
    tokens.absolute = String(
      numeric(value.absolute, 'absolute episode'),
    ).padStart(3, '0');
  const template =
    value.kind === 'movie'
      ? templates.movie
      : value.kind === 'anime'
        ? templates.anime
        : templates.series;
  if (
    typeof template !== 'string' ||
    template.length > 240 ||
    /\{(?!title\}|year\}|season\}|episodes\}|absolute\})/.test(template)
  )
    throw new BadRequestException('Unknown template token');
  return safeRenameFilename(
    template.replace(
      /\{(title|year|season|episodes|absolute)\}/g,
      (_, token: string) => tokens[token],
    ),
  );
}
