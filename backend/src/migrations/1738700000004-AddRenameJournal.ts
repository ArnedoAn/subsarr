import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';
export class AddRenameJournal1738700000004 implements MigrationInterface {
  name = 'AddRenameJournal1738700000004';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'rename_journal',
        columns: [
          { name: 'id', type: 'text', isPrimary: true },
          ...[
            'batchId',
            'originalPath',
            'destinationPath',
            'identity',
            'state',
            'createdAt',
          ].map((name) => ({ name, type: 'text' })),
          { name: 'error', type: 'text', isNullable: true },
        ],
      }),
    );
    await queryRunner.createIndex(
      'rename_journal',
      new TableIndex({
        name: 'IDX_rename_journal_batch',
        columnNames: ['batchId'],
      }),
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('rename_journal');
  }
}
