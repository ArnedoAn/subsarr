import { IsBoolean, IsString } from 'class-validator';

export class RuleToggleDto {
  @IsString()
  id!: string;

  @IsBoolean()
  enabled!: boolean;
}
