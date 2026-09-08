import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApprovalStage } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SafeUser } from '../auth/types/auth.types';
import { ApprovalService } from './approval.service';
import { DecideApprovalDto } from './dto/decide-approval.dto';
import {
  ApprovalRecord,
  ApprovalStatus,
  ApprovalSummary,
} from './types/approval.types';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/approvals')
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Get()
  getHistory(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Query('stage', new ParseEnumPipe(ApprovalStage, { optional: true }))
    stage?: ApprovalStage,
  ): Promise<ApprovalRecord[]> {
    return this.approvalService.getHistory(user.id, projectId, stage);
  }

  @Get('summary')
  getSummary(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<ApprovalSummary> {
    return this.approvalService.getSummary(user.id, projectId);
  }

  @Get(':stage')
  getCurrentStatus(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('stage', new ParseEnumPipe(ApprovalStage)) stage: ApprovalStage,
  ): Promise<ApprovalStatus> {
    return this.approvalService.getCurrentStatus(user.id, projectId, stage);
  }

  @Post(':stage')
  @HttpCode(HttpStatus.OK)
  decide(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('stage', new ParseEnumPipe(ApprovalStage)) stage: ApprovalStage,
    @Body() dto: DecideApprovalDto,
  ): Promise<ApprovalRecord> {
    return this.approvalService.decide(user.id, projectId, stage, dto);
  }
}
