import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type {
  SubtitleSyncConflictResolution,
  SubtitleSyncReferenceMode,
} from './subtitle-sync.types';

/** Multipart fields; the subtitle comes either as `file` or as an existing `sidecarPath`. */
export class StartSubtitleSyncDto {
  @IsString() @MaxLength(512) mediaItemId!: string;
  @IsOptional() @IsString() @MaxLength(4096) sidecarPath?: string;
  @IsOptional() @IsString() @MaxLength(35) language?: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  forced?: boolean;
  @IsOptional()
  @IsIn(['auto', 'audio', 'track'])
  reference?: SubtitleSyncReferenceMode;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(65535)
  referenceTrackIndex?: number;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  allowSplits?: boolean;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(900)
  maxOffsetSeconds?: number;
  @IsOptional()
  @IsIn(['fail', 'replace', 'alternate'])
  conflict?: SubtitleSyncConflictResolution;
}

export class ListSubtitleSyncDto {
  @IsOptional() @IsString() @MaxLength(512) mediaItemId?: string;
}
