import { IsString, IsArray, ValidateNested, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class RenameOperationDto {
  @IsString()
  @IsNotEmpty()
  originalPath!: string;

  @IsString()
  @IsNotEmpty()
  newPath!: string;
}

export class ExecuteRenameDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RenameOperationDto)
  operations!: RenameOperationDto[];
}
