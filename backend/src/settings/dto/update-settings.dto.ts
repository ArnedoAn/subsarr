import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RuleToggleDto } from './rule-toggle.dto';

export class UpdateSettingsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  mediaDirs!: string[];

  @IsString()
  sourceLanguage!: string;

  @IsString()
  targetLanguage!: string;

  @IsOptional()
  @IsString()
  openRouterApiKey?: string;

  @IsOptional()
  @IsString()
  deepSeekApiKey?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  scanCacheTtlMinutes!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  concurrency!: number;

  @IsArray()
  @IsString({ each: true })
  pathContainsExclusions!: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fileTooLargeBytes?: number;

  @IsBoolean()
  translationVerificationEnabled!: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuleToggleDto)
  rules!: RuleToggleDto[];
}
