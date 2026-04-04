import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('token_usage')
@Index(['tier', 'date'], { unique: true })
export class TokenUsageRowEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 8 })
  tier: string;

  /** YYYY-MM-DD or 'legacy' for migrated totals */
  @Column({ type: 'varchar', length: 16 })
  date: string;

  @Column({ type: 'integer', default: 0 })
  promptTokens: number;

  @Column({ type: 'integer', default: 0 })
  completionTokens: number;

  @Column({ type: 'integer', default: 0 })
  totalTokens: number;
}
