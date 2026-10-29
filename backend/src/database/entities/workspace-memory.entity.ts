import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('workspace_memory')
@Index(['updatedAt'])
@Check('approved = 1')
export class WorkspaceMemoryEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;

  @Column({ type: 'text' })
  source: string;

  @Column({ type: 'text' })
  target: string;

  @Column({ type: 'varchar', length: 128 })
  contextHash: string;

  @Column({ type: 'varchar', length: 64 })
  sourceLanguage: string;

  @Column({ type: 'varchar', length: 64 })
  targetLanguage: string;

  @Column({ type: 'text' })
  signature: string;

  @Column({ type: 'boolean' })
  approved: boolean;

  @Column({ type: 'varchar', length: 128, nullable: true })
  model: string | null;

  @Column({ type: 'text', nullable: true })
  provenance: string | null;

  @Column({ type: 'integer' })
  createdAt: number;

  @Column({ type: 'integer' })
  updatedAt: number;
}
