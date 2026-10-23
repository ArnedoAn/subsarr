import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  Max,
  ArrayMaxSize,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RuleToggleDto } from './rule-toggle.dto';
import { SECRET_FIELDS, type SecretField } from '../secret-store';

export class UpdateSettingsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsIn(SECRET_FIELDS, { each: true })
  clearSecrets?: SecretField[];

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @ArrayMaxSize(32)
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
  @Max(10080)
  scanCacheTtlMinutes!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(16)
  concurrency!: number;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(200)
  pathContainsExclusions!: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fileTooLargeBytes?: number | null;

  @IsBoolean()
  translationVerificationEnabled!: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMaxSize(32)
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
  dailyTokenLimitFree?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  dailyTokenLimitPaid?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyBudgetUsd?: number | null;

  @IsOptional()
  @IsString()
  jellyfinUrl?: string;

  @IsOptional()
  @IsString()
  jellyfinApiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  tmdbApiKey?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  deepSeekInputCacheHitUsdPerMillion?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  deepSeekInputCacheMissUsdPerMillion?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  deepSeekOutputUsdPerMillion?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  pricingUpdatedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  pricingSource?: string;
}
