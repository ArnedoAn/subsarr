import { DataSource } from 'typeorm';
import { ScanHistoryService } from './scan-history.service';
import { LibraryScanRunEntity } from './scan-run.entity';
import { AddLibraryScanRuns1738700000009 } from '../migrations/1738700000009-AddLibraryScanRuns';
import type { LibraryScanRun } from './scan-history.types';

function report(index: number): LibraryScanRun {
  return {
    id: String(index),
    trigger: 'manual',
    state: 'failed',
    startedAt: index,
    finishedAt: index + 1,
    error: 'Cannot read /secret/root/movie.mkv',
    metrics: {
      scanId: String(index),
      concurrency: 2,
      discoveredFiles: 1,
      processedFiles: 1,
      itemCount: 1,
      cacheHits: 0,
      negativeCacheHits: 0,
      cacheMisses: 1,
      cacheReadErrors: 0,
      cacheWriteErrors: 0,
      cacheMalformedEntries: 0,
      probes: 1,
      probeErrors: 1,
      probeTimeouts: 0,
      skippedLargeFiles: 0,
      statFailures: 0,
      itemFailures: 0,
      directoryErrors: 0,
      sidecarReadErrors: 0,
      wallTimeMs: 1,
      discoveryWallTimeMs: 0,
      buildWallTimeMs: 1,
      statDurationMs: 0,
      cacheReadDurationMs: 0,
      cacheWriteDurationMs: 0,
      probeDurationMs: 1,
      sidecarReadDurationMs: 0,
      probeP50Ms: 1,
      probeP95Ms: 1,
      probeMaxMs: 1,
      roots: [
        {
          path: '/secret/root',
          durationMs: 1,
          discoveredFiles: 1,
          directoryErrors: 0,
        },
      ],
    },
    failures: Array.from({ length: 60 }, () => ({
      event: 'probe_failed',
      path: '/secret/root/movie.mkv',
      error: 'ffprobe /secret/root/movie.mkv failed',
    })),
    slowFiles: [{ path: 'C:\\secret\\root\\movie.mkv', durationMs: 1 }],
    watcher: {
      enabled: false,
      watching: 0,
      dirtyDirectories: 0,
      reconciling: false,
      overflow: 0,
      errors: ['Failed /secret/root'],
    },
  };
}

describe('ScanHistoryService persistence', () => {
  let database: DataSource;
  let history: ScanHistoryService;

  beforeEach(async () => {
    database = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [LibraryScanRunEntity],
      migrations: [AddLibraryScanRuns1738700000009],
      migrationsRun: true,
    }).initialize();
    history = new ScanHistoryService(
      database.getRepository(LibraryScanRunEntity),
    );
  });

  afterEach(async () => {
    await database?.destroy();
  });

  it('retains the latest 100 runs, at most 50 failures, and paginates deterministically', async () => {
    for (let index = 0; index < 103; index++)
      await history.record(report(index));
    const page = await history.list(1, 2);
    expect(page.total).toBe(100);
    expect(page.items.map((item) => item.id)).toEqual(['101', '100']);
    expect(page.items[0].failures).toHaveLength(50);
    await expect(history.get('2')).rejects.toThrow('Scan run not found');
    expect((await history.get('3')).id).toBe('3');
  });

  it('exports basenames by default without paths embedded in errors, preserving the stored report', async () => {
    await history.record(report(1));
    const safe = await history.export('1');
    expect(JSON.stringify(safe)).not.toContain('secret');
    expect(safe.metrics.roots[0].path).toBe('root');
    expect(safe.slowFiles[0].path).toBe('movie.mkv');
    expect(safe.failures[0].path).toBe('movie.mkv');
    expect((await history.export('1', false)).metrics.roots[0].path).toBe(
      '/secret/root',
    );
    expect((await history.get('1')).error).toContain('/secret/root');
  });
});
