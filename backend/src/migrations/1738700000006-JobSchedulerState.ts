import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class JobSchedulerState1738700000006 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE job_scheduler_state (
      id varchar(64) PRIMARY KEY NOT NULL,
      knownItemIds text NOT NULL,
      pendingProbeItemIds text NOT NULL,
      mediaRootsKey text
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE job_scheduler_state');
  }
}
