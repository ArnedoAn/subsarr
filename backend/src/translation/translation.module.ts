import { Module } from '@nestjs/common';
import { TranslationService } from './translation.service';
import { TranslationVerificationService } from './translation-verification.service';

@Module({
  providers: [TranslationService, TranslationVerificationService],
  exports: [TranslationService, TranslationVerificationService],
})
export class TranslationModule {}
