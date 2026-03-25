import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
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

  @IsString()
  @IsNotEmpty()
  targetLanguage!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sourceTrackIndex!: number;

  @IsIn(['manual', 'batch'])
  triggeredBy!: 'manual' | 'batch';

  @IsOptional()
  @IsBoolean()
  forceBypassRules?: boolean;

  @IsOptional()
  @IsIn(['openrouter', 'deepseek'])
  provider?: 'openrouter' | 'deepseek';
}
