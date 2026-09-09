import {
  JobType,
  ProjectStatus,
  SprintStatus,
  TaskExecutionStatus,
  TaskStatus,
} from '@prisma/client';
import { TaskExecutionService } from './task-execution.service';
import { TaskExecutionError, TaskExecutionErrorCode } from './errors/task-execution.error';
import { ApprovalError, ApprovalErrorCode } from '../approval/errors/approval.error';
import { GitError, GitErrorCode } from '../workspace/errors/git.error';
import { CodingAgentError, CodingAgentErrorCode } from '../coding-agent/errors/coding-agent.error';

function buildProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'project-1',
    userId: 'user-1',
    archivedAt: null,
    status: ProjectStatus.DEVELOPMENT_APPROVED,
    ...overrides,
  };
}

function buildTaskRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'task-1',
    sprintId: 'sprint-1',
    sprintPlanId: 'plan-1',
    status: TaskStatus.READY,
    ...overrides,
  };
}

function buildTaskWithDeps(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...buildTaskRow(),
    sprint: { id: 'sprint-1', status: SprintStatus.RUNNING },
    dependencies: [],
    ...overrides,
  };
}

function buildExecutionRow(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    id: 'exec-1',
    projectId: 'project-1',
    taskId: 'task-1',
    attempt: 1,
    status: TaskExecutionStatus.QUEUED,
    priorTaskStatus: TaskStatus.READY,
    taskInstructionId: null,
    agentJobId: null,
    backgroundJobId: null,
    repositoryStartSha: null,
    repositoryEndSha: null,
    changedFiles: null,
    gitDiff: null,
    gitDiffTruncated: false,
    errorCode: null,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildInstruction(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'instruction-1',
    finalInstruction: 'Do the thing.',
    repositoryHeadSha: 'sha-start',
    ...overrides,
  };
}

function buildAgentJobRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'agent-job-1',
    status: 'SUCCEEDED',
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

describe('TaskExecutionService', () => {
  let prisma: any;
  let projectsService: any;
  let approvalService: any;
  let workspaceService: any;
  let git: any;
  let jobService: any;
  let taskInstructionService: any;
  let codingAgentService: any;
  let config: any;
  let context: any;
  let service: TaskExecutionService;

  beforeEach(() => {
    prisma = {
      task: {
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue(buildTaskRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      sprint: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      sprintPlan: { findFirst: jest.fn() },
      project: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      projectWorkspace: { findUnique: jest.fn() },
      taskExecution: {
        create: jest.fn(),
        update: jest.fn().mockImplementation((args: any) => buildExecutionRow(args?.data ?? {})),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _max: { attempt: null } }),
      },
      agentJob: { create: jest.fn() },
      job: { findUnique: jest.fn() },
      $transaction: jest.fn((arg: unknown) => {
        if (Array.isArray(arg)) return Promise.all(arg);
        return (arg as (tx: unknown) => unknown)(prisma);
      }),
    };
    projectsService = { findOneForUser: jest.fn() };
    approvalService = {
      assertDevelopmentApproved: jest.fn().mockResolvedValue(undefined),
    };
    workspaceService = { getReadyWorkspacePath: jest.fn() };
    git = {
      getCurrentBranch: jest.fn(),
      getStatus: jest.fn(),
      getHeadCommitSha: jest.fn(),
      getDiff: jest.fn(),
    };
    jobService = { enqueue: jest.fn() };
    taskInstructionService = { getOrGenerateFreshInstruction: jest.fn() };
    codingAgentService = { execute: jest.fn() };
    config = { maxDiffChars: 200000 };
    context = {
      reportProgress: jest.fn().mockResolvedValue(undefined),
      isCancellationRequested: jest.fn().mockResolvedValue(false),
      heartbeat: jest.fn().mockResolvedValue(undefined),
    };

    service = new TaskExecutionService(
      prisma,
      projectsService,
      approvalService,
      workspaceService,
      git,
      jobService,
      taskInstructionService,
      codingAgentService,
      config,
    );
  });

  function setupEligibleMocks() {
    projectsService.findOneForUser.mockResolvedValue(buildProject());
    prisma.task.findFirst.mockResolvedValue(buildTaskWithDeps());
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.taskExecution.findFirst.mockResolvedValue(null);
    workspaceService.getReadyWorkspacePath.mockResolvedValue('/workspaces/project-1');
    prisma.projectWorkspace.findUnique.mockResolvedValue({
      developmentBranch: 'autodev/development',
    });
    git.getCurrentBranch.mockResolvedValue('autodev/development');
    git.getStatus.mockResolvedValue({ clean: true, files: [] });
  }

  describe('getEligibility', () => {
    it('is runnable when every gate passes', async () => {
      setupEligibleMocks();

      const result = await service.getEligibility('user-1', 'project-1', 'task-1');

      expect(result.runnable).toBe(true);
      expect(result.reasons).toEqual([]);
    });

    it('flags an archived project', async () => {
      setupEligibleMocks();
      projectsService.findOneForUser.mockResolvedValue(buildProject({ archivedAt: new Date() }));

      const result = await service.getEligibility('user-1', 'project-1', 'task-1');

      expect(result.reasons).toContain(TaskExecutionErrorCode.PROJECT_ARCHIVED);
    });

    it('flags a Task belonging to a superseded Sprint Plan', async () => {
      setupEligibleMocks();
      prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-2' });

      const result = await service.getEligibility('user-1', 'project-1', 'task-1');

      expect(result.reasons).toContain(TaskExecutionErrorCode.TASK_NOT_IN_CURRENT_PLAN);
    });

    it('flags missing development approval', async () => {
      setupEligibleMocks();
      approvalService.assertDevelopmentApproved.mockRejectedValue(
        new ApprovalError({
          code: ApprovalErrorCode.DEVELOPMENT_PREREQUISITES_MISSING,
          message: 'not approved',
        }),
      );

      const result = await service.getEligibility('user-1', 'project-1', 'task-1');

      expect(result.reasons).toContain(TaskExecutionErrorCode.DEVELOPMENT_NOT_APPROVED);
    });

    it.each([
      [TaskStatus.PASSED, TaskExecutionErrorCode.TASK_ALREADY_PASSED],
      [TaskStatus.RUNNING, TaskExecutionErrorCode.TASK_RUNNING],
      [TaskStatus.REVIEWING, TaskExecutionErrorCode.TASK_REVIEWING],
      [TaskStatus.FAILED, TaskExecutionErrorCode.TASK_FAILED_PREVIOUSLY],
      [TaskStatus.BLOCKED, TaskExecutionErrorCode.TASK_BLOCKED],
    ])('flags a Task in status %s as %s', async (status, expectedCode) => {
      setupEligibleMocks();
      prisma.task.findFirst.mockResolvedValue(buildTaskWithDeps({ status }));

      const result = await service.getEligibility('user-1', 'project-1', 'task-1');

      expect(result.reasons).toContain(expectedCode);
    });

    it('flags a Task whose Sprint is BLOCKED', async () => {
      setupEligibleMocks();
      prisma.task.findFirst.mockResolvedValue(
        buildTaskWithDeps({ sprint: { id: 'sprint-1', status: SprintStatus.BLOCKED } }),
      );

      const result = await service.getEligibility('user-1', 'project-1', 'task-1');

      expect(result.reasons).toContain(TaskExecutionErrorCode.SPRINT_BLOCKED);
    });

    it('flags a dependency that is not exactly PASSED (critical: REVIEWING does not satisfy it)', async () => {
      setupEligibleMocks();
      prisma.task.findFirst.mockResolvedValue(
        buildTaskWithDeps({
          dependencies: [{ dependsOnTask: { status: TaskStatus.REVIEWING } }],
        }),
      );

      const result = await service.getEligibility('user-1', 'project-1', 'task-1');

      expect(result.reasons).toContain(TaskExecutionErrorCode.DEPENDENCY_NOT_PASSED);
    });

    it('is runnable when every dependency is exactly PASSED', async () => {
      setupEligibleMocks();
      prisma.task.findFirst.mockResolvedValue(
        buildTaskWithDeps({
          dependencies: [{ dependsOnTask: { status: TaskStatus.PASSED } }],
        }),
      );

      const result = await service.getEligibility('user-1', 'project-1', 'task-1');

      expect(result.runnable).toBe(true);
    });

    it('flags an active execution for the same Task', async () => {
      setupEligibleMocks();
      prisma.taskExecution.findFirst.mockResolvedValue(
        buildExecutionRow({ status: TaskExecutionStatus.RUNNING, backgroundJobId: 'job-1' }),
      );
      prisma.job.findUnique.mockResolvedValue({ status: 'RUNNING' });

      const result = await service.getEligibility('user-1', 'project-1', 'task-1');

      expect(result.reasons).toContain(TaskExecutionErrorCode.ACTIVE_EXECUTION);
    });

    it('self-heals (does not block) when the "active" execution is orphaned by a terminal background Job', async () => {
      setupEligibleMocks();
      // First call: reconcileOrphanedExecution's own lookup, finding the
      // stale RUNNING row backed by a Job that already finished.
      prisma.taskExecution.findFirst.mockResolvedValueOnce(
        buildExecutionRow({ status: TaskExecutionStatus.RUNNING, backgroundJobId: 'job-1' }),
      );
      prisma.job.findUnique.mockResolvedValue({ status: 'FAILED' });
      // Second call: evaluateEligibility's own active-execution check, run
      // after reconciliation has already marked that row FAILED.
      prisma.taskExecution.findFirst.mockResolvedValueOnce(null);

      const result = await service.getEligibility('user-1', 'project-1', 'task-1');

      expect(prisma.taskExecution.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: TaskExecutionStatus.FAILED }),
        }),
      );
      expect(result.reasons).not.toContain(TaskExecutionErrorCode.ACTIVE_EXECUTION);
    });

    it('flags a workspace that is not ready', async () => {
      setupEligibleMocks();
      workspaceService.getReadyWorkspacePath.mockRejectedValue(
        new GitError({ code: GitErrorCode.WORKSPACE_NOT_READY, message: 'not ready' }),
      );

      const result = await service.getEligibility('user-1', 'project-1', 'task-1');

      expect(result.reasons).toContain(TaskExecutionErrorCode.WORKSPACE_NOT_READY);
    });

    it('flags a dirty workspace', async () => {
      setupEligibleMocks();
      git.getStatus.mockResolvedValue({ clean: false, files: [{ path: 'a.txt' }] });

      const result = await service.getEligibility('user-1', 'project-1', 'task-1');

      expect(result.reasons).toContain(TaskExecutionErrorCode.WORKSPACE_DIRTY);
    });

    it('flags the wrong branch', async () => {
      setupEligibleMocks();
      git.getCurrentBranch.mockResolvedValue('main');

      const result = await service.getEligibility('user-1', 'project-1', 'task-1');

      expect(result.reasons).toContain(TaskExecutionErrorCode.WRONG_BRANCH);
    });
  });

  describe('run', () => {
    it('locks the Task RUNNING, creates attempt 1, transitions Project and Sprint, and enqueues a TASK_EXECUTION job', async () => {
      setupEligibleMocks();
      prisma.task.findUniqueOrThrow.mockResolvedValue(buildTaskRow());
      prisma.taskExecution.create.mockResolvedValue(buildExecutionRow());
      prisma.sprint.updateMany.mockResolvedValue({ count: 1 });
      prisma.project.updateMany.mockResolvedValue({ count: 1 });
      jobService.enqueue.mockResolvedValue({ id: 'job-1' });
      prisma.taskExecution.update.mockResolvedValue(
        buildExecutionRow({ backgroundJobId: 'job-1' }),
      );

      const result = await service.run('user-1', 'project-1', 'task-1');

      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1', status: { in: [TaskStatus.PENDING, TaskStatus.READY] } },
          data: { status: TaskStatus.RUNNING },
        }),
      );
      expect(prisma.taskExecution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ attempt: 1, priorTaskStatus: TaskStatus.READY }),
        }),
      );
      expect(prisma.project.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: ProjectStatus.DEVELOPING } }),
      );
      expect(prisma.sprint.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: SprintStatus.RUNNING } }),
      );
      expect(jobService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: JobType.TASK_EXECUTION,
          maxAttempts: 1,
          payload: { taskExecutionId: 'exec-1', taskId: 'task-1', projectId: 'project-1' },
        }),
      );
      expect(result.job.id).toBe('job-1');
    });

    it('rejects when the Task is not eligible, without ever touching the lock', async () => {
      setupEligibleMocks();
      prisma.task.findFirst.mockResolvedValue(buildTaskWithDeps({ status: TaskStatus.PASSED }));

      await expect(service.run('user-1', 'project-1', 'task-1')).rejects.toBeInstanceOf(Error);
      expect(prisma.task.updateMany).not.toHaveBeenCalled();
    });

    it('reports a conflict when a concurrent request wins the atomic lock first', async () => {
      setupEligibleMocks();
      prisma.task.findUniqueOrThrow.mockResolvedValue(buildTaskRow());
      prisma.task.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.run('user-1', 'project-1', 'task-1')).rejects.toBeInstanceOf(Error);
      expect(prisma.taskExecution.create).not.toHaveBeenCalled();
      expect(jobService.enqueue).not.toHaveBeenCalled();
    });

    it('never re-transitions the Project once it is already past DEVELOPMENT_APPROVED', async () => {
      setupEligibleMocks();
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ status: ProjectStatus.DEVELOPING }),
      );
      prisma.task.findUniqueOrThrow.mockResolvedValue(buildTaskRow());
      prisma.taskExecution.create.mockResolvedValue(buildExecutionRow());
      jobService.enqueue.mockResolvedValue({ id: 'job-1' });
      prisma.taskExecution.update.mockResolvedValue(buildExecutionRow({ backgroundJobId: 'job-1' }));

      await service.run('user-1', 'project-1', 'task-1');

      // updateMany is still called (idempotent/no-op), but scoped to
      // DEVELOPMENT_APPROVED only — it will not match/affect a project
      // already DEVELOPING.
      expect(prisma.project.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'project-1', status: ProjectStatus.DEVELOPMENT_APPROVED },
        }),
      );
    });

    it('rolls the Task back to its prior status and marks the execution FAILED if enqueueing fails', async () => {
      setupEligibleMocks();
      prisma.task.findUniqueOrThrow.mockResolvedValue(buildTaskRow());
      prisma.taskExecution.create.mockResolvedValue(buildExecutionRow());
      jobService.enqueue.mockRejectedValue(new Error('queue unavailable'));

      await expect(service.run('user-1', 'project-1', 'task-1')).rejects.toThrow(
        'queue unavailable',
      );

      expect(prisma.taskExecution.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: TaskExecutionStatus.FAILED,
            errorCode: TaskExecutionErrorCode.ENQUEUE_FAILED,
          }),
        }),
      );
      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1', status: TaskStatus.RUNNING },
          data: { status: TaskStatus.READY },
        }),
      );
    });
  });

  describe('execute (background worker)', () => {
    function setupExecuteHappyPathMocks() {
      prisma.taskExecution.findUniqueOrThrow.mockResolvedValue(buildExecutionRow());
      prisma.task.findFirst.mockResolvedValue(buildTaskWithDeps());
      workspaceService.getReadyWorkspacePath.mockResolvedValue('/workspaces/project-1');
      prisma.projectWorkspace.findUnique.mockResolvedValue({
        developmentBranch: 'autodev/development',
      });
      git.getCurrentBranch.mockResolvedValue('autodev/development');
      git.getStatus.mockResolvedValue({ clean: true, files: [] });
      git.getHeadCommitSha.mockResolvedValue('sha-start');
      taskInstructionService.getOrGenerateFreshInstruction.mockResolvedValue(
        buildInstruction({ repositoryHeadSha: 'sha-start' }),
      );
      prisma.agentJob.create.mockResolvedValue({ id: 'agent-job-1' });
    }

    it('transitions the Task to REVIEWING (never PASSED) when the agent succeeds', async () => {
      setupExecuteHappyPathMocks();
      codingAgentService.execute.mockResolvedValue(
        buildAgentJobRecord({ status: 'SUCCEEDED' }),
      );
      git.getHeadCommitSha.mockResolvedValueOnce('sha-start').mockResolvedValue('sha-start');

      await service.execute('exec-1', context);

      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: TaskStatus.REVIEWING } }),
      );
      expect(prisma.task.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: TaskStatus.PASSED } }),
      );
      expect(codingAgentService.execute).toHaveBeenCalledWith('agent-job-1', context);
    });

    it('captures changed files and diff, and marks the TaskExecution READY_FOR_VALIDATION on success', async () => {
      setupExecuteHappyPathMocks();
      codingAgentService.execute.mockResolvedValue(buildAgentJobRecord({ status: 'SUCCEEDED' }));
      git.getStatus
        .mockResolvedValueOnce({ clean: true, files: [] }) // pre-flight check
        .mockResolvedValueOnce({
          clean: false,
          files: [{ path: 'hello.txt', status: 'ADDED', staged: false }],
        });
      git.getDiff.mockResolvedValue({ diff: 'diff --git a/hello.txt', truncated: false, sizeBytes: 10 });

      await service.execute('exec-1', context);

      const executionUpdateCalls = prisma.taskExecution.update.mock.calls.map((c: any[]) => c[0]);
      const finalUpdate = executionUpdateCalls.find((c: any) => c.data.status === TaskExecutionStatus.READY_FOR_VALIDATION);
      expect(finalUpdate.data.changedFiles).toEqual([{ path: 'hello.txt', changeType: 'ADDED' }]);
      expect(finalUpdate.data.gitDiff).toContain('hello.txt');
    });

    it('marks the Task FAILED and preserves partial changes (no reset) when the agent fails', async () => {
      setupExecuteHappyPathMocks();
      codingAgentService.execute.mockResolvedValue(
        buildAgentJobRecord({ status: 'FAILED', errorCode: 'PROVIDER_UNAVAILABLE', errorMessage: 'failed' }),
      );
      git.getStatus
        .mockResolvedValueOnce({ clean: true, files: [] })
        .mockResolvedValueOnce({
          clean: false,
          files: [{ path: 'broken.txt', status: 'MODIFIED', staged: false }],
        });
      git.getDiff.mockResolvedValue({ diff: 'diff --git a/broken.txt', truncated: false, sizeBytes: 10 });

      await service.execute('exec-1', context);

      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: TaskStatus.FAILED } }),
      );
      const finalUpdate = prisma.taskExecution.update.mock.calls
        .map((c: any[]) => c[0])
        .find((c: any) => c.data.status === TaskExecutionStatus.FAILED);
      expect(finalUpdate.data.changedFiles).toEqual([{ path: 'broken.txt', changeType: 'MODIFIED' }]);
      expect(finalUpdate.data.gitDiff).toContain('broken.txt');
    });

    it('rolls the Task back to its prior status (not FAILED) when the failure happens before the coding agent ever starts', async () => {
      setupExecuteHappyPathMocks();
      workspaceService.getReadyWorkspacePath.mockRejectedValue(
        new GitError({ code: GitErrorCode.WORKSPACE_NOT_READY, message: 'gone' }),
      );

      await service.execute('exec-1', context);

      expect(codingAgentService.execute).not.toHaveBeenCalled();
      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1', status: TaskStatus.RUNNING },
          data: { status: TaskStatus.READY },
        }),
      );
      const executionUpdate = prisma.taskExecution.update.mock.calls
        .map((c: any[]) => c[0])
        .find((c: any) => c.data.status === TaskExecutionStatus.FAILED);
      expect(executionUpdate.data.errorCode).toBe(TaskExecutionErrorCode.WORKSPACE_NOT_READY);
    });

    it('rolls the Task back when a dependency stopped being PASSED before the agent started', async () => {
      setupExecuteHappyPathMocks();
      prisma.task.findFirst.mockResolvedValue(
        buildTaskWithDeps({ dependencies: [{ dependsOnTask: { status: TaskStatus.FAILED } }] }),
      );

      await service.execute('exec-1', context);

      expect(codingAgentService.execute).not.toHaveBeenCalled();
      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: TaskStatus.READY } }),
      );
    });

    it('never invokes the coding agent when already cancelled before starting', async () => {
      setupExecuteHappyPathMocks();
      context.isCancellationRequested.mockResolvedValue(true);

      await service.execute('exec-1', context);

      expect(codingAgentService.execute).not.toHaveBeenCalled();
      expect(taskInstructionService.getOrGenerateFreshInstruction).not.toHaveBeenCalled();
      const executionUpdate = prisma.taskExecution.update.mock.calls
        .map((c: any[]) => c[0])
        .find((c: any) => c.data.status === TaskExecutionStatus.CANCELLED);
      expect(executionUpdate).toBeTruthy();
    });

    it('returns the Task to its prior status on cancellation with no resulting file changes', async () => {
      setupExecuteHappyPathMocks();
      codingAgentService.execute.mockResolvedValue(buildAgentJobRecord({ status: 'CANCELLED' }));
      git.getStatus
        .mockResolvedValueOnce({ clean: true, files: [] })
        .mockResolvedValueOnce({ clean: true, files: [] });

      await service.execute('exec-1', context);

      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: TaskStatus.READY } }),
      );
    });

    it('marks the Task FAILED on cancellation if files were modified before the abort landed', async () => {
      setupExecuteHappyPathMocks();
      codingAgentService.execute.mockResolvedValue(buildAgentJobRecord({ status: 'CANCELLED' }));
      git.getStatus
        .mockResolvedValueOnce({ clean: true, files: [] })
        .mockResolvedValueOnce({
          clean: false,
          files: [{ path: 'partial.txt', status: 'ADDED', staged: false }],
        });
      git.getDiff.mockResolvedValue({ diff: '', truncated: false, sizeBytes: 0 });

      await service.execute('exec-1', context);

      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: TaskStatus.FAILED } }),
      );
    });

    it('regenerates once and proceeds when the instruction drifted, then failing safely if it drifts again', async () => {
      setupExecuteHappyPathMocks();
      taskInstructionService.getOrGenerateFreshInstruction
        .mockResolvedValueOnce(buildInstruction({ repositoryHeadSha: 'sha-old' }))
        .mockResolvedValueOnce(buildInstruction({ repositoryHeadSha: 'sha-new' }));
      git.getHeadCommitSha
        .mockResolvedValueOnce('sha-start') // repositoryStartSha capture
        .mockResolvedValueOnce('sha-new') // first freshness check (drifted)
        .mockResolvedValueOnce('sha-new'); // second freshness check (matches now)
      codingAgentService.execute.mockResolvedValue(buildAgentJobRecord({ status: 'SUCCEEDED' }));

      await service.execute('exec-1', context);

      expect(taskInstructionService.getOrGenerateFreshInstruction).toHaveBeenCalledTimes(2);
      expect(codingAgentService.execute).toHaveBeenCalled();
    });

    it('fails safely with REPOSITORY_STATE_CHANGED if the instruction keeps drifting after one regeneration', async () => {
      setupExecuteHappyPathMocks();
      taskInstructionService.getOrGenerateFreshInstruction
        .mockResolvedValueOnce(buildInstruction({ repositoryHeadSha: 'sha-old' }))
        .mockResolvedValueOnce(buildInstruction({ repositoryHeadSha: 'sha-older' }));
      git.getHeadCommitSha
        .mockResolvedValueOnce('sha-start')
        .mockResolvedValueOnce('sha-new')
        .mockResolvedValueOnce('sha-newer');

      await service.execute('exec-1', context);

      expect(codingAgentService.execute).not.toHaveBeenCalled();
      const executionUpdate = prisma.taskExecution.update.mock.calls
        .map((c: any[]) => c[0])
        .find((c: any) => c.data.status === TaskExecutionStatus.FAILED);
      expect(executionUpdate.data.errorCode).toBe(TaskExecutionErrorCode.REPOSITORY_STATE_CHANGED);
    });

    it('never mistakes a post-agent bookkeeping failure for a pre-agent failure (must not roll the Task back once the agent has actually run)', async () => {
      setupExecuteHappyPathMocks();
      codingAgentService.execute.mockResolvedValue(buildAgentJobRecord({ status: 'SUCCEEDED' }));
      // Simulate a DB/bug failure specifically while finalizeExecution
      // records the already-real outcome (its first write marks the
      // TaskExecution AGENT_COMPLETED) — every earlier taskExecution.update
      // call (inside the pre-agent phase) still succeeds normally.
      prisma.taskExecution.update.mockImplementation((args: any) => {
        if (args?.data?.status === TaskExecutionStatus.AGENT_COMPLETED) {
          throw new Error('DB write failed');
        }
        return buildExecutionRow(args?.data ?? {});
      });

      await expect(service.execute('exec-1', context)).rejects.toThrow('DB write failed');

      // Crucially: the Task must never be silently rolled back to READY —
      // that would mislabel a run where the agent actually succeeded.
      expect(prisma.task.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: TaskStatus.READY } }),
      );
    });

    it('never rejects even when the provider throws (pre-agent failure, per the CodingAgentProvider contract)', async () => {
      setupExecuteHappyPathMocks();
      codingAgentService.execute.mockRejectedValue(
        new CodingAgentError({ code: CodingAgentErrorCode.WORKSPACE_DIRTY, message: 'dirty' }),
      );

      await expect(service.execute('exec-1', context)).resolves.toBeDefined();
      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: TaskStatus.READY } }),
      );
    });
  });
});
