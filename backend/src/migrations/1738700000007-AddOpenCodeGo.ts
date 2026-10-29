import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOpenCodeGo1738700000007 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE settings ADD COLUMN opencodeGoApiKeyEncrypted text',
    );
    await queryRunner.query(
      "ALTER TABLE settings ADD COLUMN opencodeGoModel varchar(128) NOT NULL DEFAULT 'glm-5.2'",
    );
    await queryRunner.query(
      "ALTER TABLE settings ADD COLUMN defaultProvider varchar(32) NOT NULL DEFAULT 'openrouter'",
    );
    // SQLite does not enforce varchar lengths: existing free/paid usage stays untouched.
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of [
      'defaultProvider',
      'opencodeGoModel',
      'opencodeGoApiKeyEncrypted',
    ])
      await queryRunner.dropColumn('settings', column);
  }
}
