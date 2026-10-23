import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('media_inventory')
export class MediaInventoryEntity {
  @PrimaryColumn() id!: string;
  @Index({ unique: true }) @Column() path!: string;
  @Column() name!: string;
  @Column() folder!: string;
  @Index() @Column() type!: string;
  @Column() probeStatus!: string;
  @Column('text') itemJson!: string;
  @Column('text') searchText!: string;
  @Column('text') languages!: string;
  @Index() @Column() groupKey!: string;
  @Column() groupLabel!: string;
  @Column('integer', { nullable: true }) season!: number | null;
  @Column('integer') size!: number;
  @Column('real') modifiedAt!: number;
  @Column('integer') trackCount!: number;
  @Column('real') discoveredAt!: number;
}
