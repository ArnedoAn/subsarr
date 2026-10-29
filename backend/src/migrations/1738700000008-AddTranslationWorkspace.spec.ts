import { DataSource } from 'typeorm';
import { WorkspaceCheckpointEntity } from '../database/entities/workspace-checkpoint.entity';
import { WorkspaceMemoryEntity } from '../database/entities/workspace-memory.entity';
import { AddTranslationWorkspace1738700000008 } from './1738700000008-AddTranslationWorkspace';

describe('AddTranslationWorkspace migration', () => {
  it('creates usable SQLite tables and indexes, rejects unapproved memory and rolls back cleanly', async () => {
    const database = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [WorkspaceCheckpointEntity, WorkspaceMemoryEntity],
    }).initialize();
    const runner = database.createQueryRunner();
    try {
      await runner.query(
        'CREATE TABLE unrelated (id text PRIMARY KEY, value text)',
      );
      await runner.query(
        "INSERT INTO unrelated VALUES ('existing', 'preserved')",
      );
      const migration = new AddTranslationWorkspace1738700000008();
      await migration.up(runner);
      const checkpoints = database.getRepository(WorkspaceCheckpointEntity);
      const memory = database.getRepository(WorkspaceMemoryEntity);
      await checkpoints.save({
        id: 'checkpoint',
        identity: 'complete-document-and-settings-hash',
        translationsJson: '{"0":"Hola"}',
        contextSheet: 'Story',
        createdAt: 10,
        updatedAt: 20,
      });
      const entry = {
        id: 'approved',
        source: 'Hello',
        target: 'Hola',
        sourceLanguage: 'en',
        targetLanguage: 'es',
        contextHash: 'context',
        signature: 'style',
        approved: true,
        model: null,
        provenance: 'editor',
        createdAt: 10,
        updatedAt: 20,
      };
      await memory.save(entry);
      expect(
        (await checkpoints.findOneByOrFail({ id: 'checkpoint' })).identity,
      ).toBe('complete-document-and-settings-hash');
      expect(await memory.findOneBy({ id: 'approved' })).toEqual(entry);
      await expect(
        memory.insert({ ...entry, id: 'unapproved', approved: false }),
      ).rejects.toThrow();
      expect(
        (await runner.getTable('workspace_checkpoints'))?.indices.some(
          (index) => index.columnNames.includes('updatedAt'),
        ),
      ).toBe(true);
      expect(
        (await runner.getTable('workspace_memory'))?.indices.some((index) =>
          index.columnNames.includes('updatedAt'),
        ),
      ).toBe(true);
      await migration.down(runner);
      expect(await runner.hasTable('workspace_checkpoints')).toBe(false);
      expect(await runner.hasTable('workspace_memory')).toBe(false);
      expect(await runner.query('SELECT * FROM unrelated')).toEqual([
        { id: 'existing', value: 'preserved' },
      ]);
      await migration.up(runner);
      expect(await memory.count()).toBe(0);
      expect(await checkpoints.count()).toBe(0);
    } finally {
      await runner.release();
      await database.destroy();
    }
  });
});
