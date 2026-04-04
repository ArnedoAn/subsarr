import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { subsyncConfig, type SubsyncEnvConfig } from './config/subsync.config';
import { DatabaseModule } from './database/database.module';
import { SettingsModule } from './settings/settings.module';
import { LibraryModule } from './library/library.module';
import { RulesModule } from './rules/rules.module';
import { ExtractionModule } from './extraction/extraction.module';
import { TranslationModule } from './translation/translation.module';
import { OutputModule } from './output/output.module';
import { JobsModule } from './jobs/jobs.module';
import { SystemModule } from './system/system.module';
import { StatsModule } from './stats/stats.module';
import { ProfilesModule } from './profiles/profiles.module';
import { GlossaryModule } from './glossary/glossary.module';
import { IntegrationsModule } from './integrations/integrations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [subsyncConfig],
    }),
    DatabaseModule,
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const config = configService.get<SubsyncEnvConfig>('subsync');
        if (!config) {
          throw new Error('Missing subsync configuration');
        }

        const redisUrl = new URL(config.redisUrl);
        return {
          redis: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port) || 6379,
            password: redisUrl.password || undefined,
            db:
              redisUrl.pathname && redisUrl.pathname !== '/'
                ? Number(redisUrl.pathname.slice(1))
                : 0,
          },
        };
      },
    }),
    SettingsModule,
    LibraryModule,
    RulesModule,
    ExtractionModule,
    TranslationModule,
    OutputModule,
    JobsModule,
    SystemModule,
    StatsModule,
    ProfilesModule,
    GlossaryModule,
    IntegrationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
