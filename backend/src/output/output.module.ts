import { Module } from '@nestjs/common';
import { OutputService } from './output.service';

@Module({
  providers: [OutputService],
  exports: [OutputService],
})
export class OutputModule {}
