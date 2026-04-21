import { Module } from '@nestjs/common';
import { RenameController } from './rename.controller';
import { RenameService } from './rename.service';

@Module({
  controllers: [RenameController],
  providers: [RenameService],
})
export class RenameModule {}
