import { forwardRef, Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { TelegramService } from './telegram.service';

@Module({
  imports: [forwardRef(() => SettingsModule)],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class NotificationsModule {}
