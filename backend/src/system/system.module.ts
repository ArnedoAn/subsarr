import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SettingsModule } from '../settings/settings.module';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

@Module({
  imports: [SettingsModule, BullModule.registerQueue({ name: 'translation' })],
  controllers: [SystemController],
  providers: [SystemService],
  exports: [SystemService],
})
export class SystemModule {}
