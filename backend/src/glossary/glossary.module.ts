import { Module } from '@nestjs/common';
import { GlossaryService } from './glossary.service';
import { GlossaryController } from './glossary.controller';

@Module({
  controllers: [GlossaryController],
  providers: [GlossaryService],
  exports: [GlossaryService],
})
export class GlossaryModule {}
