import { Module } from '@nestjs/common';
import { TranslationModule } from '../translation/translation.module';
import { SettingsModule } from '../settings/settings.module';
import { EvaluationController } from './evaluation.controller';
import { EvaluationService } from './evaluation.service';

@Module({
  imports: [TranslationModule, SettingsModule],
  controllers: [EvaluationController],
  providers: [EvaluationService],
})
export class EvaluationModule {}
