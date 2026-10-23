import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('job_scheduler_state')
export class JobSchedulerStateEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;

  @Column({ type: 'simple-json' })
  knownItemIds: string[];

  @Column({ type: 'simple-json' })
  pendingProbeItemIds: string[];

  @Column({ type: 'text', nullable: true })
  mediaRootsKey: string | null;
}
