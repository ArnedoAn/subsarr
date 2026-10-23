import { DataSource } from 'typeorm';
import { JobSnapshotEntity } from '../database/entities/job-snapshot.entity';
import { JobLogRowEntity } from '../database/entities/job-log.entity';
import { JobArchiveService } from '../jobs/job-archive.service';
import type { JobLogEntry } from '../jobs/job-logs.service';
import { JobSchedulerState1738700000006 } from './1738700000006-JobSchedulerState';

const historicalLog: JobLogEntry = {
  id: 'archive-only-log',
  jobId: 'legacy-job',
  level: 'warn',
  phase: 'verification',
  message: 'Historical verification warning',
  timestamp: '2025-02-01T12:00:00.000Z',
  details: { line: 17, reason: 'language mismatch' },
};

function historicalSnapshot(logsJson: string): JobSnapshotEntity {
  return {
    id: 'legacy-job',
    state: 'completed',
    progress: 100,
    dataJson: JSON.stringify({
      mediaItemId: 'media',
      mediaItemPath: '/media/legacy.mkv',
      sourceLanguage: 'eng',
      targetLanguage: 'spa',
      sourceTrackIndex: 0,
      triggeredBy: 'manual',
    }),
    createdAt: 1,
    processedAt: 2,
    finishedAt: 3,
    returnValueJson: null,
    failedReason: null,
    logsJson,
  };
}

describe('JobSchedulerState migration preserves historical archive logs', () => {
  let database: DataSource;
  beforeEach(async () => {
    database = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [JobSnapshotEntity, JobLogRowEntity],
      synchronize: true,
    });
    await database.initialize();
  });
  afterEach(async () => {
    if (database.isInitialized) await database.destroy();
  });

  it('preserves the only log copy and keeps it readable through archived job detail', async () => {
    const snapshots = database.getRepository(JobSnapshotEntity);
    const canonical = database.getRepository(JobLogRowEntity);
    const embedded = JSON.stringify([historicalLog]);
    await snapshots.save(historicalSnapshot(embedded));
    expect(await canonical.count()).toBe(0);
    const runner = database.createQueryRunner();
    try {
      await new JobSchedulerState1738700000006().up(runner);
      expect(await runner.hasTable('job_scheduler_state')).toBe(true);
      expect(
        (await snapshots.findOneByOrFail({ id: 'legacy-job' })).logsJson,
      ).toBe(embedded);
      const archive = new JobArchiveService(snapshots, canonical);
      expect((await archive.getSnapshot('legacy-job'))?.logs).toEqual([
        historicalLog,
      ]);
      expect((await archive.readSnapshots())[0].logs).toEqual([]);
      expect(await canonical.count()).toBe(0);
    } finally {
      await runner.release();
    }
  });

  it.each([
    'not valid JSON',
    JSON.stringify({ unrecognized: 'legacy object' }),
  ])(
    'retains invalid or unrecognized legacy bytes without an empty-log fallback: %s',
    async (embedded) => {
      const snapshots = database.getRepository(JobSnapshotEntity);
      await snapshots.save(historicalSnapshot(embedded));
      const runner = database.createQueryRunner();
      try {
        await new JobSchedulerState1738700000006().up(runner);
        expect(
          (await snapshots.findOneByOrFail({ id: 'legacy-job' })).logsJson,
        ).toBe(embedded);
        const archive = new JobArchiveService(
          snapshots,
          database.getRepository(JobLogRowEntity),
        );
        await expect(archive.getSnapshot('legacy-job')).rejects.toThrow();
        expect(
          (await snapshots.findOneByOrFail({ id: 'legacy-job' })).logsJson,
        ).toBe(embedded);
        expect(await archive.readSnapshots()).toHaveLength(1);
      } finally {
        await runner.release();
      }
    },
  );

  it('rolls back scheduler state without changing historical archive logs', async () => {
    const embedded = JSON.stringify([historicalLog]);
    const snapshots = database.getRepository(JobSnapshotEntity);
    await snapshots.save(historicalSnapshot(embedded));
    const runner = database.createQueryRunner();
    try {
      const migration = new JobSchedulerState1738700000006();
      await migration.up(runner);
      await migration.down(runner);
      expect(await runner.hasTable('job_scheduler_state')).toBe(false);
      expect(
        (await snapshots.findOneByOrFail({ id: 'legacy-job' })).logsJson,
      ).toBe(embedded);
    } finally {
      await runner.release();
    }
  });
});
