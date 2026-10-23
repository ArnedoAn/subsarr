import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { TranslationModule } from '../translation/translation.module';
import { QuickTranslateController } from './quick-translate.controller';
import { QuickTranslateService } from './quick-translate.service';
import { QuickUploadAdmission } from './quick-upload';

@Module({
  imports: [SettingsModule, TranslationModule],
  controllers: [QuickTranslateController],
  providers: [QuickTranslateService, QuickUploadAdmission],
  exports: [QuickTranslateService],
})
export class QuickTranslateModule {}
