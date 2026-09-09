import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobType } from '@prisma/client';
import { JobHandlerRegistry } from '../../jobs/job-handler.registry';
import { JobExecutionError } from '../../jobs/errors/job.error';
import {
  JobExecutionContext,
  JobHandler,
  JobHandlerResult,
} from '../../jobs/types/job.types';
import { TaskValidationService } from '../task-validation.service';
import { ValidationAttemptRecord } from '../types/validation-record.types';

export interface TaskValidationJobPayload {
  validationAttemptId: string;
  taskId: string;
  projectId: string;
}

// Self-registers into JobHandlerRegistry rather than being added to
// JobsModule's JOB_HANDLERS provider array — TaskValidationModule imports
// JobsModule (for JobService + this registry), so the reverse dependency
// would create a circular module graph. Same pattern as Sprint 9/10/12's
// job handlers.
@Injectable()
export class TaskValidationJobHandler
  implements
    JobHandler<TaskValidationJobPayload, ValidationAttemptRecord>,
    OnModuleInit
{
  readonly type = JobType.TASK_VALIDATION;

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly taskValidationService: TaskValidationService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async execute(
    context: JobExecutionContext<TaskValidationJobPayload>,
  ): Promise<JobHandlerResult<ValidationAttemptRecord>> {
    const { validationAttemptId, taskId, projectId } = context.payload ?? {};
    if (!validationAttemptId || !taskId || !projectId) {
      throw new JobExecutionError(
        'task_validation_missing_context',
        'TASK_VALIDATION requires a validationAttemptId, taskId, and projectId.',
        false,
      );
    }

    await context.reportProgress(1, 'Verifying validation eligibility...');
    // TaskValidationService.execute never throws — every outcome (pass,
    // fail, cancellation) is persisted and returned. A FAILED/CANCELLED
    // ValidationAttempt is still a completed job execution attempt from
    // the queue's point of view (same precedent as Sprint 10/12).
    const record = await this.taskValidationService.execute(
      validationAttemptId,
      context,
    );
    await context.reportProgress(
      100,
      `Validation ${record.status.toLowerCase()}.`,
    );
    return { result: record };
  }
}
