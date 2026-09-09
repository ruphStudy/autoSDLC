import { ConflictException, NotFoundException } from '@nestjs/common';
import { AgentJobStatus, JobType } from '@prisma/client';
import { CodingAgentService } from './coding-agent.service';
import { GitError, GitErrorCode } from '../workspace/errors/git.error';
import {
  CodingAgentError,
  CodingAgentErrorCode,
} from './errors/coding-agent.error';
import {
  ApprovalError,
  ApprovalErrorCode,
} from '../approval/errors/approval.error';
import { CODING_AGENT_DIAGNOSTIC_INSTRUCTION } from './coding-agent.constants';

function buildProject(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 'project-1', userId: 'user-1', archivedAt: null, ...overrides };
}

function buildAgentJob(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    id: 'agent-job-1',
    projectId: 'project-1',
    taskId: null,
    backgroundJobId: null,
    provider: 'claude',
    model: null,
    status: AgentJobStatus.QUEUED,
    instruction: CODING_AGENT_DIAGNOSTIC_INSTRUCTION,
    attemptCount: 0,
    maxAttempts: 1,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    summary: null,
    changedFiles: null,
    toolActivities: null,
    commandActivities: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadInputTokens: null,
    cacheCreationInputTokens: null,
    turns: null,
    providerRequestId: null,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('CodingAgentService', () => {
  let prisma: any;
  let projectsService: any;
  let approvalService: any;
  let workspaceService: any;
  let git: any;
  let jobService: any;
  let provider: any;
  let service: CodingAgentService;

  beforeEach(() => {
    prisma = {
      agentJob: {
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      projectWorkspace: { findUnique: jest.fn() },
    };
    projectsService = { findOneForUser: jest.fn() };
    approvalService = {
      assertDevelopmentApproved: jest.fn().mockResolvedValue(undefined),
    };
    workspaceService = { getReadyWorkspacePath: jest.fn() };
    git = { getCurrentBranch: jest.fn(), getStatus: jest.fn() };
    jobService = { enqueue: jest.fn() };
    provider = { executeTask: jest.fn(), healthCheck: jest.fn() };

    service = new CodingAgentService(
      prisma,
      projectsService,
      approvalService,
      workspaceService,
      git,
      jobService,
      provider,
    );
  });

  describe('runDiagnostic', () => {
    it('rejects for an archived project before checking approval', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ archivedAt: new Date() }),
      );

      await expect(
        service.runDiagnostic('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(approvalService.assertDevelopmentApproved).not.toHaveBeenCalled();
    });

    it('maps a missing development approval to an HTTP exception before creating any AgentJob', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      approvalService.assertDevelopmentApproved.mockRejectedValue(
        new ApprovalError({
          code: ApprovalErrorCode.DEVELOPMENT_PREREQUISITES_MISSING,
          message: 'not approved',
        }),
      );

      await expect(
        service.runDiagnostic('user-1', 'project-1'),
      ).rejects.toThrow();
      expect(prisma.agentJob.create).not.toHaveBeenCalled();
    });

    it('maps a not-ready workspace to an HTTP exception', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      workspaceService.getReadyWorkspacePath.mockRejectedValue(
        new GitError({
          code: GitErrorCode.WORKSPACE_NOT_READY,
          message: 'not ready',
        }),
      );

      await expect(
        service.runDiagnostic('user-1', 'project-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: GitErrorCode.WORKSPACE_NOT_READY,
        }),
      });
      expect(prisma.agentJob.create).not.toHaveBeenCalled();
    });

    it('rejects when the workspace is on the wrong branch', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      workspaceService.getReadyWorkspacePath.mockResolvedValue(
        '/workspaces/project-1',
      );
      prisma.projectWorkspace.findUnique.mockResolvedValue({
        developmentBranch: 'autodev/development',
      });
      git.getCurrentBranch.mockResolvedValue('main');

      await expect(
        service.runDiagnostic('user-1', 'project-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: CodingAgentErrorCode.WORKSPACE_NOT_READY,
        }),
      });
    });

    it('rejects a dirty workspace with WORKSPACE_DIRTY', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      workspaceService.getReadyWorkspacePath.mockResolvedValue(
        '/workspaces/project-1',
      );
      prisma.projectWorkspace.findUnique.mockResolvedValue({
        developmentBranch: 'autodev/development',
      });
      git.getCurrentBranch.mockResolvedValue('autodev/development');
      git.getStatus.mockResolvedValue({
        clean: false,
        files: [{ path: 'x.ts', status: 'MODIFIED', staged: false }],
      });

      await expect(
        service.runDiagnostic('user-1', 'project-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: CodingAgentErrorCode.WORKSPACE_DIRTY,
        }),
      });
      expect(prisma.agentJob.create).not.toHaveBeenCalled();
    });

    it('creates an AgentJob with the fixed diagnostic instruction and enqueues a job on the happy path', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      workspaceService.getReadyWorkspacePath.mockResolvedValue(
        '/workspaces/project-1',
      );
      prisma.projectWorkspace.findUnique.mockResolvedValue({
        developmentBranch: 'autodev/development',
      });
      git.getCurrentBranch.mockResolvedValue('autodev/development');
      git.getStatus.mockResolvedValue({ clean: true, files: [] });
      prisma.agentJob.create.mockResolvedValue(buildAgentJob());
      jobService.enqueue.mockResolvedValue({
        id: 'job-1',
        type: JobType.CODING_AGENT_EXECUTION,
      });
      prisma.agentJob.update.mockResolvedValue(
        buildAgentJob({ backgroundJobId: 'job-1' }),
      );

      const result = await service.runDiagnostic('user-1', 'project-1');

      expect(prisma.agentJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            instruction: CODING_AGENT_DIAGNOSTIC_INSTRUCTION,
            maxAttempts: 1,
          }),
        }),
      );
      expect(jobService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: JobType.CODING_AGENT_EXECUTION,
          payload: { agentJobId: 'agent-job-1' },
          maxAttempts: 1,
        }),
      );
      expect(result.agentJob.instruction).toBe(
        CODING_AGENT_DIAGNOSTIC_INSTRUCTION,
      );
      expect(result.job.id).toBe('job-1');
    });

    it('never accepts a client-supplied instruction', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      workspaceService.getReadyWorkspacePath.mockResolvedValue(
        '/workspaces/project-1',
      );
      prisma.projectWorkspace.findUnique.mockResolvedValue({
        developmentBranch: 'autodev/development',
      });
      git.getCurrentBranch.mockResolvedValue('autodev/development');
      git.getStatus.mockResolvedValue({ clean: true, files: [] });
      prisma.agentJob.create.mockResolvedValue(buildAgentJob());
      jobService.enqueue.mockResolvedValue({ id: 'job-1' });
      prisma.agentJob.update.mockResolvedValue(buildAgentJob());

      // runDiagnostic's signature takes only (userId, projectId) — there is
      // no parameter through which an instruction could even be threaded.
      expect(service.runDiagnostic.length).toBe(2);
      await service.runDiagnostic('user-1', 'project-1');
      expect(prisma.agentJob.create.mock.calls[0][0].data.instruction).toBe(
        CODING_AGENT_DIAGNOSTIC_INSTRUCTION,
      );
    });

    it('deletes the stray AgentJob row if enqueueing fails', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      workspaceService.getReadyWorkspacePath.mockResolvedValue(
        '/workspaces/project-1',
      );
      prisma.projectWorkspace.findUnique.mockResolvedValue({
        developmentBranch: 'autodev/development',
      });
      git.getCurrentBranch.mockResolvedValue('autodev/development');
      git.getStatus.mockResolvedValue({ clean: true, files: [] });
      prisma.agentJob.create.mockResolvedValue(buildAgentJob());
      jobService.enqueue.mockRejectedValue(new Error('boom'));

      await expect(
        service.runDiagnostic('user-1', 'project-1'),
      ).rejects.toThrow('boom');
      expect(prisma.agentJob.delete).toHaveBeenCalledWith({
        where: { id: 'agent-job-1' },
      });
    });
  });

  describe('execute', () => {
    const buildContext = (
      overrides: Partial<Record<string, unknown>> = {},
    ) => ({
      jobId: 'job-1',
      projectId: 'project-1',
      userId: 'user-1',
      attemptCount: 1,
      maxAttempts: 1,
      payload: { agentJobId: 'agent-job-1' },
      reportProgress: jest.fn().mockResolvedValue(undefined),
      isCancellationRequested: jest.fn().mockResolvedValue(false),
      heartbeat: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    });

    beforeEach(() => {
      prisma.agentJob.findUniqueOrThrow.mockResolvedValue(buildAgentJob());
      prisma.agentJob.update.mockResolvedValue(buildAgentJob());
      workspaceService.getReadyWorkspacePath.mockResolvedValue(
        '/workspaces/project-1',
      );
      prisma.projectWorkspace.findUnique.mockResolvedValue({
        developmentBranch: 'autodev/development',
      });
      git.getCurrentBranch.mockResolvedValue('autodev/development');
      git.getStatus.mockResolvedValue({ clean: true, files: [] });
    });

    it('marks the AgentJob RUNNING then SUCCEEDED on a successful execution', async () => {
      provider.executeTask.mockResolvedValue({
        status: 'SUCCEEDED',
        summary: 'done',
        changedFiles: [],
        toolActivities: [],
        commandActivities: [],
        usage: { inputTokens: 10, outputTokens: 5 },
        metadata: {
          provider: 'claude',
          model: 'claude-sonnet-5',
          durationMs: 100,
          turns: 2,
        },
      });

      await service.execute('agent-job-1', buildContext());

      expect(prisma.agentJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AgentJobStatus.RUNNING }),
        }),
      );
      expect(prisma.agentJob.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AgentJobStatus.SUCCEEDED }),
        }),
      );
    });

    it('maps a FAILED provider result onto AgentJobStatus.FAILED with error details', async () => {
      provider.executeTask.mockResolvedValue({
        status: 'FAILED',
        summary: 'ended early',
        errorCode: CodingAgentErrorCode.TIMEOUT,
        errorMessage: 'timed out',
        changedFiles: [],
        toolActivities: [],
        commandActivities: [],
        metadata: { provider: 'claude', durationMs: 100 },
      });

      await service.execute('agent-job-1', buildContext());

      expect(prisma.agentJob.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AgentJobStatus.FAILED,
            errorCode: CodingAgentErrorCode.TIMEOUT,
          }),
        }),
      );
    });

    it('maps a CANCELLED provider result onto AgentJobStatus.CANCELLED', async () => {
      provider.executeTask.mockResolvedValue({
        status: 'CANCELLED',
        summary: 'cancelled',
        errorCode: CodingAgentErrorCode.CANCELLED,
        errorMessage: 'cancelled',
        changedFiles: [],
        toolActivities: [],
        commandActivities: [],
        metadata: { provider: 'claude', durationMs: 50 },
      });

      await service.execute('agent-job-1', buildContext());

      expect(prisma.agentJob.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AgentJobStatus.CANCELLED }),
        }),
      );
    });

    it('marks the AgentJob FAILED and rethrows a normalized error when the provider rejects', async () => {
      provider.executeTask.mockRejectedValue(
        new CodingAgentError({
          code: CodingAgentErrorCode.AUTHENTICATION_ERROR,
          message: 'bad key',
        }),
      );

      await expect(
        service.execute('agent-job-1', buildContext()),
      ).rejects.toMatchObject({
        code: CodingAgentErrorCode.AUTHENTICATION_ERROR,
      });
      expect(prisma.agentJob.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AgentJobStatus.FAILED,
            errorCode: CodingAgentErrorCode.AUTHENTICATION_ERROR,
          }),
        }),
      );
    });

    it('re-checks workspace readiness live and fails cleanly if it changed while queued', async () => {
      workspaceService.getReadyWorkspacePath.mockRejectedValue(
        new GitError({
          code: GitErrorCode.WORKSPACE_NOT_READY,
          message: 'gone',
        }),
      );

      await expect(
        service.execute('agent-job-1', buildContext()),
      ).rejects.toMatchObject({
        code: CodingAgentErrorCode.WORKSPACE_NOT_READY,
      });
      expect(provider.executeTask).not.toHaveBeenCalled();
    });

    it('aborts the provider request when cancellation is observed mid-execution', async () => {
      jest.useFakeTimers();
      let capturedSignal: AbortSignal | undefined;
      let resolveExecuteTask!: (value: unknown) => void;
      provider.executeTask.mockImplementation(
        (request: { signal?: AbortSignal }) => {
          capturedSignal = request.signal;
          return new Promise((resolve) => {
            resolveExecuteTask = resolve;
          });
        },
      );

      const context = buildContext({
        isCancellationRequested: jest.fn().mockResolvedValue(true),
      });
      const executePromise = service.execute('agent-job-1', context);

      // Flush the handful of already-resolved awaits execute() runs through
      // (RUNNING update, workspace/branch/status checks) before it reaches
      // provider.executeTask, then advance past the 2s cancellation-poll
      // interval.
      for (let i = 0; i < 10; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
      }
      await jest.advanceTimersByTimeAsync(2100);

      expect(capturedSignal?.aborted).toBe(true);

      resolveExecuteTask({
        status: 'CANCELLED',
        summary: 'cancelled',
        errorCode: CodingAgentErrorCode.CANCELLED,
        errorMessage: 'cancelled',
        changedFiles: [],
        toolActivities: [],
        commandActivities: [],
        metadata: { provider: 'claude', durationMs: 10 },
      });
      await executePromise;
      jest.useRealTimers();
    });
  });

  describe('list / getById', () => {
    it('scopes list() to the owner via ProjectsService', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.agentJob.findMany.mockResolvedValue([buildAgentJob()]);

      const result = await service.list('user-1', 'project-1');
      expect(projectsService.findOneForUser).toHaveBeenCalledWith(
        'user-1',
        'project-1',
      );
      expect(result).toHaveLength(1);
    });

    it('throws NotFoundException for a job that does not belong to the project', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.agentJob.findFirst.mockResolvedValue(null);

      await expect(
        service.getById('user-1', 'project-1', 'nope'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
