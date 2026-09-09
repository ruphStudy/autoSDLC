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
import { CodingAgentService } from '../coding-agent.service';
import { CodingAgentError } from '../errors/coding-agent.error';
import { AgentJobRecord } from '../types/agent-job.types';

export interface CodingAgentExecutionJobPayload {
  agentJobId: string;
}

// Self-registers into JobHandlerRegistry rather than being added to
// JobsModule's JOB_HANDLERS provider array — CodingAgentModule imports
// JobsModule (for JobService + this registry), so the reverse dependency
// would create a circular module graph. Same pattern as
// WorkspacePrepareJobHandler (Sprint 9).
@Injectable()
export class CodingAgentExecutionJobHandler
  implements
    JobHandler<CodingAgentExecutionJobPayload, AgentJobRecord>,
    OnModuleInit
{
  readonly type = JobType.CODING_AGENT_EXECUTION;

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly approvalService: ApprovalService,
    private readonly codingAgentService: CodingAgentService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async execute(
    context: JobExecutionContext<CodingAgentExecutionJobPayload>,
  ): Promise<JobHandlerResult<AgentJobRecord>> {
    const projectId = context.projectId;
    const agentJobId = context.payload?.agentJobId;
    if (!projectId || !agentJobId) {
      throw new JobExecutionError(
        'coding_agent_execution_missing_context',
        'CODING_AGENT_EXECUTION requires a project and an agentJobId.',
        false,
      );
    }

    await context.reportProgress(1, 'Verifying development approval...');
    // Defense in depth: CodingAgentService.runDiagnostic already asserted
    // this at enqueue time, but approval state could have changed while
    // this job sat in the queue.
    try {
      await this.approvalService.assertDevelopmentApproved(projectId);
    } catch {
      throw new JobExecutionError(
        'coding_agent_execution_not_approved',
        'Development approval is no longer valid for this project.',
        false,
      );
    }

    await context.reportProgress(5, 'Starting coding agent execution...');

    try {
      const record = await this.codingAgentService.execute(agentJobId, context);
      await context.reportProgress(
        100,
        `Coding agent execution ${record.status.toLowerCase()}.`,
      );
      // Coding execution is stateful — never retryable at the generic job
      // layer (item 44/93). A FAILED/CANCELLED AgentJob is still a
      // completed job execution attempt from the queue's point of view.
      return { result: record };
    } catch (error) {
      if (error instanceof CodingAgentError) {
        // Never retryable: the workspace may already have been modified
        // before this failure occurred (item 44).
        throw new JobExecutionError(error.code, error.message, false);
      }
      throw error;
    }
  }
}
