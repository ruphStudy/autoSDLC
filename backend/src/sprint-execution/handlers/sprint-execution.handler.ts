import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobType } from '@prisma/client';
import { JobHandlerRegistry } from '../../jobs/job-handler.registry';
import { JobExecutionError } from '../../jobs/errors/job.error';
import {
  JobExecutionContext,
  JobHandler,
  JobHandlerResult,
} from '../../jobs/types/job.types';
import { SprintExecutionService } from '../sprint-execution.service';
import { SprintExecutionRecord } from '../types/sprint-execution-record.types';

export interface SprintExecutionJobPayload {
  sprintExecutionId: string;
}

// Self-registers into JobHandlerRegistry rather than being added to
// JobsModule's JOB_HANDLERS provider array — SprintExecutionModule imports
// JobsModule (for JobService + this registry), so the reverse dependency
// would create a circular module graph. Same pattern as Sprint 9/10/12/13's
// job handlers.
@Injectable()
export class SprintExecutionJobHandler
  implements
    JobHandler<SprintExecutionJobPayload, SprintExecutionRecord>,
    OnModuleInit
{
  readonly type = JobType.SPRINT_EXECUTION;

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly sprintExecutionService: SprintExecutionService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async execute(
    context: JobExecutionContext<SprintExecutionJobPayload>,
  ): Promise<JobHandlerResult<SprintExecutionRecord>> {
    const { sprintExecutionId } = context.payload ?? {};
    if (!sprintExecutionId) {
      throw new JobExecutionError(
        'sprint_execution_missing_context',
        'SPRINT_EXECUTION requires a sprintExecutionId.',
        false,
      );
    }

    await context.reportProgress(1, 'Starting Sprint execution...');
    // SprintExecutionService.execute never throws — every outcome
    // (COMPLETED, FAILED, BLOCKED, PAUSED, CANCELLED) is persisted and
    // returned. A non-COMPLETED SprintExecution is still a completed job
    // execution attempt from the queue's point of view (same precedent as
    // Sprint 10/12/13).
    const record = await this.sprintExecutionService.execute(
      sprintExecutionId,
      context,
    );
    await context.reportProgress(
      100,
      `Sprint execution ${record.status.toLowerCase()}.`,
    );
    return { result: record };
  }
}
