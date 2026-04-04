import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('settings')
export class SettingEntity {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id: string;

  @Column({ type: 'text' })
  mediaDirsJson: string;

  @Column({ type: 'varchar', length: 16 })
  sourceLanguage: string;

  @Column({ type: 'varchar', length: 16 })
  targetLanguage: string;

  @Column({ type: 'text' })
  openRouterApiKey: string;

  @Column({ type: 'text' })
  deepSeekApiKey: string;

  @Column({ type: 'varchar', length: 128, default: 'openrouter/free' })
  openRouterModel: string;

  @Column({ type: 'varchar', length: 128, default: 'deepseek-chat' })
  deepSeekModel: string;

  @Column({ type: 'integer' })
  scanCacheTtlMinutes: number;

  @Column({ type: 'integer' })
  concurrency: number;

  @Column({ type: 'text' })
  pathContainsExclusionsJson: string;

  @Column({ type: 'integer', nullable: true })
  fileTooLargeBytes: number | null;

  @Column({ type: 'boolean', default: false })
  translationVerificationEnabled: boolean;

  @Column({ type: 'text' })
  rulesJson: string;

  @Column({ type: 'boolean', default: false })
  autoScanEnabled: boolean;

  @Column({ type: 'varchar', length: 128, default: '0 */6 * * *' })
  autoScanCronExpression: string;

  @Column({ type: 'boolean', default: false })
  autoTranslateNewItems: boolean;

  @Column({ type: 'text', nullable: true })
  telegramBotToken: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  telegramChatId: string | null;

  @Column({ type: 'boolean', default: false })
  telegramEnabled: boolean;

  @Column({ type: 'text', default: '[]' })
  telegramEventsJson: string;

  @Column({ type: 'integer', nullable: true })
  dailyTokenLimitFree: number | null;

  @Column({ type: 'integer', nullable: true })
  dailyTokenLimitPaid: number | null;

  @Column({ type: 'float', nullable: true })
  monthlyBudgetUsd: number | null;

  @Column({ type: 'text', nullable: true })
  jellyfinUrl: string | null;

  @Column({ type: 'text', nullable: true })
  jellyfinApiKey: string | null;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;
}
