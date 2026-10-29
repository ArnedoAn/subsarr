import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { promises as fs, type Dirent } from 'node:fs';
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { MediaInventoryEntity } from '../database/entities/media-inventory.entity';
import { ProbeCacheEntity } from '../database/entities/probe-cache.entity';
import { SettingsService } from '../settings/settings.service';
import { LibraryService } from './library.service';
import { deriveMetadata, inventoryQuery, inventoryRow } from './inventory';
import { type MediaItem } from './media-item.entity';
import { normalizeSearch, parseSearch } from '../common/search.utils';
import { AddMediaInventory1738700000003 } from '../migrations/1738700000003-AddMediaInventory';

interface ScanBoundary {
  execFfprobe(file: string): Promise<string>;
  restoreLibraryCacheFromDisk(): Promise<void>;
  flushProbeWrites(drain?: boolean): Promise<void>;
}

describe('persistent library inventory', () => {
  let db: DataSource;
  let temp: string;
  let media: string;
  let service: LibraryService;
  let settings: SettingsService;
  let config: ConfigService;

  beforeEach(async () => {
    // These inventory tests use completed downloads; stability has its own
    // controlled-clock regressions in library.service.spec.ts.
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    temp = await mkdtemp(path.join(os.tmpdir(), 'subsarr-inventory-'));
    media = path.join(temp, 'media');
    await mkdir(media);
    db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [MediaInventoryEntity, ProbeCacheEntity],
      synchronize: true,
    }).initialize();
    settings = {
      getSettings: jest.fn().mockResolvedValue({
        mediaDirs: [media],
        scanCacheTtlMinutes: 60,
        pathContainsExclusions: [],
        targetLanguage: 'pl',
      }),
    } as unknown as SettingsService;
    config = {
      get: jest.fn().mockReturnValue({
        dataDir: temp,
        probeConcurrency: 2,
        mediaDirs: [temp],
      }),
    } as unknown as ConfigService;
    service = makeService();
  });

  function makeService(): LibraryService {
    const instance = new LibraryService(
      db.getRepository(ProbeCacheEntity),
      settings,
      config,
      db.getRepository(MediaInventoryEntity),
    );
    jest
      .spyOn(instance as unknown as ScanBoundary, 'execFfprobe')
      .mockResolvedValue('{"streams":[]}');
    return instance;
  }

  afterEach(async () => {
    jest.restoreAllMocks();
    await db.destroy();
    await rm(temp, { recursive: true, force: true });
  });

  it('commits successful and negative probe checkpoints while later workers remain blocked', async () => {
    await Promise.all(
      Array.from({ length: 102 }, (_, index) =>
        writeFile(path.join(media, `Movie.${index}.mkv`), 'video'),
      ),
    );
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let checkpoint!: () => void;
    const committed = new Promise<void>((resolve) => {
      checkpoint = resolve;
    });
    const boundary = service as unknown as ScanBoundary;
    let calls = 0;
    jest.spyOn(boundary, 'execFfprobe').mockImplementation(async () => {
      const current = ++calls;
      if (current > 100) await blocked;
      if (current === 1) throw new Error('corrupt stream');
      return '{"streams":[]}';
    });
    const flush = boundary.flushProbeWrites.bind(boundary);
    jest
      .spyOn(boundary, 'flushProbeWrites')
      .mockImplementation(async (drain) => {
        await flush(drain);
        if ((await db.getRepository(ProbeCacheEntity).count()) >= 100)
          checkpoint();
      });
    const scan = service.getLibrary(true);
    const timer = setTimeout(() => checkpoint(), 2000);
    try {
      await committed;
      expect(await db.getRepository(ProbeCacheEntity).count()).toBe(100);
      expect(
        await db
          .getRepository(ProbeCacheEntity)
          .countBy({ error: 'corrupt stream' }),
      ).toBe(1);
      expect(await db.getRepository(MediaInventoryEntity).count()).toBe(0);
    } finally {
      clearTimeout(timer);
      release();
      await scan;
    }
    expect(await db.getRepository(ProbeCacheEntity).count()).toBe(102);
  });

  it('preserves sidecars only in failed directories while reconciling healthy directories', async () => {
    const healthy = path.join(media, 'healthy');
    const failing = path.join(media, 'failing');
    for (const directory of [healthy, failing]) {
      await mkdir(directory);
      await writeFile(path.join(directory, 'Movie.2024.mkv'), 'video');
      await writeFile(path.join(directory, 'Movie.2024.en.srt'), 'subtitle');
    }
    await service.getLibrary(true);
    await rm(path.join(healthy, 'Movie.2024.en.srt'));
    await writeFile(path.join(healthy, 'Movie.2024.pl.srt'), 'new subtitle');
    const original = fs.readdir.bind(fs) as (
      directory: string,
      options: { withFileTypes: true },
    ) => Promise<Dirent[]>;
    let failingReads = 0;
    jest
      .spyOn(fs as unknown as { readdir: typeof original }, 'readdir')
      .mockImplementation((directory, options) => {
        if (directory === failing && ++failingReads > 1)
          return Promise.reject(new Error('sidecar directory unavailable'));
        return original(directory, options);
      });
    const items = await service.getLibrary(true);
    expect(
      items.find((item) => path.dirname(item.path) === healthy)
        ?.externalSubtitles,
    ).toEqual([
      expect.objectContaining({
        path: path.join(healthy, 'Movie.2024.pl.srt'),
        forced: false,
      }),
    ]);
    expect(
      items.find((item) => path.dirname(item.path) === failing)
        ?.externalSubtitles,
    ).toEqual([
      expect.objectContaining({
        path: path.join(failing, 'Movie.2024.en.srt'),
        forced: false,
      }),
    ]);
    expect(service.getScanStatus().metrics?.sidecarReadErrors).toBe(1);
  });

  it('restores persisted items even without a disk cache, then reconciles unchanged video sidecars', async () => {
    const video = path.join(media, 'Movie.2024.mkv');
    await writeFile(video, 'video');
    await service.getLibrary(true);
    await rm(path.join(temp, 'library-cache.json'));
    const restarted = makeService();
    await (restarted as unknown as ScanBoundary).restoreLibraryCacheFromDisk();
    expect(restarted.getCachedItems()).toEqual([
      expect.objectContaining({ path: video, probeStatus: 'ok' }),
    ]);
    await writeFile(path.join(media, 'Movie.2024.pl.srt'), 'subtitle');
    await restarted.getLibrary(true);
    expect(
      (
        await restarted.queryInventory({
          targetLanguage: 'pl',
          missingTarget: 'false',
        })
      ).total,
    ).toBe(1);
    await rm(path.join(media, 'Movie.2024.pl.srt'));
    await restarted.getLibrary(true);
    expect(
      (
        await restarted.queryInventory({
          targetLanguage: 'pl',
          missingTarget: 'true',
        })
      ).total,
    ).toBe(1);
  });

  it('rejects legacy selected roots outside the environment before walking or probing and preserves committed state', async () => {
    jest.spyOn(config, 'get').mockReturnValue({
      dataDir: temp,
      probeConcurrency: 2,
      mediaDirs: [media],
    });
    const video = path.join(media, 'Movie.2024.mkv');
    await writeFile(video, 'video');
    const initial = await service.getLibrary(true);
    const lastSuccessAt = service.getScanStatus().lastSuccessAt;
    const cachePath = path.join(temp, 'library-cache.json');
    const diskCache = await readFile(cachePath);
    const inventory = await db.getRepository(MediaInventoryEntity).find();
    const probeCache = await db.getRepository(ProbeCacheEntity).find();

    const outside = path.join(temp, 'legacy-outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'Private.Movie.mkv'), 'private video');
    const legacySettings = await settings.getSettings();
    legacySettings.mediaDirs = [outside];
    const probe = jest.spyOn(service as unknown as ScanBoundary, 'execFfprobe');
    probe.mockClear();
    const directoryReads = jest.spyOn(fs, 'readdir');

    await expect(service.getLibrary(true)).rejects.toThrow();

    expect(directoryReads).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(service.getCachedItems()).toEqual(initial);
    expect(await readFile(cachePath)).toEqual(diskCache);
    expect(await db.getRepository(MediaInventoryEntity).find()).toEqual(
      inventory,
    );
    expect(await db.getRepository(ProbeCacheEntity).find()).toEqual(probeCache);
    expect(service.getScanStatus()).toMatchObject({
      state: 'failed',
      lastSuccessAt,
      lastItemCount: 1,
      metrics: {
        discoveredFiles: 0,
        processedFiles: 0,
        probes: 0,
        directoryErrors: 1,
        roots: [{ path: outside, discoveredFiles: 0, directoryErrors: 1 }],
      },
    });
    expect(service.getScanStatus().lastError).toContain(outside);
  });

  it('never deletes inventory after an unreadable root, but deletes genuinely absent files after recovery', async () => {
    const video = path.join(media, 'Movie.2024.mkv');
    await writeFile(video, 'video');
    await service.getLibrary(true);
    const success = service.getScanStatus().lastSuccessAt;
    await rename(media, `${media}-offline`);
    await expect(service.getLibrary(true)).rejects.toThrow(
      'Cannot read media root',
    );
    expect(await db.getRepository(MediaInventoryEntity).count()).toBe(1);
    expect(service.getScanStatus().lastSuccessAt).toBe(success);
    await rename(`${media}-offline`, media);
    await rm(video);
    await service.getLibrary(true);
    expect(await db.getRepository(MediaInventoryEntity).count()).toBe(0);
  });

  it('queries all rows before stable pagination and supports accents, words, phrase, release tokens and languages', async () => {
    const repo = db.getRepository(MediaInventoryEntity);
    const items: MediaItem[] = Array.from({ length: 6 }, (_, index) => ({
      id: String(index),
      path: path.join(media, `Amélie.Show.S02E0${index + 1}.1080p.mkv`),
      name: `Amélie.Show.S02E0${index + 1}.1080p`,
      probeStatus: 'ok',
      subtitleTracks: [{ index: 0, language: 'en', codec: 'subrip' }],
      externalSubtitles: [],
      size: index,
      lastModified: new Date(0),
      ...deriveMetadata(`Amélie.Show.S02E0${index + 1}.1080p`),
    }));
    await repo.save(items.map((item) => inventoryRow(item, 1)));
    const query = {
      q: '1080p "amelie show" lang:en missing:pl',
      sort: 'size' as const,
      order: 'desc' as const,
    };
    expect(await inventoryQuery(repo, query).getCount()).toBe(6);
    expect(
      (await inventoryQuery(repo, query).skip(2).take(2).getMany()).map(
        (row) => row.id,
      ),
    ).toEqual(['3', '2']);
    expect(
      (
        await inventoryQuery(repo, {
          q: 'show amelie s02e03',
          season: 2,
        }).getMany()
      ).map((row) => row.id),
    ).toEqual(['2']);
    expect(await inventoryQuery(repo, { q: 'missing:en' }).getCount()).toBe(0);
  });

  it('reconciles plain, forced/SDH, VTT and SSA sidecars without mistaking title tokens for languages', async () => {
    await writeFile(path.join(media, 'Movie.2024.mkv'), 'video');
    for (const suffix of ['.srt', '.pl.sdh.vtt', '.en.forced.ssa']) {
      await writeFile(path.join(media, `Movie.2024${suffix}`), 'subtitle');
    }
    const [item] = await service.getLibrary(true);
    expect(item.externalSubtitles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ language: 'und', forced: false }),
        expect.objectContaining({ language: 'pol', forced: false }),
        expect.objectContaining({ language: 'eng', forced: true }),
      ]),
    );
  });

  it('creates the inventory migration schema without relying on synchronize', async () => {
    await db.getRepository(MediaInventoryEntity).clear();
    const runner = db.createQueryRunner();
    await runner.query('DROP TABLE media_inventory');
    await new AddMediaInventory1738700000003().up(runner);
    expect(await db.getRepository(MediaInventoryEntity).count()).toBe(0);
    await runner.release();
  });
});

describe('conservative library metadata', () => {
  it('recognizes explicit multi-episode and year markers without classifying arbitrary release numbers', () => {
    expect(deriveMetadata('Show.Name.S02E03E04.1080p')).toEqual({
      type: 'episode',
      series: 'Show Name',
      season: 2,
      episodes: [3, 4],
    });
    expect(deriveMetadata('Show.Name.2x03.1080p')).toMatchObject({
      type: 'episode',
      season: 2,
      episodes: [3],
    });
    expect(deriveMetadata('Film.Title.(2024).2160p')).toEqual({
      type: 'movie',
      year: 2024,
    });
    expect(deriveMetadata('Anime.1080p.123')).toEqual({ type: 'unknown' });
  });
  it('retains every original searchable token and parses only supported structured fields', () => {
    expect(normalizeSearch('Amélie.Show.2024.1080p.WEB-DL')).toBe(
      'amelie show 2024 1080p web dl',
    );
    expect(
      parseSearch('show "Amélie Show" lang:eng missing:pol type:episode'),
    ).toEqual({
      terms: ['show', 'amelie show'],
      languages: ['eng'],
      missing: ['pol'],
      type: 'episode',
    });
  });
});
