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
import { TaskExecutionService } from './task-execution.service';
import {
  RunTaskResult,
  TaskEligibilityResult,
  TaskExecutionRecord,
} from './types/task-execution.types';

// No route here accepts an instruction, workspace path, provider, model, or
// agent constraint from the client (item 40) — "run" takes only the ids
// already in the URL. There is deliberately no Validate/Commit/"Run Sprint"
// endpoint anywhere in this controller (Sprint 12 is single-Task only).
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId')
export class TaskExecutionController {
  constructor(private readonly taskExecutionService: TaskExecutionService) {}

  @Post('tasks/:taskId/run')
  @HttpCode(HttpStatus.ACCEPTED)
  run(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ): Promise<RunTaskResult> {
    return this.taskExecutionService.run(user.id, projectId, taskId);
  }

  @Get('tasks/:taskId/execution-eligibility')
  getEligibility(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ): Promise<TaskEligibilityResult> {
    return this.taskExecutionService.getEligibility(user.id, projectId, taskId);
  }

  @Get('tasks/:taskId/executions')
  listExecutions(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ): Promise<TaskExecutionRecord[]> {
    return this.taskExecutionService.listExecutions(user.id, projectId, taskId);
  }

  @Get('tasks/:taskId/execution/current')
  getCurrentExecution(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ): Promise<TaskExecutionRecord> {
    return this.taskExecutionService.getCurrentExecution(
      user.id,
      projectId,
      taskId,
    );
  }

  @Get('task-executions/:executionId')
  getExecution(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('executionId') executionId: string,
  ): Promise<TaskExecutionRecord> {
    return this.taskExecutionService.getExecution(
      user.id,
      projectId,
      executionId,
    );
  }
}
