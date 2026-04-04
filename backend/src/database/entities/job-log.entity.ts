import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('job_logs')
@Index(['jobId'])
@Index(['level'])
@Index(['timestamp'])
export class JobLogRowEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  jobId: string | null;

  @Column({ type: 'varchar', length: 8 })
  level: string;

  @Column({ type: 'varchar', length: 64 })
  phase: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'text', nullable: true })
  detailsJson: string | null;

  @Column({ type: 'varchar', length: 32 })
  timestamp: string;
}
