import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { type Database } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { type SubsyncEnvConfig } from '../config/subsync.config';
import { SettingEntity } from './entities/setting.entity';
import { TokenUsageRowEntity } from './entities/token-usage-row.entity';
import { JobSnapshotEntity } from './entities/job-snapshot.entity';
import { JobLogRowEntity } from './entities/job-log.entity';
import { ProbeCacheEntity } from './entities/probe-cache.entity';
import { LegacyImportService } from './legacy-import.service';
import { InitialSchema1738700000000 } from '../migrations/1738700000000-InitialSchema';
import { AddProbeCache1738700000001 } from '../migrations/1738700000001-AddProbeCache';
import { AddProbeCacheMetadata1738700000002 } from '../migrations/1738700000002-AddProbeCacheMetadata';
import { MediaInventoryEntity } from './entities/media-inventory.entity';
import { RenameJournalEntity } from './entities/rename-journal.entity';
import { AddMediaInventory1738700000003 } from '../migrations/1738700000003-AddMediaInventory';
import { AddRenameJournal1738700000004 } from '../migrations/1738700000004-AddRenameJournal';
import { SettingsSecretsAndUsage1738700000005 } from '../migrations/1738700000005-SettingsSecretsAndUsage';
import { JobSchedulerStateEntity } from './entities/job-scheduler-state.entity';
import { JobSchedulerState1738700000006 } from '../migrations/1738700000006-JobSchedulerState';
import { AddOpenCodeGo1738700000007 } from '../migrations/1738700000007-AddOpenCodeGo';
import { LibraryScanRunEntity } from '../library/scan-run.entity';
import { AddLibraryScanRuns1738700000009 } from '../migrations/1738700000009-AddLibraryScanRuns';
import { WorkspaceCheckpointEntity } from './entities/workspace-checkpoint.entity';
import { WorkspaceMemoryEntity } from './entities/workspace-memory.entity';
import { AddTranslationWorkspace1738700000008 } from '../migrations/1738700000008-AddTranslationWorkspace';

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
          prepareDatabase: (connection: Database) => {
            connection.pragma('busy_timeout = 5000');
          },
          entities: [
            SettingEntity,
            TokenUsageRowEntity,
            JobSnapshotEntity,
            JobLogRowEntity,
            ProbeCacheEntity,
            MediaInventoryEntity,
            RenameJournalEntity,
            JobSchedulerStateEntity,
            LibraryScanRunEntity,
            WorkspaceCheckpointEntity,
            WorkspaceMemoryEntity,
          ],
          migrations: [
            InitialSchema1738700000000,
            AddProbeCache1738700000001,
            AddProbeCacheMetadata1738700000002,
            AddMediaInventory1738700000003,
            AddRenameJournal1738700000004,
            SettingsSecretsAndUsage1738700000005,
            JobSchedulerState1738700000006,
            AddOpenCodeGo1738700000007,
            AddTranslationWorkspace1738700000008,
            AddLibraryScanRuns1738700000009,
          ],
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
