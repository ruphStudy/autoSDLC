import { Inject, Injectable } from '@nestjs/common';
import { JobType } from '@prisma/client';
import { JOB_HANDLERS } from './jobs.constants';
import { JobHandler } from './types/job.types';

// JobType -> JobHandler lookup. Future sprints register new handlers by
// adding them to the JOB_HANDLERS provider array in JobsModule — nothing
// else in the worker changes.
@Injectable()
export class JobHandlerRegistry {
  private readonly handlers = new Map<JobType, JobHandler>();

  constructor(@Inject(JOB_HANDLERS) handlers: JobHandler[]) {
    for (const handler of handlers) {
      this.handlers.set(handler.type, handler);
    }
  }

  resolve(type: JobType): JobHandler | undefined {
    return this.handlers.get(type);
  }
}
