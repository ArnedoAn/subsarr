import { IsBooleanString, IsIn, IsOptional, IsString } from 'class-validator';

export class LibraryQueryDto {
  @IsOptional()
  @IsBooleanString()
  includeRules?: string;

  @IsOptional()
  @IsIn(['name', 'size', 'date', 'tracks'])
  sort?: 'name' | 'size' | 'date' | 'tracks';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @IsOptional()
  @IsString()
  q?: string;
}
