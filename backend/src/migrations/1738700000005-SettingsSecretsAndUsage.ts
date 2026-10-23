import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SettingsSecretsAndUsage1738700000005 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE settings ADD COLUMN tmdbApiKey text`);
    await queryRunner.query(
      `ALTER TABLE settings ADD COLUMN deepSeekInputCacheHitUsdPerMillion float NOT NULL DEFAULT 0.028`,
    );
    await queryRunner.query(
      `ALTER TABLE settings ADD COLUMN deepSeekInputCacheMissUsdPerMillion float NOT NULL DEFAULT 0.28`,
    );
    await queryRunner.query(
      `ALTER TABLE settings ADD COLUMN deepSeekOutputUsdPerMillion float NOT NULL DEFAULT 0.42`,
    );
    await queryRunner.query(
      `ALTER TABLE settings ADD COLUMN pricingUpdatedAt text NOT NULL DEFAULT '2025-09-05'`,
    );
    await queryRunner.query(
      `ALTER TABLE settings ADD COLUMN pricingSource text NOT NULL DEFAULT 'https://api-docs.deepseek.com/quick_start/pricing'`,
    );
    await queryRunner.query(
      `ALTER TABLE token_usage ADD COLUMN cacheHitTokens integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE token_usage ADD COLUMN cacheMissTokens integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE token_usage ADD COLUMN costUsd float NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `UPDATE token_usage SET cacheMissTokens=promptTokens, costUsd=CASE WHEN tier='paid' THEN (promptTokens*0.28+completionTokens*0.42)/1000000.0 ELSE 0 END`,
    );
    await queryRunner.query(
      `CREATE TABLE provider_usage_attempts (id integer PRIMARY KEY AUTOINCREMENT, createdAt text NOT NULL, date text NOT NULL, provider text NOT NULL, model text NOT NULL, tier text NOT NULL, promptTokens integer NOT NULL, completionTokens integer NOT NULL, totalTokens integer NOT NULL, cacheHitTokens integer NOT NULL, cacheMissTokens integer NOT NULL, costUsd float NOT NULL, pricingSource text NOT NULL, pricingUpdatedAt text NOT NULL)`,
    );
    await queryRunner.query(
      `CREATE INDEX provider_usage_attempts_date ON provider_usage_attempts(date)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE provider_usage_attempts');
    for (const column of ['costUsd', 'cacheMissTokens', 'cacheHitTokens'])
      await queryRunner.dropColumn('token_usage', column);
    for (const column of [
      'pricingSource',
      'pricingUpdatedAt',
      'deepSeekOutputUsdPerMillion',
      'deepSeekInputCacheMissUsdPerMillion',
      'deepSeekInputCacheHitUsdPerMillion',
      'tmdbApiKey',
    ])
      await queryRunner.dropColumn('settings', column);
  }
}
