import { forwardRef, Module } from '@nestjs/common';
import { TranslationService } from './translation.service';
import { TranslationVerificationService } from './translation-verification.service';
import { SettingsModule } from '../settings/settings.module';
import { GlossaryModule } from '../glossary/glossary.module';
import { SubtitleTranslationService } from './subtitle-translation.service';
import { WorkspacePersistenceModule } from '../translation-workspace/workspace-persistence.module';

@Module({
  imports: [
    forwardRef(() => SettingsModule),
    GlossaryModule,
    WorkspacePersistenceModule,
  ],
  providers: [
    TranslationService,
    TranslationVerificationService,
    SubtitleTranslationService,
  ],
  exports: [
    TranslationService,
    TranslationVerificationService,
    SubtitleTranslationService,
  ],
})
export class TranslationModule {}
