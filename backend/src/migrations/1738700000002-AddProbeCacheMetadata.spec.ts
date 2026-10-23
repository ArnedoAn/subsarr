import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DataSource } from 'typeorm';
import { ProbeCacheEntity } from '../database/entities/probe-cache.entity';
import { AddProbeCache1738700000001 } from './1738700000001-AddProbeCache';
import { AddProbeCacheMetadata1738700000002 } from './1738700000002-AddProbeCacheMetadata';

const legacyRow = {
  path: '/media/legacy.mkv',
  mtimeMs: 1738700000123,
  tracksJson: '[{"index":0,"codec_name":"subrip"}]',
};

describe('AddProbeCacheMetadata migration', () => {
  let directory: string | undefined;
  let dataSource: DataSource;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'subsarr-probe-cache-'));
    const database = path.join(directory, 'migration.sqlite');
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database,
      migrations: [AddProbeCache1738700000001],
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    await dataSource.query(
      'INSERT INTO "probe_cache" ("path", "mtimeMs", "tracksJson") VALUES (?, ?, ?)',
      [legacyRow.path, legacyRow.mtimeMs, legacyRow.tracksJson],
    );
    await dataSource.destroy();

    dataSource = new DataSource({
      type: 'better-sqlite3',
      database,
      entities: [ProbeCacheEntity],
      migrations: [
        AddProbeCache1738700000001,
        AddProbeCacheMetadata1738700000002,
      ],
      synchronize: false,
    });
    await dataSource.initialize();
  });

  afterEach(async () => {
    try {
      if (dataSource?.isInitialized) {
        await dataSource.destroy();
      }
    } finally {
      if (directory) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it('upgrades an existing cache without losing rows and persists failure metadata', async () => {
    const migrations = await dataSource.runMigrations();
    expect(migrations.map((migration) => migration.name)).toEqual([
      'AddProbeCacheMetadata1738700000002',
    ]);

    const repository = dataSource.getRepository(ProbeCacheEntity);
    expect(await repository.findOneByOrFail({ path: legacyRow.path })).toEqual({
      ...legacyRow,
      size: null,
      error: null,
      retryAfter: null,
    });

    const failure = {
      path: '/media/failed.mkv',
      mtimeMs: 1738700000456,
      size: 9_000_000_000,
      tracksJson: '[]',
      error: 'ffprobe timed out',
      retryAfter: 1738700300456,
    };
    await repository.save(failure);
    expect(await repository.findOneByOrFail({ path: failure.path })).toEqual(
      failure,
    );
    expect(await dataSource.runMigrations()).toEqual([]);
  });

  it('rolls back only metadata and can upgrade again with existing rows intact', async () => {
    await dataSource.runMigrations();
    await dataSource.getRepository(ProbeCacheEntity).update(legacyRow.path, {
      size: 4096,
      error: 'temporary probe failure',
      retryAfter: 1738700300123,
    });

    await dataSource.undoLastMigration();

    const columns = await dataSource.query<Array<{ name: string }>>(
      'PRAGMA table_info("probe_cache")',
    );
    expect(columns.map((column) => column.name)).toEqual([
      'path',
      'mtimeMs',
      'tracksJson',
    ]);
    expect(
      await dataSource.query<unknown[]>('SELECT * FROM "probe_cache"'),
    ).toEqual([legacyRow]);

    await dataSource.runMigrations();
    expect(
      await dataSource
        .getRepository(ProbeCacheEntity)
        .findOneByOrFail({ path: legacyRow.path }),
    ).toEqual({
      ...legacyRow,
      size: null,
      error: null,
      retryAfter: null,
    });
  });
});
