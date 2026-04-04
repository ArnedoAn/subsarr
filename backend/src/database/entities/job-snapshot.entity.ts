import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('job_snapshots')
@Index(['finishedAt'])
export class JobSnapshotEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;

  @Column({ type: 'varchar', length: 16 })
  state: string;

  @Column({ type: 'text' })
  dataJson: string;

  @Column({ type: 'integer' })
  progress: number;

  @Column({ type: 'text', nullable: true })
  returnValueJson: string | null;

  @Column({ type: 'text', nullable: true })
  failedReason: string | null;

  @Column({ type: 'integer' })
  createdAt: number;

  @Column({ type: 'integer', nullable: true })
  processedAt: number | null;

  @Column({ type: 'integer' })
  finishedAt: number;

  @Column({ type: 'text', default: '[]' })
  logsJson: string;
}
