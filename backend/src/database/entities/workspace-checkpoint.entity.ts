import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('workspace_checkpoints')
@Index(['updatedAt'])
export class WorkspaceCheckpointEntity {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  id: string;

  @Column({ type: 'text' })
  translationsJson: string;

  @Column({ type: 'text', nullable: true })
  contextSheet: string | null;

  @Column({ type: 'text' })
  identity: string;

  @Column({ type: 'integer' })
  createdAt: number;

  @Column({ type: 'integer' })
  updatedAt: number;
}
