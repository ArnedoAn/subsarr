import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
@Entity('rename_journal')
export class RenameJournalEntity {
  @PrimaryColumn({ type: 'text' }) id: string;
  @Index() @Column({ type: 'text' }) batchId: string;
  @Column({ type: 'text' }) originalPath: string;
  @Column({ type: 'text' }) destinationPath: string;
  @Column({ type: 'text' }) identity: string;
  @Column({ type: 'text' }) state: 'pending' | 'renamed' | 'failed' | 'undone';
  @Column({ type: 'text', nullable: true }) error: string | null;
  @Column({ type: 'text' }) createdAt: string;
}
