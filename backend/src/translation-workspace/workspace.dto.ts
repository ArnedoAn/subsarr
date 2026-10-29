import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { TranslationProvider } from '../contracts/providers';

export class WorkspaceCreateDto {
  @IsString() @MaxLength(32) sourceLanguage = 'auto';
  @IsString() @MaxLength(32) targetLanguage = 'spa';
  @IsOptional()
  @IsIn(['openrouter', 'deepseek', 'opencode-go'])
  provider?: TranslationProvider;
  @IsOptional() @IsString() @MaxLength(128) model?: string;
  @IsOptional() @IsString() @MaxLength(12000) contextHint?: string;
}
export class WorkspacePageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit = 100;
}
export class WorkspaceRevisionDto {
  @IsInt() @Min(1) expectedRevision!: number;
}
export class WorkspaceCueEditDto {
  @IsInt() @Min(0) cueIndex!: number;
  @IsString() @MaxLength(32000) text!: string;
}
export class WorkspaceEditDto extends WorkspaceRevisionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => WorkspaceCueEditDto)
  edits!: WorkspaceCueEditDto[];
}
export class WorkspaceContextDto extends WorkspaceRevisionDto {
  @IsString() @MaxLength(12000) contextSheet!: string;
}
export class WorkspaceRetranslateDto extends WorkspaceRevisionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  @Min(0, { each: true })
  cueIndices!: number[];
  @IsOptional()
  @IsIn(['openrouter', 'deepseek', 'opencode-go'])
  provider?: TranslationProvider;
  @IsOptional() @IsString() @MaxLength(128) model?: string;
  @IsOptional() @IsBoolean() allowBudgetOverride?: boolean;
}
export class WorkspaceApproveDto extends WorkspaceRevisionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @IsInt({ each: true })
  @Min(0, { each: true })
  cueIndices!: number[];
  @Equals(true) approved!: true;
}
export class WorkspaceLibraryDto {
  @IsString() @MaxLength(4096) subtitlePath!: string;
  @IsOptional() @IsInt() @Min(0) sourceTrackIndex?: number;
  @IsOptional() @IsString() @MaxLength(32) sourceLanguage?: string;
  @IsOptional() @IsString() @MaxLength(32) targetLanguage?: string;
}
export class WorkspaceSaveDto extends WorkspaceRevisionDto {
  @IsOptional() @IsBoolean() overwrite?: boolean;
}
export class MemoryApproveDto {
  @IsString() @MaxLength(32000) source!: string;
  @IsString() @MaxLength(32000) target!: string;
  @IsString() @MaxLength(32) sourceLanguage!: string;
  @IsString() @MaxLength(32) targetLanguage!: string;
  @IsString() @MaxLength(64) contextHash!: string;
  @IsString() @MaxLength(64) signature!: string;
  @Equals(true) approved!: true;
  @IsOptional() @IsString() @MaxLength(128) model?: string;
  @IsOptional() @IsString() @MaxLength(256) provenance?: string;
}
