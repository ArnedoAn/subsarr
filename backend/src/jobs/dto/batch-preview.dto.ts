import {
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { TranslationProvider } from '../../contracts/providers';

export class BatchPreviewItemDto {
  @IsString()
  @IsNotEmpty()
  mediaItemId!: string;
}

export class BatchPreviewDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BatchPreviewItemDto)
  items!: BatchPreviewItemDto[];

  @IsString()
  @IsNotEmpty()
  sourceLanguage!: string;

  @IsString()
  @IsNotEmpty()
  targetLanguage!: string;

  @IsBoolean()
  forceBypassRules!: boolean;

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
