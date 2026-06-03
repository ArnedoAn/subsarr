import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddProbeCache1738700000001 implements MigrationInterface {
  name = 'AddProbeCache1738700000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "probe_cache" (
        "path" text PRIMARY KEY NOT NULL,
        "mtimeMs" real NOT NULL,
        "tracksJson" text NOT NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "probe_cache"`);
  }
}
