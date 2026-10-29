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
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { TranslationProvider } from '../../contracts/providers';

export class BatchItemDto {
  @IsString()
  @IsNotEmpty()
  mediaItemId!: string;

  @IsOptional()
  @IsString()
  mediaItemPath?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sourceTrackIndex!: number;
}

export class CreateBatchJobsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BatchItemDto)
  items!: BatchItemDto[];

  @IsString()
  @IsNotEmpty()
  sourceLanguage!: string;

  @IsString()
  @IsNotEmpty()
  targetLanguage!: string;

  @IsIn(['manual', 'batch', 'auto-scan'])
  triggeredBy!: 'manual' | 'batch' | 'auto-scan';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  priority?: number;

  @IsBoolean()
  forceBypassRules!: boolean;

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
