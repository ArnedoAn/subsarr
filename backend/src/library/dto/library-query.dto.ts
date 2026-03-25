import { IsBooleanString, IsOptional } from 'class-validator';

export class LibraryQueryDto {
  @IsOptional()
  @IsBooleanString()
  includeRules?: string;
}
