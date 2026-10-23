import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddMediaInventory1738700000003 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE media_inventory (
      id varchar PRIMARY KEY NOT NULL, path varchar NOT NULL UNIQUE,
      name varchar NOT NULL, folder varchar NOT NULL, type varchar NOT NULL,
      probeStatus varchar NOT NULL, itemJson text NOT NULL, searchText text NOT NULL,
      languages text NOT NULL, groupKey varchar NOT NULL, groupLabel varchar NOT NULL,
      season integer, size integer NOT NULL, modifiedAt real NOT NULL,
      trackCount integer NOT NULL, discoveredAt real NOT NULL
    )`);
    await queryRunner.query(
      'CREATE INDEX IDX_inventory_type ON media_inventory(type)',
    );
    await queryRunner.query(
      'CREATE INDEX IDX_inventory_group ON media_inventory(groupKey)',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE media_inventory');
  }
}
