import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { RenameKind } from '../rename.types';
export class RenameTemplatesDto {
  @IsString() @MaxLength(240) movie: string;
  @IsString() @MaxLength(240) series: string;
  @IsString() @MaxLength(240) anime: string;
}
export class CreateRenamePlanDto {
  @IsString() @IsNotEmpty() @MaxLength(4096) directory: string;
  @IsOptional() @IsBoolean() seasonFolders?: boolean;
  @IsOptional()
  @ValidateNested()
  @Type(() => RenameTemplatesDto)
  templates?: RenameTemplatesDto;
}
export class RenameClassificationDto {
  @IsIn(['movie', 'episode', 'anime', 'unknown']) kind: RenameKind;
  @IsString() @IsNotEmpty() @MaxLength(180) title: string;
  @IsOptional() @IsInt() @Min(1800) @Max(2200) year?: number;
  @IsOptional() @IsInt() @Min(0) @Max(99) season?: number;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(999, { each: true })
  episodes?: number[];
  @IsOptional() @IsInt() @Min(0) @Max(9999) absolute?: number;
  @IsOptional() @IsIn(['high', 'medium', 'low', 'manual']) confidence:
    | 'high'
    | 'medium'
    | 'low'
    | 'manual' = 'manual';
}
export class RenameEditDto {
  @IsUUID() id: string;
  @IsOptional() @IsString() @MaxLength(240) filename?: string;
  @IsOptional() @IsBoolean() selected?: boolean;
  @IsOptional()
  @ValidateNested()
  @Type(() => RenameClassificationDto)
  classification?: RenameClassificationDto;
}
export class ReviseRenamePlanDto {
  @IsUUID() planId: string;
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => RenameEditDto)
  edits: RenameEditDto[];
  @IsOptional()
  @ValidateNested()
  @Type(() => RenameTemplatesDto)
  templates?: RenameTemplatesDto;
}
export class ExecuteRenameDto {
  @IsUUID() planId: string;
}
export class SelectRenameMetadataDto {
  @IsUUID() planId: string;
  @IsUUID() rowId: string;
  @IsUUID() matchId: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => RenameEditDto)
  edits?: RenameEditDto[];
}
