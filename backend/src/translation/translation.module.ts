import { forwardRef, Module } from '@nestjs/common';
import { TranslationService } from './translation.service';
import { TranslationVerificationService } from './translation-verification.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [forwardRef(() => SettingsModule)],
  providers: [TranslationService, TranslationVerificationService],
  exports: [TranslationService, TranslationVerificationService],
})
export class TranslationModule {}
