import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { TranslationBillingTier } from '../../contracts/providers';

@Entity('token_usage')
@Index(['tier', 'date'], { unique: true })
export class TokenUsageRowEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 16 })
  tier: TranslationBillingTier;

  /** YYYY-MM-DD or 'legacy' for migrated totals */
  @Column({ type: 'varchar', length: 16 })
  date: string;

  @Column({ type: 'integer', default: 0 })
  promptTokens: number;

  @Column({ type: 'integer', default: 0 })
  completionTokens: number;

  @Column({ type: 'integer', default: 0 })
  totalTokens: number;

  @Column({ type: 'integer', default: 0 })
  cacheHitTokens: number;

  @Column({ type: 'integer', default: 0 })
  cacheMissTokens: number;

  @Column({ type: 'float', default: 0 })
  costUsd: number;
}
