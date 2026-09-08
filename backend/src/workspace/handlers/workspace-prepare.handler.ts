import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobType } from '@prisma/client';
import { ApprovalService } from '../../approval/approval.service';
import { JobHandlerRegistry } from '../../jobs/job-handler.registry';
import { JobExecutionError } from '../../jobs/errors/job.error';
import {
  JobExecutionContext,
  JobHandler,
  JobHandlerResult,
} from '../../jobs/types/job.types';
import { WorkspaceService } from '../workspace.service';
import { GitError } from '../errors/git.error';
import { WorkspaceRecord } from '../types/workspace.types';

export type WorkspacePrepareJobPayload = Record<string, never>;

// Self-registers into JobHandlerRegistry rather than being added to
// JobsModule's JOB_HANDLERS provider array — WorkspaceModule imports
// JobsModule (for JobService + this registry), so the reverse dependency
// would create a circular module graph. See job-handler.registry.ts.
@Injectable()
export class WorkspacePrepareJobHandler
  implements
    JobHandler<WorkspacePrepareJobPayload, WorkspaceRecord>,
    OnModuleInit
{
  readonly type = JobType.WORKSPACE_PREPARE;

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly approvalService: ApprovalService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async execute(
    context: JobExecutionContext<WorkspacePrepareJobPayload>,
  ): Promise<JobHandlerResult<WorkspaceRecord>> {
    const projectId = context.projectId;
    if (!projectId) {
      throw new JobExecutionError(
        'workspace_prepare_missing_project',
        'WORKSPACE_PREPARE requires a project.',
        false,
      );
    }

    await context.reportProgress(1, 'Verifying development approval...');
    // Defense in depth: WorkspaceService.prepare already asserted this at
    // enqueue time, but approval state could have changed while this job sat
    // in the queue — the handler must never trust a decision made in the past.
    try {
      await this.approvalService.assertDevelopmentApproved(projectId);
    } catch {
      throw new JobExecutionError(
        'workspace_prepare_not_approved',
        'Development approval is no longer valid for this project.',
        false,
      );
    }

    await this.workspaceService.markPreparing(projectId);

    try {
      const record = await this.workspaceService.runPreparation(
        projectId,
        context,
      );
      return { result: record };
    } catch (error) {
      if (error instanceof GitError) {
        throw new JobExecutionError(error.code, error.message, error.retryable);
      }
      throw error;
    }
  }
}
