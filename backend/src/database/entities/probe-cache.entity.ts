import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('probe_cache')
export class ProbeCacheEntity {
  @PrimaryColumn({ type: 'text' })
  path: string;

  @Column({ type: 'real' })
  mtimeMs: number;

  @Column({ type: 'text' })
  tracksJson: string;
}
