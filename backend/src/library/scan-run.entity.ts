import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('library_scan_runs')
export class LibraryScanRunEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Column({ type: 'integer' })
  startedAt!: number;

  @Column({ type: 'text' })
  reportJson!: string;
}
