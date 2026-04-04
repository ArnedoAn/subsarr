import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class InitialSchema1738700000000 implements MigrationInterface {
  name = 'InitialSchema1738700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "settings" (
        "id" varchar(32) PRIMARY KEY NOT NULL,
        "mediaDirsJson" text NOT NULL,
        "sourceLanguage" varchar(16) NOT NULL,
        "targetLanguage" varchar(16) NOT NULL,
        "openRouterApiKey" text NOT NULL,
        "deepSeekApiKey" text NOT NULL,
        "openRouterModel" varchar(128) NOT NULL DEFAULT 'openrouter/free',
        "deepSeekModel" varchar(128) NOT NULL DEFAULT 'deepseek-chat',
        "scanCacheTtlMinutes" integer NOT NULL,
        "concurrency" integer NOT NULL,
        "pathContainsExclusionsJson" text NOT NULL,
        "fileTooLargeBytes" integer,
        "translationVerificationEnabled" boolean NOT NULL DEFAULT 0,
        "rulesJson" text NOT NULL,
        "autoScanEnabled" boolean NOT NULL DEFAULT 0,
        "autoScanCronExpression" varchar(128) NOT NULL DEFAULT '0 */6 * * *',
        "autoTranslateNewItems" boolean NOT NULL DEFAULT 0,
        "telegramBotToken" text,
        "telegramChatId" varchar(64),
        "telegramEnabled" boolean NOT NULL DEFAULT 0,
        "telegramEventsJson" text NOT NULL DEFAULT '[]',
        "dailyTokenLimitFree" integer,
        "dailyTokenLimitPaid" integer,
        "monthlyBudgetUsd" float,
        "jellyfinUrl" text,
        "jellyfinApiKey" text,
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "token_usage" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "tier" varchar(8) NOT NULL,
        "date" varchar(16) NOT NULL,
        "promptTokens" integer NOT NULL DEFAULT 0,
        "completionTokens" integer NOT NULL DEFAULT 0,
        "totalTokens" integer NOT NULL DEFAULT 0,
        CONSTRAINT "UQ_token_usage_tier_date" UNIQUE ("tier", "date")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "job_snapshots" (
        "id" varchar(64) PRIMARY KEY NOT NULL,
        "state" varchar(16) NOT NULL,
        "dataJson" text NOT NULL,
        "progress" integer NOT NULL,
        "returnValueJson" text,
        "failedReason" text,
        "createdAt" integer NOT NULL,
        "processedAt" integer,
        "finishedAt" integer NOT NULL,
        "logsJson" text NOT NULL DEFAULT '[]'
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_job_snapshots_finishedAt" ON "job_snapshots" ("finishedAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE "job_logs" (
        "id" varchar(64) PRIMARY KEY NOT NULL,
        "jobId" varchar(64),
        "level" varchar(8) NOT NULL,
        "phase" varchar(64) NOT NULL,
        "message" text NOT NULL,
        "detailsJson" text,
        "timestamp" varchar(32) NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_job_logs_jobId" ON "job_logs" ("jobId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_job_logs_level" ON "job_logs" ("level")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_job_logs_timestamp" ON "job_logs" ("timestamp")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "job_logs"`);
    await queryRunner.query(`DROP TABLE "job_snapshots"`);
    await queryRunner.query(`DROP TABLE "token_usage"`);
    await queryRunner.query(`DROP TABLE "settings"`);
  }
}
