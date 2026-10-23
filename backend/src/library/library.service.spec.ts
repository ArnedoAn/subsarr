import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { ProbeCacheEntity } from '../database/entities/probe-cache.entity';
import { SettingsService } from '../settings/settings.service';
import type { RuntimeSettings } from '../settings/settings.types';
import { LibraryService } from './library.service';

interface ProbeBoundary {
  execFfprobe(filePath: string): Promise<string>;
}

interface DirectoryBoundary {
  readdir(
    directory: string,
    options: { withFileTypes: true },
  ): Promise<Dirent[]>;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

// A deadlock watchdog, not a scheduling delay: test ordering comes from gates.
async function withWatchdog<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const watchdog = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Scan did not refill its worker slot')),
      2000,
    );
  });
  try {
    return await Promise.race([promise, watchdog]);
  } finally {
    clearTimeout(timer);
  }
}

describe('LibraryService scan behavior', () => {
  let tempDir: string;
  let mediaDir: string;
  let service: LibraryService;
  let settings: RuntimeSettings;
  let now: number;
  let rows: Map<string, ProbeCacheEntity>;
  let probe: jest.SpyInstance<Promise<string>, [filePath: string]>;
  let findOne: jest.Mock<
    Promise<ProbeCacheEntity | null>,
    [{ where: { path: string } }]
  >;
  let save: jest.Mock<Promise<ProbeCacheEntity>, [ProbeCacheEntity]>;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'subsarr-library-'));
    mediaDir = path.join(tempDir, 'media');
    const cacheDir = path.join(tempDir, 'cache');
    await mkdir(mediaDir);
    await mkdir(cacheDir);
    now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    rows = new Map();
    findOne = jest.fn(({ where }: { where: { path: string } }) => {
      const row = rows.get(where.path);
      return Promise.resolve(row ? { ...row } : null);
    });
    save = jest.fn((row: ProbeCacheEntity) => {
      rows.set(row.path, { ...row });
      return Promise.resolve({ ...row });
    });
    settings = {
      mediaDirs: [mediaDir],
      sourceLanguage: 'en',
      targetLanguage: 'pl',
      openRouterApiKey: '',
      deepSeekApiKey: '',
      openRouterModel: '',
      deepSeekModel: '',
      scanCacheTtlMinutes: 60,
      concurrency: 1,
      pathContainsExclusions: [],
      translationVerificationEnabled: false,
      rules: [],
      autoScanEnabled: false,
      autoScanCronExpression: '0 * * * *',
      autoTranslateNewItems: false,
      telegramEnabled: false,
      telegramEvents: [],
    };
    const settingsService = {
      getSettings: jest
        .fn()
        .mockImplementation(() => Promise.resolve(settings)),
    };
    const configService = {
      get: jest.fn().mockReturnValue({
        dataDir: cacheDir,
        probeConcurrency: 2,
        mediaDirs: [tempDir],
      }),
    };
    service = new LibraryService(
      { findOne, save } as unknown as Repository<ProbeCacheEntity>,
      settingsService as unknown as SettingsService,
      configService as unknown as ConfigService,
    );
    probe = jest
      .spyOn(service as unknown as ProbeBoundary, 'execFfprobe')
      .mockResolvedValue('{"streams":[]}');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function media(
    name = 'Movie.2024.mkv',
    content = 'media',
  ): Promise<string> {
    const filePath = path.join(mediaDir, name);
    await writeFile(filePath, content);
    return filePath;
  }

  async function seed(
    filePath: string,
    overrides: Partial<ProbeCacheEntity> = {},
  ) {
    const stats = await stat(filePath);
    rows.set(filePath, {
      path: filePath,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      tracksJson: '[]',
      error: null,
      retryAfter: null,
      ...overrides,
    });
  }

  it('keeps failed-probe media and sidecars, and persists a bounded negative cache', async () => {
    const filePath = await media();
    const sidecar = path.join(mediaDir, 'Movie.2024.en.forced.srt');
    await writeFile(sidecar, 'subtitle');
    probe.mockRejectedValue(new Error('ffprobe failed: corrupt stream'));

    const items = await service.getLibrary(true);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      path: filePath,
      probeStatus: 'failed',
      subtitleTracks: [],
      externalSubtitles: [{ path: sidecar, forced: true }],
    });
    expect(rows.get(filePath)).toMatchObject({
      size: 5,
      tracksJson: '[]',
      retryAfter: now + 5 * 60_000,
    });
    expect(rows.get(filePath)?.error).toContain('corrupt stream');
    expect(service.getScanStatus()).toMatchObject({
      state: 'completed',
      lastItemCount: 1,
      metrics: {
        discoveredFiles: 1,
        processedFiles: 1,
        itemCount: 1,
        cacheMisses: 1,
        probes: 1,
        probeErrors: 1,
        probeTimeouts: 0,
        itemFailures: 0,
      },
    });
  });

  it('suppresses retries before backoff expiry and retries exactly at expiry', async () => {
    const filePath = await media();
    probe.mockRejectedValueOnce(new Error('ffprobe failed: unavailable'));
    expect((await service.getLibrary(true))[0]?.probeStatus).toBe('failed');
    const retryAfter = rows.get(filePath)?.retryAfter;
    expect(retryAfter).toBe(now + 300_000);

    now += 299_999;
    expect((await service.getLibrary(true))[0]).toMatchObject({
      path: filePath,
      probeStatus: 'failed',
      subtitleTracks: [],
    });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(service.getScanStatus().metrics).toMatchObject({
      negativeCacheHits: 1,
      cacheHits: 0,
      cacheMisses: 0,
      probes: 0,
      probeErrors: 0,
    });

    now += 1;
    probe.mockResolvedValueOnce('{"streams":[]}');
    expect((await service.getLibrary(true))[0]).toMatchObject({
      path: filePath,
      probeStatus: 'ok',
      subtitleTracks: [],
    });
    expect(probe).toHaveBeenCalledTimes(2);
    expect(rows.get(filePath)).toMatchObject({ error: null, retryAfter: null });
    expect(service.getScanStatus().metrics).toMatchObject({
      cacheMisses: 1,
      probes: 1,
      negativeCacheHits: 0,
    });
  });

  it.each(['size', 'mtime'] as const)(
    'bypasses unexpired negative cache when file %s changes',
    async (changedField) => {
      const filePath = await media();
      probe.mockRejectedValueOnce(new Error('ffprobe failed: broken file'));
      await service.getLibrary(true);
      const original = await stat(filePath);
      if (changedField === 'size') {
        await writeFile(filePath, 'different size');
        await utimes(filePath, original.atime, original.mtime);
        // Use the actual round-tripped timestamp: only size differs in the row.
        const modified = await stat(filePath);
        const cached = rows.get(filePath)!;
        rows.set(filePath, { ...cached, mtimeMs: modified.mtimeMs });
      } else {
        await utimes(
          filePath,
          original.atime,
          new Date(original.mtimeMs + 10_000),
        );
      }

      await service.getLibrary(true);

      expect(probe).toHaveBeenCalledTimes(2);
      expect(service.getScanStatus().metrics).toMatchObject({
        negativeCacheHits: 0,
        cacheMisses: 1,
        probes: 1,
      });
      const current = await stat(filePath);
      expect(rows.get(filePath)).toMatchObject({
        size: current.size,
        mtimeMs: current.mtimeMs,
        error: null,
        retryAfter: null,
      });
    },
  );

  it('refreshes a legacy null-size entry once, then reuses the repaired entry', async () => {
    const filePath = await media();
    await seed(filePath, { size: null });
    probe.mockResolvedValue(
      '{"streams":[{"index":3,"codec_type":"subtitle","codec_name":"subrip","tags":{"language":"eng"}}]}',
    );

    const refreshed = await service.getLibrary(true);
    const cached = await service.getLibrary(true);

    expect(refreshed[0]?.subtitleTracks).toMatchObject([
      { index: 3, codec: 'subrip' },
    ]);
    expect(cached[0]?.subtitleTracks).toEqual(refreshed[0]?.subtitleTracks);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(rows.get(filePath)?.size).toBe(5);
    expect(service.getScanStatus().metrics).toMatchObject({
      cacheHits: 1,
      probes: 0,
    });
  });

  it('caches successful empty subtitle results without treating them as failures', async () => {
    const filePath = await media();
    probe.mockResolvedValue(
      '{"streams":[{"index":0,"codec_type":"video","codec_name":"h264"}]}',
    );

    const first = await service.getLibrary(true);
    const second = await service.getLibrary(true);

    expect(first[0]?.subtitleTracks).toEqual([]);
    expect(second[0]?.subtitleTracks).toEqual([]);
    expect(first[0]?.probeStatus).toBe('ok');
    expect(second[0]?.probeStatus).toBe('ok');
    expect(probe).toHaveBeenCalledTimes(1);
    expect(rows.get(filePath)).toMatchObject({
      tracksJson: '[]',
      error: null,
      retryAfter: null,
    });
    expect(service.getScanStatus().metrics).toMatchObject({
      cacheHits: 1,
      negativeCacheHits: 0,
      cacheMisses: 0,
      probes: 0,
      probeErrors: 0,
    });
  });

  it('does not discard media when probe cache persistence fails', async () => {
    const filePath = await media();
    save.mockRejectedValueOnce(new Error('cache database unavailable'));
    probe.mockResolvedValue(
      '{"streams":[{"index":2,"codec_type":"subtitle","codec_name":"ass"}]}',
    );

    const items = await service.getLibrary(true);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      path: filePath,
      subtitleTracks: [{ index: 2, codec: 'ass' }],
    });
    expect(service.getScanStatus().metrics).toMatchObject({
      cacheWriteErrors: 1,
      probeErrors: 0,
      itemFailures: 0,
    });
  });

  it('refills available slots while an earlier probe is blocked and preserves discovery order', async () => {
    await Promise.all(['a.mkv', 'b.mkv', 'c.mkv'].map((name) => media(name)));
    const expectedOrder = (await readdir(mediaDir)).map((name) =>
      path.join(mediaDir, name),
    );
    const first = deferred<string>();
    const firstStarted = deferred<void>();
    const thirdStarted = deferred<void>();
    let active = 0;
    let maxActive = 0;
    probe.mockImplementation(async (filePath) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        if (filePath === expectedOrder[0]) {
          firstStarted.resolve();
          return await first.promise;
        }
        if (filePath === expectedOrder[2]) thirdStarted.resolve();
        return '{"streams":[]}';
      } finally {
        active -= 1;
      }
    });
    const scan = service.getLibrary(true);
    try {
      await withWatchdog(firstStarted.promise);
      await withWatchdog(thirdStarted.promise);
      expect(active).toBeGreaterThanOrEqual(1);
      expect(maxActive).toBeLessThanOrEqual(2);
      expect(probe).toHaveBeenCalledTimes(3);
    } finally {
      first.resolve('{"streams":[]}');
      await scan;
    }
    const items = await scan;
    expect(items.map((item) => item.path)).toEqual(expectedOrder);
    expect(service.getScanStatus().metrics).toMatchObject({
      concurrency: 2,
      processedFiles: 3,
      itemCount: 3,
    });
  });

  it('classifies probe errors and timeouts separately without losing either item', async () => {
    const broken = await media('broken.mkv');
    const timeout = await media('timeout.mkv');
    probe.mockImplementation((filePath) => {
      const error =
        filePath === timeout
          ? Object.assign(
              new Error(`ffprobe timed out after 15000ms for ${filePath}`),
              {
                name: 'ProbeTimeoutError',
              },
            )
          : new Error(`ffprobe failed for ${filePath}: exit 1`);
      return Promise.reject(error);
    });

    const items = await service.getLibrary(true);

    expect(items.map((item) => item.path).sort()).toEqual(
      [broken, timeout].sort(),
    );
    expect(service.getScanStatus().metrics).toMatchObject({
      probes: 2,
      probeErrors: 2,
      probeTimeouts: 1,
      itemFailures: 0,
      processedFiles: 2,
    });
  });

  it('exposes independent running/completed metric snapshots and cache snapshots', async () => {
    await media();
    expect(service.getScanStatus().metrics).toBeNull();
    expect(service.getCachedItems()).toBeNull();
    expect(probe).not.toHaveBeenCalled();
    const started = deferred<void>();
    const result = deferred<string>();
    probe.mockImplementationOnce(() => {
      started.resolve();
      return result.promise;
    });
    const scan = service.getLibrary(true, 'scheduled');
    try {
      await withWatchdog(started.promise);
      const running = service.getScanStatus();
      expect(running).toMatchObject({
        state: 'running',
        trigger: 'scheduled',
        metrics: { probes: 1 },
      });
      const runningCopy = JSON.parse(JSON.stringify(running)) as unknown;
      result.resolve('{"streams":[]}');
      await scan;
      expect(running).toEqual(runningCopy);
    } finally {
      result.resolve('{"streams":[]}');
      await scan;
    }

    const completed = service.getScanStatus();
    expect(completed.metrics).toMatchObject({
      discoveredFiles: 1,
      processedFiles: 1,
      itemCount: 1,
    });
    expect(completed.metrics?.probeP50Ms).toEqual(expect.any(Number));
    expect(completed.metrics?.probeP95Ms).toEqual(expect.any(Number));
    expect(completed.metrics?.probeMaxMs).toEqual(expect.any(Number));
    const completedCopy = JSON.parse(JSON.stringify(completed)) as unknown;
    const cachedItems = service.getCachedItems()!;
    cachedItems.length = 0;
    expect(service.getCachedItems()).toHaveLength(1);
    expect(probe).toHaveBeenCalledTimes(1);

    await service.getLibrary(true);
    expect(completed).toEqual(completedCopy);
    const exposed = service.getScanStatus();
    if (!exposed.metrics) throw new Error('Missing completed scan metrics');
    exposed.metrics.cacheHits = 999;
    exposed.metrics.roots[0].discoveredFiles = 999;
    expect(service.getScanStatus().metrics).toMatchObject({
      cacheHits: 1,
      roots: [{ discoveredFiles: 1 }],
    });
  });
  it('only skips probing above the size limit and still retains sidecars', async () => {
    const filePath = await media();
    const sidecar = path.join(mediaDir, 'Movie.2024.en.srt');
    await writeFile(sidecar, 'subtitle');
    settings.fileTooLargeBytes = 5;
    await service.getLibrary(true);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(service.getScanStatus().metrics).toMatchObject({
      skippedLargeFiles: 0,
    });

    settings.fileTooLargeBytes = 4;
    const items = await service.getLibrary(true);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      path: filePath,
      probeStatus: 'skipped',
      subtitleTracks: [],
      externalSubtitles: [{ path: sidecar, forced: false }],
    });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(service.getScanStatus().metrics).toMatchObject({
      discoveredFiles: 1,
      processedFiles: 1,
      skippedLargeFiles: 1,
      probes: 0,
      probeErrors: 0,
    });
  });

  it('scans only the selected subset of trusted environment roots', async () => {
    const selected = await media();
    const unselectedRoot = path.join(tempDir, 'unselected');
    await mkdir(unselectedRoot);
    const unselected = path.join(unselectedRoot, 'Other.Movie.mkv');
    await writeFile(unselected, 'media');

    const items = await service.getLibrary(true);

    expect(items.map((item) => item.path)).toEqual([selected]);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(selected);
    expect(rows.has(unselected)).toBe(false);
    expect(service.getScanStatus()).toMatchObject({
      state: 'completed',
      metrics: {
        directoryErrors: 0,
        roots: [{ path: mediaDir, discoveredFiles: 1, directoryErrors: 0 }],
      },
    });
  });

  it('preserves successful memory and disk caches when a configured root disappears, then recovers', async () => {
    const filePath = await media();
    const initial = await service.getLibrary(true);
    const lastSuccessAt = service.getScanStatus().lastSuccessAt;
    const cachePath = path.join(tempDir, 'cache', 'library-cache.json');
    const originalCache = await readFile(cachePath);
    const displacedRoot = path.join(tempDir, 'displaced-media');
    await rename(mediaDir, displacedRoot);
    now += 1000;

    await expect(service.getLibrary(true)).rejects.toThrow(mediaDir);

    expect(service.getCachedItems()).toEqual(initial);
    expect(await readFile(cachePath)).toEqual(originalCache);
    expect(service.getScanStatus()).toMatchObject({
      state: 'failed',
      lastSuccessAt,
      lastItemCount: 1,
      metrics: {
        directoryErrors: 1,
        sidecarReadErrors: 0,
        roots: [{ path: mediaDir, discoveredFiles: 0, directoryErrors: 1 }],
      },
    });

    await rename(displacedRoot, mediaDir);
    now += 1000;
    expect((await service.getLibrary(true))[0]).toMatchObject({
      path: filePath,
      probeStatus: 'ok',
    });
    expect(service.getScanStatus()).toMatchObject({
      state: 'completed',
      lastSuccessAt: now,
      lastError: null,
    });
  });

  it('fails a cold scan when any configured root is missing without writing an empty or partial cache', async () => {
    await media();
    const missingRoot = path.join(tempDir, 'missing-root');
    settings.mediaDirs.push(missingRoot);

    await expect(service.getLibrary(true)).rejects.toThrow(missingRoot);

    expect(service.getCachedItems()).toBeNull();
    expect(probe).not.toHaveBeenCalled();
    await expect(
      readFile(path.join(tempDir, 'cache', 'library-cache.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(service.getScanStatus()).toMatchObject({
      state: 'failed',
      lastSuccessAt: null,
      metrics: {
        discoveredFiles: 1,
        directoryErrors: 1,
        roots: [
          { path: mediaDir, discoveredFiles: 1, directoryErrors: 0 },
          { path: missingRoot, discoveredFiles: 0, directoryErrors: 1 },
        ],
      },
    });

    await mkdir(missingRoot);
    expect(await service.getLibrary(true)).toHaveLength(1);
    expect(service.getScanStatus().state).toBe('completed');
  });
  it.each([undefined, 'unknown'])(
    'rebuilds disk library cache with missing or invalid probe status (%s)',
    async (probeStatus) => {
      const filePath = await media();
      await writeFile(
        path.join(tempDir, 'cache', 'library-cache.json'),
        JSON.stringify({
          expiresAt: now + 60_000,
          items: [{ id: 'legacy', path: filePath, probeStatus }],
        }),
      );

      await service.onModuleInit();
      const items = await service.getLibrary(true);

      expect(probe).toHaveBeenCalledTimes(1);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ path: filePath, probeStatus: 'ok' });
      expect(items[0]?.id).not.toBe('legacy');
      const persisted = JSON.parse(
        await readFile(
          path.join(tempDir, 'cache', 'library-cache.json'),
          'utf8',
        ),
      ) as { items: Array<{ probeStatus: string }> };
      expect(persisted.items[0]?.probeStatus).toBe('ok');
    },
  );

  it('retains readable media when a nested directory fails and counts only traversal errors', async () => {
    const filePath = await media();
    const nested = path.join(mediaDir, 'unreadable');
    await mkdir(nested);
    await writeFile(path.join(nested, 'hidden.mkv'), 'media');
    const readDirectory = fs.readdir;
    const directoryReads = jest
      .spyOn(fs as unknown as DirectoryBoundary, 'readdir')
      .mockImplementation((directory, options) => {
        if (directory === nested) {
          return Promise.reject(new Error('nested directory unavailable'));
        }
        return readDirectory(directory, options);
      });

    const items = await service.getLibrary(true);

    expect(items.map((item) => item.path)).toEqual([filePath]);
    expect(
      directoryReads.mock.calls.filter(([directory]) => directory === nested),
    ).toHaveLength(1);
    expect(service.getScanStatus()).toMatchObject({
      state: 'completed',
      metrics: {
        directoryErrors: 1,
        sidecarReadErrors: 0,
        roots: [{ path: mediaDir, discoveredFiles: 1, directoryErrors: 1 }],
      },
    });
  });

  it('counts a failed shared sidecar directory read separately without dropping media', async () => {
    await media('first.mkv');
    await media('second.mkv');
    const readDirectory = fs.readdir;
    let rootReads = 0;
    jest
      .spyOn(fs as unknown as DirectoryBoundary, 'readdir')
      .mockImplementation((directory, options) => {
        if (directory === mediaDir && ++rootReads > 1) {
          return Promise.reject(new Error('sidecar directory unavailable'));
        }
        return readDirectory(directory, options);
      });

    const items = await service.getLibrary(true);

    expect(items).toHaveLength(2);
    expect(items.every((item) => item.probeStatus === 'ok')).toBe(true);
    expect(items.every((item) => item.externalSubtitles.length === 0)).toBe(
      true,
    );
    expect(rootReads).toBe(2);
    expect(service.getScanStatus()).toMatchObject({
      state: 'completed',
      metrics: {
        directoryErrors: 0,
        sidecarReadErrors: 1,
        itemFailures: 0,
        roots: [{ path: mediaDir, discoveredFiles: 2, directoryErrors: 0 }],
      },
    });
  });
});
