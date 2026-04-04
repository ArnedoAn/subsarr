import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { TokenUsageService } from './token-usage.service';
import { SettingEntity } from '../database/entities/setting.entity';
import { TokenUsageRowEntity } from '../database/entities/token-usage-row.entity';
import { JobsModule } from '../jobs/jobs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { GlossaryModule } from '../glossary/glossary.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SettingEntity, TokenUsageRowEntity]),
    forwardRef(() => JobsModule),
    forwardRef(() => NotificationsModule),
    forwardRef(() => IntegrationsModule),
    ProfilesModule,
    GlossaryModule,
  ],
  providers: [SettingsService, TokenUsageService],
  controllers: [SettingsController],
  exports: [SettingsService, TokenUsageService],
})
export class SettingsModule {}
