import * as path from 'node:path';
import { type Repository, type SelectQueryBuilder } from 'typeorm';
import { MediaInventoryEntity } from '../database/entities/media-inventory.entity';
import { canonicalizeLanguage } from '../common/language.utils';
import {
  escapeLike,
  normalizeSearch,
  parseSearch,
} from '../common/search.utils';
import { type MediaItem } from './media-item.entity';
import { type LibraryQueryDto } from './dto/library-query.dto';

export function deriveMetadata(
  name: string,
): Pick<MediaItem, 'type' | 'series' | 'season' | 'episodes' | 'year'> {
  const episode =
    /(?:^|[ ._-])S(\d{1,2})((?:E\d{2,3})+)(?=$|[ ._-])/i.exec(name) ??
    /(?:^|[ ._-])(\d{1,2})x(\d{2,3})(?=$|[ ._-])/i.exec(name);
  if (episode) {
    const series = name
      .slice(0, episode.index)
      .replace(/[ ._-]+/g, ' ')
      .trim();
    return {
      type: 'episode',
      ...(series ? { series } : {}),
      season: Number(episode[1]),
      episodes: [...episode[2].matchAll(/\d+/g)].map((match) =>
        Number(match[0]),
      ),
    };
  }
  const year = /(?:^|[ ._([-])((?:19|20)\d{2})(?=$|[ ._)\]-])/.exec(name);
  return year ? { type: 'movie', year: Number(year[1]) } : { type: 'unknown' };
}

export function inventoryRow(
  item: MediaItem,
  discoveredAt: number,
): MediaInventoryEntity {
  const folder = path.dirname(item.path);
  const groupFolder =
    item.type === 'episode' &&
    /^(?:season[ ._-]*|s)\d{1,2}$/i.test(path.basename(folder))
      ? path.dirname(folder)
      : folder;
  const groupLabel =
    item.series ??
    (item.type === 'movie'
      ? item.name
          .split(/(?:19|20)\d{2}/)[0]
          .replace(/[ ._([\]-]+/g, ' ')
          .trim() || item.name
      : path.basename(folder));
  const groupKey = `${item.type}:${groupFolder}:${normalizeSearch(groupLabel)}${item.year ? `:${item.year}` : ''}`;
  item.groupKey = groupKey;
  return {
    id: item.id,
    path: item.path,
    name: item.name,
    folder,
    type: item.type,
    probeStatus: item.probeStatus,
    itemJson: JSON.stringify(item),
    searchText: normalizeSearch(`${item.name} ${item.path}`),
    languages: `|${[...new Set([...item.subtitleTracks, ...item.externalSubtitles].map((track) => canonicalizeLanguage(track.language)))].join('|')}|`,
    groupKey,
    groupLabel,
    season: item.season ?? null,
    size: item.size,
    modifiedAt: new Date(item.lastModified).getTime(),
    trackCount: item.subtitleTracks.length + item.externalSubtitles.length,
    discoveredAt,
  };
}

export function readInventoryItem(row: MediaInventoryEntity): MediaItem {
  const item = JSON.parse(row.itemJson) as MediaItem;
  item.lastModified = new Date(item.lastModified);
  return item;
}

export function inventoryQuery(
  repo: Repository<MediaInventoryEntity>,
  query: LibraryQueryDto,
): SelectQueryBuilder<MediaInventoryEntity> {
  const builder = repo.createQueryBuilder('media');
  const search = parseSearch(query.q ?? '');
  if (query.season !== undefined)
    builder.andWhere('media.season = :season', { season: query.season });
  for (const [index, term] of search.terms.entries()) {
    builder.andWhere(`media.searchText LIKE :term${index} ESCAPE '\\'`, {
      [`term${index}`]: `%${escapeLike(term)}%`,
    });
  }
  const type = query.type ?? search.type;
  if (type) builder.andWhere('media.type = :type', { type });
  if (query.folder) {
    const folder = query.folder.replace(/[\\/]+$/, '');
    builder.andWhere(
      "(media.folder = :folder OR media.folder LIKE :descendant ESCAPE '\\')",
      {
        folder,
        descendant: `${escapeLike(folder + path.sep)}%`,
      },
    );
  }
  if (query.group)
    builder.andWhere('media.groupKey = :group', { group: query.group });
  const languages = search.languages.map((language) => ({
    language,
    missing: false,
  }));
  const missing = search.missing.map((language) => ({
    language,
    missing: true,
  }));
  if (query.targetLanguage && query.missingTarget !== undefined) {
    languages.push({
      language: canonicalizeLanguage(query.targetLanguage),
      missing: query.missingTarget === 'true',
    });
  }
  for (const [index, filter] of [...languages, ...missing].entries()) {
    builder.andWhere(
      `media.languages ${filter.missing ? 'NOT LIKE' : 'LIKE'} :lang${index} ESCAPE '\\'`,
      {
        [`lang${index}`]: `%|${escapeLike(filter.language)}|%`,
      },
    );
  }
  if (query.status === 'failed')
    builder.andWhere("media.probeStatus = 'failed'");
  const sort = {
    name: 'media.searchText',
    size: 'media.size',
    date: 'media.modifiedAt',
    tracks: 'media.trackCount',
  }[query.sort ?? 'name'];
  builder
    .orderBy(sort, query.order === 'desc' ? 'DESC' : 'ASC')
    .addOrderBy('media.id', 'ASC');
  return builder;
}
