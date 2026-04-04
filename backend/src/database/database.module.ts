import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { type SubsyncEnvConfig } from '../config/subsync.config';
import { SettingEntity } from './entities/setting.entity';
import { TokenUsageRowEntity } from './entities/token-usage-row.entity';
import { JobSnapshotEntity } from './entities/job-snapshot.entity';
import { JobLogRowEntity } from './entities/job-log.entity';
import { LegacyImportService } from './legacy-import.service';
import { InitialSchema1738700000000 } from '../migrations/1738700000000-InitialSchema';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const config = configService.get<SubsyncEnvConfig>('subsync');
        if (!config) {
          throw new Error('Missing subsync configuration');
        }
        const database = config.databasePath;
        try {
          mkdirSync(path.dirname(database), { recursive: true });
        } catch {
          /* ignore */
        }
        return {
          type: 'better-sqlite3' as const,
          database,
          entities: [
            SettingEntity,
            TokenUsageRowEntity,
            JobSnapshotEntity,
            JobLogRowEntity,
          ],
          migrations: [InitialSchema1738700000000],
          migrationsRun: true,
          synchronize: false,
          logging: false,
        };
      },
    }),
  ],
  providers: [LegacyImportService],
})
export class DatabaseModule {}
