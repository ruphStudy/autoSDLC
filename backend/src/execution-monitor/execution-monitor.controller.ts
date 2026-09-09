import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SafeUser } from '../auth/types/auth.types';
import { ExecutionMonitorService } from './execution-monitor.service';
import {
  ExecutionHistoryEntry,
  ProjectExecutionOverview,
  TimelinePage,
} from './types/execution-monitor.types';

// Read-only surface (item 122): every route here calls ExecutionMonitorService,
// which only ever reads SprintExecution/TaskExecution/AgentJob/
// ValidationAttempt/Job/Workspace/Git state — Pause/Resume/Cancel/Start
// remain exclusively on Sprint 14's SprintExecutionController.
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId')
export class ExecutionMonitorController {
  constructor(private readonly monitor: ExecutionMonitorService) {}

  @Get('execution-monitor')
  getOverview(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
  ): Promise<ProjectExecutionOverview> {
    return this.monitor.getOverview(user.id, projectId);
  }

  @Get('execution-history')
  getHistory(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('cursor') cursor?: string,
  ): Promise<{
    executions: ExecutionHistoryEntry[];
    nextCursor: string | null;
  }> {
    return this.monitor.getHistory(user.id, projectId, { limit, cursor });
  }

  @Get('execution-timeline')
  getTimeline(
    @CurrentUser() user: SafeUser,
    @Param('projectId') projectId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('cursor') cursor?: string,
  ): Promise<TimelinePage> {
    return this.monitor.getTimeline(user.id, projectId, { limit, cursor });
  }
}
