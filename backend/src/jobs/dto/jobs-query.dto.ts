import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class JobsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  q?: string;
  @IsOptional()
  @IsString()
  @MaxLength(200)
  mediaItemId?: string;
  @IsOptional()
  @Matches(
    /^(waiting|paused|delayed|active|cancelling|cancelled|completed|failed)(,(waiting|paused|delayed|active|cancelling|cancelled|completed|failed))*$/,
  )
  state?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
