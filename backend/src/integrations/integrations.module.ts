import { forwardRef, Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { JellyfinService } from './jellyfin.service';

@Module({
  imports: [forwardRef(() => SettingsModule)],
  providers: [JellyfinService],
  exports: [JellyfinService],
})
export class IntegrationsModule {}
