import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BatchPreviewItemDto {
  @IsString()
  @IsNotEmpty()
  mediaItemId!: string;
}

export class BatchPreviewDto {
  @IsArray()
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
  @IsIn(['replace', 'alternate'])
  targetConflictResolution?: 'replace' | 'alternate';
}
