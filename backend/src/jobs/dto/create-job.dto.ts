import {
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  Matches,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { TranslationProvider } from '../../contracts/providers';

export class CreateJobDto {
  @IsString()
  @IsNotEmpty()
  mediaItemId!: string;

  @IsOptional()
  @IsString()
  mediaItemPath?: string;

  @IsString()
  @IsNotEmpty()
  sourceLanguage!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  targetLanguage?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  targetLanguages?: string[];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sourceTrackIndex!: number;

  @IsIn(['manual', 'batch', 'auto-scan'])
  triggeredBy!: 'manual' | 'batch' | 'auto-scan';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  respectProfiles?: boolean;

  @IsOptional()
  @IsBoolean()
  forceBypassRules?: boolean;

  @IsOptional()
  @IsBoolean()
  allowBudgetOverride?: boolean;

  @IsOptional()
  @IsIn(['openrouter', 'deepseek', 'opencode-go'])
  provider?: TranslationProvider;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._:/+@-]*$/)
  model?: string;

  @IsOptional()
  @IsIn(['fast', 'balanced', 'review'])
  qualityMode?: 'fast' | 'balanced' | 'review';

  @IsOptional()
  @IsString()
  @MaxLength(12000)
  contextHint?: string;

  @IsOptional()
  @IsBoolean()
  useTranslationMemory?: boolean;

  @IsOptional()
  @IsIn(['replace', 'alternate'])
  targetConflictResolution?: 'replace' | 'alternate';
}
