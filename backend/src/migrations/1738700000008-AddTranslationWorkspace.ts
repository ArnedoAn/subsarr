import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTranslationWorkspace1738700000008 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE workspace_checkpoints (
      id varchar(128) PRIMARY KEY NOT NULL,
      identity text NOT NULL,
      translationsJson text NOT NULL,
      contextSheet text,
      createdAt integer NOT NULL,
      updatedAt integer NOT NULL
    )`);
    await queryRunner.query(
      'CREATE INDEX workspace_checkpoints_updated ON workspace_checkpoints (updatedAt)',
    );
    await queryRunner.query(`CREATE TABLE workspace_memory (
      id varchar(64) PRIMARY KEY NOT NULL,
      source text NOT NULL,
      target text NOT NULL,
      contextHash varchar(128) NOT NULL,
      sourceLanguage varchar(64) NOT NULL,
      targetLanguage varchar(64) NOT NULL,
      signature text NOT NULL,
      approved boolean NOT NULL CHECK (approved = 1),
      model varchar(128),
      provenance text,
      createdAt integer NOT NULL,
      updatedAt integer NOT NULL
    )`);
    await queryRunner.query(
      'CREATE INDEX workspace_memory_updated ON workspace_memory (updatedAt)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE workspace_memory');
    await queryRunner.query('DROP TABLE workspace_checkpoints');
  }
}
