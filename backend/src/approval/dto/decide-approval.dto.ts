import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApprovalDecision } from '@prisma/client';

export class DecideApprovalDto {
  @IsEnum(ApprovalDecision)
  decision!: ApprovalDecision;

  @IsOptional()
  @IsString()
  @MaxLength(4000, { message: 'comment must be at most 4000 characters' })
  comment?: string;
}
