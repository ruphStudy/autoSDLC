import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobType } from '@prisma/client';
import { JobHandlerRegistry } from '../../jobs/job-handler.registry';
import { JobExecutionError } from '../../jobs/errors/job.error';
import {
  JobExecutionContext,
  JobHandler,
  JobHandlerResult,
} from '../../jobs/types/job.types';
import { TaskExecutionService } from '../task-execution.service';
import { TaskExecutionRecord } from '../types/task-execution.types';

export interface TaskExecutionJobPayload {
  taskExecutionId: string;
  taskId: string;
  projectId: string;
}

// Self-registers into JobHandlerRegistry rather than being added to
// JobsModule's JOB_HANDLERS provider array — TaskExecutionModule imports
// JobsModule (for JobService + this registry), so the reverse dependency
// would create a circular module graph. Same pattern as
// WorkspacePrepareJobHandler and CodingAgentExecutionJobHandler.
@Injectable()
export class TaskExecutionJobHandler
  implements
    JobHandler<TaskExecutionJobPayload, TaskExecutionRecord>,
    OnModuleInit
{
  readonly type = JobType.TASK_EXECUTION;

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly taskExecutionService: TaskExecutionService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async execute(
    context: JobExecutionContext<TaskExecutionJobPayload>,
  ): Promise<JobHandlerResult<TaskExecutionRecord>> {
    const { taskExecutionId, taskId, projectId } = context.payload ?? {};
    if (!taskExecutionId || !taskId || !projectId) {
      throw new JobExecutionError(
        'task_execution_missing_context',
        'TASK_EXECUTION requires a taskExecutionId, taskId, and projectId.',
        false,
      );
    }

    await context.reportProgress(1, 'Verifying Task execution eligibility...');
    // TaskExecutionService.execute never throws — it always persists and
    // returns a TaskExecutionRecord, even for a pre-agent failure. A
    // FAILED/CANCELLED TaskExecution is still a completed job execution
    // attempt from the queue's point of view (same precedent as
    // CodingAgentExecutionJobHandler for AgentJob).
    const record = await this.taskExecutionService.execute(
      taskExecutionId,
      context,
    );
    await context.reportProgress(
      100,
      `Task execution ${record.status.toLowerCase()}.`,
    );
    return { result: record };
  }
}
