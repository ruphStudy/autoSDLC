import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AcceptSprintDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'notes must be at most 2000 characters' })
  notes?: string;
}

export class RejectSprintDto {
  @IsString()
  @MaxLength(2000, { message: 'reason must be at most 2000 characters' })
  reason!: string;
}
