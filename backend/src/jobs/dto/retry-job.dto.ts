import { IsBoolean, IsOptional } from 'class-validator';

export class RetryJobDto {
  @IsOptional()
  @IsBoolean()
  allowBudgetOverride?: boolean;
}
