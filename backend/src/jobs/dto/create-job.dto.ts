import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

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
  @IsIn(['openrouter', 'deepseek'])
  provider?: 'openrouter' | 'deepseek';

  @IsOptional()
  @IsIn(['replace', 'alternate'])
  targetConflictResolution?: 'replace' | 'alternate';
}
