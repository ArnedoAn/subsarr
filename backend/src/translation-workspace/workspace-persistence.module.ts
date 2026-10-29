import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkspaceCheckpointEntity } from '../database/entities/workspace-checkpoint.entity';
import { WorkspaceMemoryEntity } from '../database/entities/workspace-memory.entity';
import { WorkspacePersistenceService } from './workspace-persistence.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkspaceCheckpointEntity,
      WorkspaceMemoryEntity,
    ]),
  ],
  providers: [WorkspacePersistenceService],
  exports: [WorkspacePersistenceService],
})
export class WorkspacePersistenceModule {}
