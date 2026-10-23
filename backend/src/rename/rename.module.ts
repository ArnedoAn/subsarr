import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RenameJournalEntity } from '../database/entities/rename-journal.entity';
import { SettingsModule } from '../settings/settings.module';
import { RenameController } from './rename.controller';
import { RenameService } from './rename.service';
import { RenameMetadataService } from './rename-metadata.service';
@Module({
  imports: [SettingsModule, TypeOrmModule.forFeature([RenameJournalEntity])],
  controllers: [RenameController],
  providers: [RenameService, RenameMetadataService],
})
export class RenameModule {}
