import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SafeUser } from '../auth/types/auth.types';
import { TaskInstructionService } from './task-instruction.service';
import { TaskInstructionRecord } from './types/task-instruction.types';

// No route here accepts a coding prompt/instruction from the client — every
// instruction is generated server-side against live repository state (see
// TaskInstructionService.generate). There is deliberately no manual-edit
// endpoint (item 57): to change implementation intent, edit the Task itself.
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/tasks/:taskId/instruction')
export class TaskInstructionController {
  constructor(
    private readonly taskInstructionService: TaskInstructionService,
  ) {}

  @Post('generate')
  generate(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ): Promise<TaskInstructionRecord> {
    return this.taskInstructionService.generate(user.id, projectId, taskId);
  }

  @Get()
  getCurrent(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ): Promise<TaskInstructionRecord> {
    return this.taskInstructionService.getCurrent(user.id, projectId, taskId);
  }

  @Get('versions')
  getHistory(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
  ): Promise<TaskInstructionRecord[]> {
    return this.taskInstructionService.getHistory(user.id, projectId, taskId);
  }

  @Get('versions/:version')
  getVersion(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<TaskInstructionRecord> {
    return this.taskInstructionService.getVersion(
      user.id,
      projectId,
      taskId,
      version,
    );
  }
}
