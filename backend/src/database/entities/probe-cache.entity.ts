import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('probe_cache')
export class ProbeCacheEntity {
  @PrimaryColumn({ type: 'text' })
  path: string;

  @Column({ type: 'real' })
  mtimeMs: number;

  @Column({ type: 'real', nullable: true })
  size: number | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'real', nullable: true })
  retryAfter: number | null;

  @Column({ type: 'text' })
  tracksJson: string;
}
