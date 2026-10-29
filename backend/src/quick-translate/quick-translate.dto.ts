import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import type { TranslationProvider } from '../contracts/providers';

export class QuickTranslateDto {
  @IsString() @Matches(/^[a-zA-Z0-9_-]{16,100}$/) requestId!: string;
  @IsString() @MaxLength(35) targetLanguage!: string;
  @IsOptional() @IsString() @MaxLength(35) sourceLanguage?: string;
  @IsOptional()
  @IsIn(['deepseek', 'openrouter', 'opencode-go'])
  provider?: TranslationProvider;
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._:/+@-]*$/)
  model?: string;
  @IsOptional() @IsIn(['fast', 'balanced', 'review']) qualityMode?:
    | 'fast'
    | 'balanced'
    | 'review';
  @IsOptional() @IsString() @MaxLength(12000) contextHint?: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  useTranslationMemory?: boolean;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  verificationEnabled?: boolean;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  allowBudgetOverride?: boolean;
}
export class QuickRetryDto {
  @IsOptional() @IsBoolean() allowBudgetOverride?: boolean;
}
