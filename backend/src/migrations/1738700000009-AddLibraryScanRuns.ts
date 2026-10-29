import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddLibraryScanRuns1738700000009 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE library_scan_runs (
      id varchar(36) PRIMARY KEY NOT NULL,
      startedAt integer NOT NULL,
      reportJson text NOT NULL
    )`);
    await queryRunner.query(
      'CREATE INDEX library_scan_runs_started ON library_scan_runs (startedAt)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE library_scan_runs');
  }
}
