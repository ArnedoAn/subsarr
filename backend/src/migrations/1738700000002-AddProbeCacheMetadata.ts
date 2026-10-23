import {
  type MigrationInterface,
  type QueryRunner,
  TableColumn,
} from 'typeorm';

export class AddProbeCacheMetadata1738700000002 implements MigrationInterface {
  name = 'AddProbeCacheMetadata1738700000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('probe_cache', [
      new TableColumn({ name: 'size', type: 'real', isNullable: true }),
      new TableColumn({ name: 'error', type: 'text', isNullable: true }),
      new TableColumn({ name: 'retryAfter', type: 'real', isNullable: true }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns('probe_cache', [
      'size',
      'error',
      'retryAfter',
    ]);
  }
}
