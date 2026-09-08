import { Injectable } from '@nestjs/common';
import { JobType } from '@prisma/client';
import { JobCancelledError, JobExecutionError } from '../errors/job.error';
import {
  JobExecutionContext,
  JobHandler,
  JobHandlerResult,
} from '../types/job.types';

export interface SystemTestJobPayload {
  steps?: number;
  failUntilAttempt?: number;
}

export interface SystemTestJobResult {
  steps: number;
  attemptCount: number;
}

// Deterministic, side-effect-free handler that only exists to prove the
// worker/registry/progress/retry/cancellation machinery end-to-end. No
// sleeps, no network, no AI — every step runs synchronously.
@Injectable()
export class SystemTestJobHandler implements JobHandler<
  SystemTestJobPayload,
  SystemTestJobResult
> {
  readonly type = JobType.SYSTEM_TEST;

  async execute(
    context: JobExecutionContext<SystemTestJobPayload>,
  ): Promise<JobHandlerResult<SystemTestJobResult>> {
    const steps = context.payload?.steps ?? 3;
    const failUntilAttempt = context.payload?.failUntilAttempt;

    for (let step = 1; step <= steps; step++) {
      if (await context.isCancellationRequested()) {
        throw new JobCancelledError();
      }
      await context.reportProgress(
        Math.round((step / steps) * 100),
        `Step ${step} of ${steps}`,
      );
    }

    if (failUntilAttempt && context.attemptCount < failUntilAttempt) {
      throw new JobExecutionError(
        'system_test_forced_failure',
        `Forced failure until attempt ${failUntilAttempt} (current attempt ${context.attemptCount}).`,
        true,
      );
    }

    return { result: { steps, attemptCount: context.attemptCount } };
  }
}
