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
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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
  @IsIn(['openrouter', 'deepseek'])
  provider?: 'openrouter' | 'deepseek';

  @IsOptional()
  @IsIn(['replace', 'alternate'])
  targetConflictResolution?: 'replace' | 'alternate';
}
