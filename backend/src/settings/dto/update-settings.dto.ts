import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
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

  @IsOptional()
  @IsString()
  openRouterModel?: string;

  @IsOptional()
  @IsString()
  deepSeekModel?: string;

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

  @IsOptional()
  @IsBoolean()
  autoScanEnabled?: boolean;

  @IsOptional()
  @IsString()
  autoScanCronExpression?: string;

  @IsOptional()
  @IsBoolean()
  autoTranslateNewItems?: boolean;

  @IsOptional()
  @IsString()
  telegramBotToken?: string;

  @IsOptional()
  @IsString()
  telegramChatId?: string;

  @IsOptional()
  @IsBoolean()
  telegramEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  telegramEvents?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  dailyTokenLimitFree?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  dailyTokenLimitPaid?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyBudgetUsd?: number;

  @IsOptional()
  @IsString()
  jellyfinUrl?: string;

  @IsOptional()
  @IsString()
  jellyfinApiKey?: string;
}
