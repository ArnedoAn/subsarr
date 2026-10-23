import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class LibraryQueryDto {
  @IsOptional() @IsIn(['true', 'false']) includeRules?: string;
  @IsOptional() @IsIn(['name', 'size', 'date', 'tracks']) sort?:
    | 'name'
    | 'size'
    | 'date'
    | 'tracks';
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
  @IsOptional() @IsString() q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @IsString() folder?: string;
  @IsOptional() @IsString() group?: string;
  @IsOptional() @IsIn(['movie', 'episode', 'unknown']) type?:
    | 'movie'
    | 'episode'
    | 'unknown';
  @IsOptional() @IsString() targetLanguage?: string;
  @IsOptional() @IsIn(['true', 'false']) missingTarget?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(99) season?: number;
  @IsOptional() @IsIn(['eligible', 'skipped', 'failed']) status?:
    | 'eligible'
    | 'skipped'
    | 'failed';
}
