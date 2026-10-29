import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import type {
  TranslationProvider,
  TranslationQualityMode,
} from '../contracts/providers';

export class RunEvaluationDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(64)
  caseId!: string;

  @IsIn(['openrouter', 'deepseek', 'opencode-go'])
  provider!: TranslationProvider;

  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/)
  @MaxLength(128)
  model!: string;

  @IsOptional()
  @IsIn(['fast', 'balanced', 'review'])
  qualityMode?: TranslationQualityMode;

  @IsOptional()
  @IsBoolean()
  allowBudgetOverride?: boolean;
}
