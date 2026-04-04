import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobSnapshotEntity } from '../database/entities/job-snapshot.entity';
import { SettingsModule } from '../settings/settings.module';
import { JobsModule } from '../jobs/jobs.module';
import { LibraryModule } from '../library/library.module';
import { StatsService } from './stats.service';
import { StatsController } from './stats.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([JobSnapshotEntity]),
    SettingsModule,
    JobsModule,
    LibraryModule,
  ],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
