import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class QuickTranslateDto {
  @IsString() @Matches(/^[a-zA-Z0-9_-]{16,100}$/) requestId!: string;
  @IsString() @MaxLength(35) targetLanguage!: string;
  @IsOptional() @IsString() @MaxLength(35) sourceLanguage?: string;
  @IsOptional() @IsIn(['deepseek', 'openrouter']) provider?:
    | 'deepseek'
    | 'openrouter';
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
