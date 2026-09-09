import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AgentJob, AgentJobStatus, JobType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ApprovalService } from '../approval/approval.service';
import { ApprovalError } from '../approval/errors/approval.error';
import { mapApprovalErrorToHttpException } from '../approval/errors/approval-error.mapper';
import { WorkspaceService } from '../workspace/workspace.service';
import { GitService } from '../workspace/git/git.service';
import { GitError } from '../workspace/errors/git.error';
import { mapGitErrorToHttpException } from '../workspace/errors/workspace-error.mapper';
import { JobService } from '../jobs/job.service';
import { JobExecutionContext, JobRecord } from '../jobs/types/job.types';
import {
  CODING_AGENT_PROVIDER,
  CODING_AGENT_DIAGNOSTIC_INSTRUCTION,
} from './coding-agent.constants';
import { CodingAgentProvider } from './contracts/coding-agent-provider.interface';
import { CodingAgentHealth } from './contracts/coding-agent-result';
import {
  CodingAgentError,
  CodingAgentErrorCode,
} from './errors/coding-agent.error';
import { mapCodingAgentErrorToHttpException } from './errors/coding-agent-error.mapper';
import { AgentJobRecord } from './types/agent-job.types';

function toRecord(job: AgentJob): AgentJobRecord {
  return {
    id: job.id,
    projectId: job.projectId,
    taskId: job.taskId,
    provider: job.provider,
    model: job.model,
    status: job.status,
    instruction: job.instruction,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    durationMs: job.durationMs,
    summary: job.summary,
    changedFiles: job.changedFiles as unknown as AgentJobRecord['changedFiles'],
    toolActivities:
      job.toolActivities as unknown as AgentJobRecord['toolActivities'],
    commandActivities:
      job.commandActivities as unknown as AgentJobRecord['commandActivities'],
    inputTokens: job.inputTokens,
    outputTokens: job.outputTokens,
    cacheReadInputTokens: job.cacheReadInputTokens,
    cacheCreationInputTokens: job.cacheCreationInputTokens,
    turns: job.turns,
    providerRequestId: job.providerRequestId,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

// Orchestrates coding-agent execution attempts. Never talks to the Claude
// Agent SDK directly — only through the provider-neutral
// CodingAgentProvider contract, injected via the CODING_AGENT_PROVIDER DI
// token (see coding-agent.module.ts).
@Injectable()
export class CodingAgentService {
  private readonly logger = new Logger(CodingAgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly approvalService: ApprovalService,
    private readonly workspaceService: WorkspaceService,
    private readonly git: GitService,
    private readonly jobService: JobService,
    @Inject(CODING_AGENT_PROVIDER)
    private readonly provider: CodingAgentProvider,
  ) {}

  healthCheck(): Promise<CodingAgentHealth> {
    return this.provider.healthCheck();
  }

  // ---- diagnostic (Sprint 10's only real entry point) -------------------

  // Fixed, backend-generated instruction only (item 51/91) — never accepts
  // an instruction from the caller. Requires an approved, READY, clean
  // workspace on its development branch; never requires Project status
  // DEVELOPING (item 58 — this is infrastructure testing, not real task
  // execution).
  async runDiagnostic(
    userId: string,
    projectId: string,
  ): Promise<{ agentJob: AgentJobRecord; job: JobRecord }> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    if (project.archivedAt) {
      throw new ConflictException(
        'Cannot run the coding agent for an archived project. Restore the project first.',
      );
    }

    try {
      await this.approvalService.assertDevelopmentApproved(project.id);
    } catch (error) {
      if (error instanceof ApprovalError) {
        throw mapApprovalErrorToHttpException(error);
      }
      throw error;
    }

    try {
      await this.assertWorkspaceReadyCleanAndOnBranch(project.id);
    } catch (error) {
      if (error instanceof GitError) throw mapGitErrorToHttpException(error);
      if (error instanceof CodingAgentError) {
        throw mapCodingAgentErrorToHttpException(error);
      }
      throw error;
    }

    const agentJob = await this.prisma.agentJob.create({
      data: {
        projectId: project.id,
        provider: 'claude',
        status: AgentJobStatus.QUEUED,
        instruction: CODING_AGENT_DIAGNOSTIC_INSTRUCTION,
        maxAttempts: 1,
      },
    });

    try {
      const job = await this.jobService.enqueue({
        type: JobType.CODING_AGENT_EXECUTION,
        projectId: project.id,
        userId,
        payload: { agentJobId: agentJob.id },
        maxAttempts: 1,
      });
      const updated = await this.prisma.agentJob.update({
        where: { id: agentJob.id },
        data: { backgroundJobId: job.id },
      });
      return { agentJob: toRecord(updated), job };
    } catch (error) {
      // Never strand an AgentJob row with no backing execution.
      await this.prisma.agentJob.delete({ where: { id: agentJob.id } });
      throw error;
    }
  }

  // ---- called by CodingAgentExecutionJobHandler --------------------------

  async execute(
    agentJobId: string,
    context: JobExecutionContext,
  ): Promise<AgentJobRecord> {
    const agentJob = await this.prisma.agentJob.findUniqueOrThrow({
      where: { id: agentJobId },
    });

    const startedAt = new Date();
    await this.prisma.agentJob.update({
      where: { id: agentJobId },
      data: {
        status: AgentJobStatus.RUNNING,
        attemptCount: { increment: 1 },
        startedAt,
      },
    });

    const abortController = new AbortController();
    const cancellationPoll = setInterval(() => {
      context.isCancellationRequested().then((cancelled) => {
        if (cancelled) abortController.abort();
      });
    }, 2000);

    try {
      const workspacePath = await this.assertWorkspaceReadyCleanAndOnBranch(
        agentJob.projectId,
      );

      const result = await this.provider.executeTask({
        projectId: agentJob.projectId,
        taskId: agentJob.taskId ?? undefined,
        instruction: agentJob.instruction,
        workspacePath,
        signal: abortController.signal,
      });

      const durationMs = Date.now() - startedAt.getTime();
      const status =
        result.status === 'SUCCEEDED'
          ? AgentJobStatus.SUCCEEDED
          : result.status === 'CANCELLED'
            ? AgentJobStatus.CANCELLED
            : AgentJobStatus.FAILED;

      const updated = await this.prisma.agentJob.update({
        where: { id: agentJobId },
        data: {
          status,
          completedAt: new Date(),
          durationMs,
          summary: result.summary,
          changedFiles: result.changedFiles as object[],
          toolActivities: result.toolActivities as object[],
          commandActivities: result.commandActivities as object[],
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          cacheReadInputTokens: result.usage?.cacheReadInputTokens,
          cacheCreationInputTokens: result.usage?.cacheCreationInputTokens,
          turns: result.metadata.turns,
          model: result.metadata.model,
          providerRequestId: result.metadata.providerRequestId,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
        },
      });

      this.logger.log(
        `Coding agent execution ${result.status.toLowerCase()} (agentJobId=${agentJobId}, provider=claude, durationMs=${durationMs}, changedFiles=${result.changedFiles.length}, turns=${result.metadata.turns ?? 'n/a'})`,
      );

      return toRecord(updated);
    } catch (error) {
      const normalized =
        error instanceof CodingAgentError
          ? error
          : error instanceof GitError
            ? new CodingAgentError({
                code: CodingAgentErrorCode.WORKSPACE_NOT_READY,
                message: error.message,
                cause: error,
              })
            : new CodingAgentError({
                code: CodingAgentErrorCode.UNKNOWN_PROVIDER_ERROR,
                message: 'The coding agent provider failed unexpectedly.',
                cause: error,
              });

      await this.prisma.agentJob.update({
        where: { id: agentJobId },
        data: {
          status: AgentJobStatus.FAILED,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          errorCode: normalized.code,
          errorMessage: normalized.message,
        },
      });
      this.logger.warn(
        `Coding agent execution failed before any workspace interaction (agentJobId=${agentJobId}, code=${normalized.code})`,
      );
      throw normalized;
    } finally {
      clearInterval(cancellationPoll);
    }
  }

  // ---- reads -------------------------------------------------------------

  async list(
    userId: string,
    projectId: string,
    limit = 20,
  ): Promise<AgentJobRecord[]> {
    await this.projectsService.findOneForUser(userId, projectId);
    const jobs = await this.prisma.agentJob.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return jobs.map(toRecord);
  }

  async getById(
    userId: string,
    projectId: string,
    agentJobId: string,
  ): Promise<AgentJobRecord> {
    await this.projectsService.findOneForUser(userId, projectId);
    const job = await this.prisma.agentJob.findFirst({
      where: { id: agentJobId, projectId },
    });
    if (!job) {
      throw new NotFoundException('Agent job not found.');
    }
    return toRecord(job);
  }

  // ---- internals -----------------------------------------------------

  // Returns the resolved workspace path once every Sprint 10 precondition
  // (READY, clean, on the development branch) is satisfied — throws the raw
  // domain error (GitError or CodingAgentError) otherwise, never an
  // HttpException, since this is called from both an HTTP-facing path
  // (runDiagnostic, which maps it) and a background-job path (execute,
  // which must not throw an HttpException from inside a job handler). Run
  // at both enqueue time and execution time (a job can sit queued long
  // enough for the workspace to change), same defense-in-depth pattern as
  // assertDevelopmentApproved.
  private async assertWorkspaceReadyCleanAndOnBranch(
    projectId: string,
  ): Promise<string> {
    const workspacePath =
      await this.workspaceService.getReadyWorkspacePath(projectId);

    const workspace = await this.prisma.projectWorkspace.findUnique({
      where: { projectId },
    });
    const currentBranch = await this.git.getCurrentBranch(workspacePath);
    if (
      workspace?.developmentBranch &&
      currentBranch !== workspace.developmentBranch
    ) {
      throw new CodingAgentError({
        code: CodingAgentErrorCode.WORKSPACE_NOT_READY,
        message: `Workspace is on branch "${currentBranch ?? 'unknown'}", expected "${workspace.developmentBranch}".`,
      });
    }

    const status = await this.git.getStatus(workspacePath);
    if (!status.clean) {
      throw new CodingAgentError({
        code: CodingAgentErrorCode.WORKSPACE_DIRTY,
        message:
          'The workspace has uncommitted changes. Coding-agent execution requires a clean workspace so changes can be reliably attributed.',
      });
    }

    return workspacePath;
  }
}
