import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SafeUser } from '../auth/types/auth.types';
import { SprintExecutionService } from './sprint-execution.service';
import {
  RunSprintResult,
  SprintExecutionEligibilityResult,
  SprintExecutionRecord,
} from './types/sprint-execution-record.types';

// No route here ever accepts a Task, instruction, provider, or command from
// the client (item 139) — "run" takes only the Sprint identity already in
// the URL; the orchestrator decides everything else deterministically.
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId')
export class SprintExecutionController {
  constructor(
    private readonly sprintExecutionService: SprintExecutionService,
  ) {}

  @Post('sprints/:sprintId/run')
  @HttpCode(HttpStatus.ACCEPTED)
  run(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('sprintId') sprintId: string,
  ): Promise<RunSprintResult> {
    return this.sprintExecutionService.run(user.id, projectId, sprintId);
  }

  @Post('sprints/:sprintId/pause')
  @HttpCode(HttpStatus.OK)
  pause(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('sprintId') sprintId: string,
  ): Promise<SprintExecutionRecord> {
    return this.sprintExecutionService.pause(user.id, projectId, sprintId);
  }

  @Post('sprints/:sprintId/resume')
  @HttpCode(HttpStatus.ACCEPTED)
  resume(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('sprintId') sprintId: string,
  ): Promise<RunSprintResult> {
    return this.sprintExecutionService.resume(user.id, projectId, sprintId);
  }

  @Get('sprints/:sprintId/execution-eligibility')
  getEligibility(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('sprintId') sprintId: string,
  ): Promise<SprintExecutionEligibilityResult> {
    return this.sprintExecutionService.getEligibility(
      user.id,
      projectId,
      sprintId,
    );
  }

  @Get('sprints/:sprintId/executions')
  listExecutions(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('sprintId') sprintId: string,
  ): Promise<SprintExecutionRecord[]> {
    return this.sprintExecutionService.listExecutions(
      user.id,
      projectId,
      sprintId,
    );
  }

  @Get('sprints/:sprintId/execution')
  getCurrentExecution(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('sprintId') sprintId: string,
  ): Promise<SprintExecutionRecord> {
    return this.sprintExecutionService.getCurrentExecution(
      user.id,
      projectId,
      sprintId,
    );
  }

  @Get('sprint-executions/:executionId')
  getExecution(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('executionId') executionId: string,
  ): Promise<SprintExecutionRecord> {
    return this.sprintExecutionService.getExecution(
      user.id,
      projectId,
      executionId,
    );
  }
}
