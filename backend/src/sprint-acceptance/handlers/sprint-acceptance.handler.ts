import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobType } from '@prisma/client';
import { JobHandlerRegistry } from '../../jobs/job-handler.registry';
import { JobExecutionError } from '../../jobs/errors/job.error';
import {
  JobExecutionContext,
  JobHandler,
  JobHandlerResult,
} from '../../jobs/types/job.types';
import { SprintAcceptanceService } from '../sprint-acceptance.service';
import { SprintAcceptanceRecord } from '../types/sprint-acceptance.types';

export interface SprintAcceptanceJobPayload {
  sprintAcceptanceId: string;
}

// Self-registers into JobHandlerRegistry rather than being added to
// JobsModule's JOB_HANDLERS provider array — same reasoning as every other
// job handler since Sprint 9: SprintAcceptanceModule imports JobsModule (for
// JobService + this registry), so the reverse dependency would create a
// circular module graph.
@Injectable()
export class SprintAcceptanceJobHandler
  implements
    JobHandler<SprintAcceptanceJobPayload, SprintAcceptanceRecord>,
    OnModuleInit
{
  readonly type = JobType.SPRINT_ACCEPTANCE_REVIEW;

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly sprintAcceptanceService: SprintAcceptanceService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async execute(
    context: JobExecutionContext<SprintAcceptanceJobPayload>,
  ): Promise<JobHandlerResult<SprintAcceptanceRecord>> {
    const { sprintAcceptanceId } = context.payload ?? {};
    if (!sprintAcceptanceId) {
      throw new JobExecutionError(
        'sprint_acceptance_missing_context',
        'SPRINT_ACCEPTANCE_REVIEW requires a sprintAcceptanceId.',
        false,
      );
    }

    await context.reportProgress(1, 'Starting Sprint acceptance review...');
    const record = await this.sprintAcceptanceService.execute(
      sprintAcceptanceId,
      context,
    );
    await context.reportProgress(
      100,
      `Sprint acceptance review ${record.status.toLowerCase()}.`,
    );
    return { result: record };
  }
}
