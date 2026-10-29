import { DataSource } from 'typeorm';
import { AddOpenCodeGo1738700000007 } from './1738700000007-AddOpenCodeGo';

describe('AddOpenCodeGo migration', () => {
  it('adds safe legacy defaults and rolls back without altering existing settings or usage', async () => {
    const database = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
    });
    await database.initialize();
    const runner = database.createQueryRunner();
    try {
      await runner.query(
        'CREATE TABLE settings (id text PRIMARY KEY, openRouterApiKey text NOT NULL)',
      );
      await runner.query(
        "INSERT INTO settings VALUES ('main', 'original-ciphertext')",
      );
      await runner.query(
        'CREATE TABLE token_usage (tier varchar(8), totalTokens integer, costUsd float)',
      );
      await runner.query(
        "INSERT INTO token_usage VALUES ('free', 10, 0), ('paid', 20, 1.25)",
      );
      const usage: unknown = await runner.query('SELECT * FROM token_usage');
      const migration = new AddOpenCodeGo1738700000007();
      await migration.up(runner);
      expect(await runner.query('SELECT * FROM settings')).toEqual([
        {
          id: 'main',
          openRouterApiKey: 'original-ciphertext',
          opencodeGoApiKeyEncrypted: null,
          opencodeGoModel: 'glm-5.2',
          defaultProvider: 'openrouter',
        },
      ]);
      expect(await runner.query('SELECT * FROM token_usage')).toEqual(usage);
      await migration.down(runner);
      expect(await runner.query('SELECT * FROM settings')).toEqual([
        { id: 'main', openRouterApiKey: 'original-ciphertext' },
      ]);
      expect(await runner.query('SELECT * FROM token_usage')).toEqual(usage);
    } finally {
      await runner.release();
      await database.destroy();
    }
  });
});
