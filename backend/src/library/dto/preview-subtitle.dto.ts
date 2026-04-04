import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class PreviewSubtitleDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sourceTrackIndex!: number;
}
