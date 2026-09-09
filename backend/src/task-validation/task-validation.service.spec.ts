import { TaskValidationService } from './task-validation.service';
import { TaskValidationErrorCode } from './errors/task-validation.error';
import {
  ApprovalError,
  ApprovalErrorCode,
} from '../approval/errors/approval.error';
import { GitError, GitErrorCode } from '../workspace/errors/git.error';

function buildProject(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 'project-1', userId: 'user-1', archivedAt: null, ...overrides };
}

function buildTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'task-1',
    key: 'S1-T1',
    title: 'Implement the thing',
    sprintPlanId: 'plan-1',
    status: 'REVIEWING',
    validationExpectations: [
      { type: 'lint', description: 'Lint', required: true },
      { type: 'unit_test', description: 'Unit tests', required: true },
    ],
    ...overrides,
  };
}

function buildExecution(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'exec-1',
    projectId: 'project-1',
    taskId: 'task-1',
    status: 'READY_FOR_VALIDATION',
    repositoryStartSha: 'sha-1',
    repositoryEndSha: 'sha-1',
    changedFiles: [{ path: 'src/a.ts', changeType: 'MODIFIED' }],
    commitSha: null,
    ...overrides,
  };
}

function buildAttempt(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    id: 'attempt-1',
    projectId: 'project-1',
    taskId: 'task-1',
    taskExecutionId: 'exec-1',
    attempt: 1,
    status: 'QUEUED',
    backgroundJobId: null,
    startedAt: null,
    completedAt: null,
    requiredPassed: 0,
    requiredFailed: 0,
    optionalPassed: 0,
    optionalFailed: 0,
    commitSha: null,
    validatedDiffHash: null,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildCheck(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    type: 'LINT',
    name: 'Backend lint',
    command: 'npm',
    args: ['run', 'lint'],
    workingDirectory: 'backend',
    required: true,
    ...overrides,
  };
}

describe('TaskValidationService', () => {
  let prisma: any;
  let projectsService: any;
  let approvalService: any;
  let workspaceService: any;
  let git: any;
  let jobService: any;
  let planResolver: any;
  let executor: any;
  let context: any;
  let service: TaskValidationService;
  let runCounter: number;

  beforeEach(() => {
    runCounter = 0;
    const runStore = new Map<string, any>();
    prisma = {
      task: {
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      sprintPlan: { findFirst: jest.fn() },
      projectWorkspace: { findUnique: jest.fn() },
      taskExecution: {
        findFirst: jest.fn(),
        findFirstOrThrow: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue(buildExecution()),
      },
      validationAttempt: {
        create: jest.fn(),
        update: jest
          .fn()
          .mockImplementation((args: any) =>
            buildAttempt({ id: args.where.id, ...args.data }),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _max: { attempt: null } }),
      },
      validationRun: {
        create: jest.fn().mockImplementation((args: any) => {
          const row = {
            id: `run-${runCounter++}`,
            status: 'PENDING',
            ...args.data,
          };
          runStore.set(row.id, row);
          return row;
        }),
        update: jest.fn().mockImplementation((args: any) => {
          const existing = runStore.get(args.where.id) ?? { id: args.where.id };
          const updated = { ...existing, ...args.data };
          runStore.set(args.where.id, updated);
          return updated;
        }),
        findMany: jest
          .fn()
          .mockImplementation(() => Array.from(runStore.values())),
      },
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
      getDiff: jest.fn(),
      getHeadCommitSha: jest.fn(),
      stageFiles: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn(),
      getRecentCommits: jest.fn().mockResolvedValue([]),
    };
    jobService = { enqueue: jest.fn() };
    planResolver = { resolve: jest.fn() };
    executor = { run: jest.fn() };
    context = {
      reportProgress: jest.fn().mockResolvedValue(undefined),
      isCancellationRequested: jest.fn().mockResolvedValue(false),
      heartbeat: jest.fn().mockResolvedValue(undefined),
    };

    service = new TaskValidationService(
      prisma,
      projectsService,
      approvalService,
      workspaceService,
      git,
      jobService,
      planResolver,
      executor,
    );
  });

  function setupEligibleMocks() {
    projectsService.findOneForUser.mockResolvedValue(buildProject());
    prisma.task.findFirst.mockResolvedValue(buildTask());
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.taskExecution.findFirst.mockResolvedValue(buildExecution());
    prisma.validationAttempt.findFirst.mockResolvedValue(null);
    workspaceService.getReadyWorkspacePath.mockResolvedValue(
      '/workspaces/project-1',
    );
    prisma.projectWorkspace.findUnique.mockResolvedValue({
      developmentBranch: 'autodev/development',
    });
    git.getCurrentBranch.mockResolvedValue('autodev/development');
    git.getHeadCommitSha.mockResolvedValue('sha-1');
    git.getStatus.mockResolvedValue({
      clean: false,
      files: [{ path: 'src/a.ts', status: 'MODIFIED', staged: false }],
    });
  }

  describe('getEligibility', () => {
    it('is runnable when every gate passes', async () => {
      setupEligibleMocks();
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'task-1',
      );
      expect(result.runnable).toBe(true);
      expect(result.reasons).toEqual([]);
    });

    it('flags a Task that is not REVIEWING', async () => {
      setupEligibleMocks();
      prisma.task.findFirst.mockResolvedValue(buildTask({ status: 'PENDING' }));
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'task-1',
      );
      expect(result.reasons).toContain(
        TaskValidationErrorCode.TASK_NOT_REVIEWING,
      );
    });

    it('flags when there is no successful TaskExecution', async () => {
      setupEligibleMocks();
      prisma.taskExecution.findFirst.mockResolvedValue(null);
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'task-1',
      );
      expect(result.reasons).toContain(
        TaskValidationErrorCode.NO_SUCCESSFUL_EXECUTION,
      );
    });

    it('flags when the latest TaskExecution did not reach READY_FOR_VALIDATION', async () => {
      setupEligibleMocks();
      prisma.taskExecution.findFirst.mockResolvedValue(
        buildExecution({ status: 'FAILED' }),
      );
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'task-1',
      );
      expect(result.reasons).toContain(
        TaskValidationErrorCode.NO_SUCCESSFUL_EXECUTION,
      );
    });

    it('flags an active validation for the same Task', async () => {
      setupEligibleMocks();
      prisma.validationAttempt.findFirst.mockResolvedValue(
        buildAttempt({ status: 'RUNNING' }),
      );
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'task-1',
      );
      expect(result.reasons).toContain(
        TaskValidationErrorCode.ACTIVE_VALIDATION,
      );
    });

    it('flags a repository HEAD that moved since the TaskExecution completed', async () => {
      setupEligibleMocks();
      git.getHeadCommitSha.mockResolvedValue('sha-moved');
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'task-1',
      );
      expect(result.reasons).toContain(
        TaskValidationErrorCode.REPOSITORY_STATE_CHANGED,
      );
    });

    it('flags a workspace with changes unrelated to the TaskExecution', async () => {
      setupEligibleMocks();
      git.getStatus.mockResolvedValue({
        clean: false,
        files: [
          { path: 'src/a.ts', status: 'MODIFIED', staged: false },
          { path: 'unrelated.txt', status: 'UNTRACKED', staged: false },
        ],
      });
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'task-1',
      );
      expect(result.reasons).toContain(
        TaskValidationErrorCode.UNEXPECTED_WORKSPACE_CHANGES,
      );
    });

    it('flags a clean workspace when changes were expected (NO_EXPECTED_CHANGES)', async () => {
      setupEligibleMocks();
      git.getStatus.mockResolvedValue({ clean: true, files: [] });
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'task-1',
      );
      expect(result.reasons).toContain(
        TaskValidationErrorCode.NO_EXPECTED_CHANGES,
      );
    });

    it('is runnable when the Task legitimately required no changes (both expected and actual are empty)', async () => {
      setupEligibleMocks();
      prisma.taskExecution.findFirst.mockResolvedValue(
        buildExecution({ changedFiles: [] }),
      );
      git.getStatus.mockResolvedValue({ clean: true, files: [] });
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'task-1',
      );
      expect(result.runnable).toBe(true);
    });

    it('flags a wrong branch', async () => {
      setupEligibleMocks();
      git.getCurrentBranch.mockResolvedValue('main');
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'task-1',
      );
      expect(result.reasons).toContain(TaskValidationErrorCode.WRONG_BRANCH);
    });

    it('flags an archived project', async () => {
      setupEligibleMocks();
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ archivedAt: new Date() }),
      );
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'task-1',
      );
      expect(result.reasons).toContain(
        TaskValidationErrorCode.PROJECT_ARCHIVED,
      );
    });

    it('flags missing development approval', async () => {
      setupEligibleMocks();
      approvalService.assertDevelopmentApproved.mockRejectedValue(
        new ApprovalError({
          code: ApprovalErrorCode.DEVELOPMENT_PREREQUISITES_MISSING,
          message: 'no',
        }),
      );
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'task-1',
      );
      expect(result.reasons).toContain(
        TaskValidationErrorCode.DEVELOPMENT_NOT_APPROVED,
      );
    });
  });

  describe('validate', () => {
    it('creates a QUEUED attempt and enqueues a TASK_VALIDATION job', async () => {
      setupEligibleMocks();
      prisma.taskExecution.findFirstOrThrow.mockResolvedValue(buildExecution());
      prisma.validationAttempt.create.mockResolvedValue(buildAttempt());
      jobService.enqueue.mockResolvedValue({ id: 'job-1' });
      prisma.validationAttempt.update.mockResolvedValue(
        buildAttempt({ backgroundJobId: 'job-1' }),
      );

      const result = await service.validate('user-1', 'project-1', 'task-1');

      expect(prisma.validationAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            attempt: 1,
            taskExecutionId: 'exec-1',
          }),
        }),
      );
      expect(jobService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'TASK_VALIDATION', maxAttempts: 1 }),
      );
      expect(result.job.id).toBe('job-1');
    });

    it('rejects when not eligible', async () => {
      setupEligibleMocks();
      prisma.task.findFirst.mockResolvedValue(buildTask({ status: 'PENDING' }));

      await expect(
        service.validate('user-1', 'project-1', 'task-1'),
      ).rejects.toBeInstanceOf(Error);
      expect(prisma.validationAttempt.create).not.toHaveBeenCalled();
    });

    it('rejects a concurrent duplicate validation request', async () => {
      setupEligibleMocks();
      prisma.taskExecution.findFirstOrThrow.mockResolvedValue(buildExecution());
      prisma.validationAttempt.findFirst.mockResolvedValueOnce(null); // eligibility check
      prisma.validationAttempt.findFirst.mockResolvedValueOnce(
        buildAttempt({ status: 'RUNNING' }),
      ); // inside the create transaction

      await expect(
        service.validate('user-1', 'project-1', 'task-1'),
      ).rejects.toBeInstanceOf(Error);
      expect(prisma.validationAttempt.create).not.toHaveBeenCalled();
    });

    it('marks the attempt FAILED if enqueueing fails, without touching Task status', async () => {
      setupEligibleMocks();
      prisma.taskExecution.findFirstOrThrow.mockResolvedValue(buildExecution());
      prisma.validationAttempt.create.mockResolvedValue(buildAttempt());
      jobService.enqueue.mockRejectedValue(new Error('queue down'));

      await expect(
        service.validate('user-1', 'project-1', 'task-1'),
      ).rejects.toThrow('queue down');

      expect(prisma.validationAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
            errorCode: TaskValidationErrorCode.ENQUEUE_FAILED,
          }),
        }),
      );
      expect(prisma.task.update).not.toHaveBeenCalled();
      expect(prisma.task.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('execute (background worker)', () => {
    function setupExecuteHappyPathMocks() {
      prisma.validationAttempt.findUniqueOrThrow.mockResolvedValue(
        buildAttempt(),
      );
      prisma.task.findUniqueOrThrow.mockResolvedValue(buildTask());
      prisma.taskExecution.findUniqueOrThrow.mockResolvedValue(
        buildExecution(),
      );
      workspaceService.getReadyWorkspacePath.mockResolvedValue(
        '/workspaces/project-1',
      );
      prisma.projectWorkspace.findUnique.mockResolvedValue({
        developmentBranch: 'autodev/development',
      });
      git.getCurrentBranch.mockResolvedValue('autodev/development');
      git.getHeadCommitSha.mockResolvedValue('sha-1');
      // Three sequential git.getStatus calls happen in the full happy
      // path: (1) baseline before any check runs, (2) the post-validation
      // race-protection recheck, (3) the post-commit cleanliness check.
      // (1) and (2) must be identical (nothing changed during validation);
      // (3) must be clean (a real commit was made).
      const dirtyStatus = {
        clean: false,
        files: [{ path: 'src/a.ts', status: 'MODIFIED', staged: false }],
      };
      git.getStatus
        .mockResolvedValueOnce(dirtyStatus)
        .mockResolvedValueOnce(dirtyStatus)
        .mockResolvedValue({ clean: true, files: [] });
      git.getDiff.mockResolvedValue({
        diff: 'diff --git a/src/a.ts',
        truncated: false,
        sizeBytes: 10,
      });
      git.commit.mockResolvedValue('commit-sha-1');
      planResolver.resolve.mockResolvedValue([buildCheck()]);
      executor.run.mockResolvedValue({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        outputTruncated: false,
        durationMs: 5,
        timedOut: false,
        cancelled: false,
      });
    }

    it('marks the Task PASSED and commits when every required check passes', async () => {
      setupExecuteHappyPathMocks();

      await service.execute('attempt-1', context);

      expect(git.stageFiles).toHaveBeenCalledWith('/workspaces/project-1', [
        'src/a.ts',
      ]);
      expect(git.commit).toHaveBeenCalledWith(
        '/workspaces/project-1',
        'task(S1-T1): Implement the thing',
      );
      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'PASSED' } }),
      );
      const attemptUpdateCalls = prisma.validationAttempt.update.mock.calls.map(
        (c: any[]) => c[0],
      );
      const passedUpdate = attemptUpdateCalls.find(
        (c: any) => c.data.status === 'PASSED',
      );
      expect(passedUpdate.data.commitSha).toBe('commit-sha-1');
    });

    it('never marks the Task PASSED purely from the coding agent — a required FAILED check blocks it', async () => {
      setupExecuteHappyPathMocks();
      executor.run.mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'lint errors',
        outputTruncated: false,
        durationMs: 5,
        timedOut: false,
        cancelled: false,
      });

      await service.execute('attempt-1', context);

      expect(git.commit).not.toHaveBeenCalled();
      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'FAILED' } }),
      );
    });

    it('does not block Task PASS when only an optional check fails', async () => {
      setupExecuteHappyPathMocks();
      planResolver.resolve.mockResolvedValue([
        buildCheck({ required: true, name: 'Required lint' }),
        buildCheck({ required: false, name: 'Optional e2e', type: 'E2E_TEST' }),
      ]);
      executor.run
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          outputTruncated: false,
          durationMs: 1,
          timedOut: false,
          cancelled: false,
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'flaky',
          outputTruncated: false,
          durationMs: 1,
          timedOut: false,
          cancelled: false,
        });

      await service.execute('attempt-1', context);

      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'PASSED' } }),
      );
    });

    it('fails the Task when a required check is unavailable (never silently skipped)', async () => {
      setupExecuteHappyPathMocks();
      planResolver.resolve.mockResolvedValue([
        buildCheck({
          command: '',
          args: [],
          unavailableReason: 'No script found.',
        }),
      ]);

      await service.execute('attempt-1', context);

      expect(executor.run).not.toHaveBeenCalled();
      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'FAILED' } }),
      );
    });

    it('skips (does not fail) an optional unavailable check', async () => {
      setupExecuteHappyPathMocks();
      planResolver.resolve.mockResolvedValue([
        buildCheck({
          required: false,
          command: '',
          args: [],
          unavailableReason: 'No script found.',
        }),
      ]);

      await service.execute('attempt-1', context);

      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'PASSED' } }),
      );
    });

    it('never commits when the workspace changed after validation commands ran (race protection)', async () => {
      setupExecuteHappyPathMocks();
      git.getStatus.mockReset();
      git.getStatus
        .mockResolvedValueOnce({
          clean: false,
          files: [{ path: 'src/a.ts', status: 'MODIFIED', staged: false }],
        }) // baseline
        .mockResolvedValueOnce({
          clean: false,
          files: [
            { path: 'src/a.ts', status: 'MODIFIED', staged: false },
            { path: 'src/unexpected.ts', status: 'MODIFIED', staged: false },
          ],
        }); // post-validation recheck

      await service.execute('attempt-1', context);

      expect(git.commit).not.toHaveBeenCalled();
      const attemptUpdateCalls = prisma.validationAttempt.update.mock.calls.map(
        (c: any[]) => c[0],
      );
      const failedUpdate = attemptUpdateCalls.find(
        (c: any) => c.data.status === 'FAILED',
      );
      expect(failedUpdate.data.errorCode).toBe(
        TaskValidationErrorCode.WORKSPACE_CHANGED_AFTER_VALIDATION,
      );
    });

    it('does not mark the Task PASSED when the commit itself fails', async () => {
      setupExecuteHappyPathMocks();
      git.commit.mockRejectedValue(
        new GitError({
          code: GitErrorCode.COMMIT_FAILED,
          message: 'commit failed',
        }),
      );

      await service.execute('attempt-1', context);

      expect(prisma.task.update).not.toHaveBeenCalled();
      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'FAILED' } }),
      );
    });

    it('does not mark the Task PASSED when the workspace is not clean after commit, but still records the real commit SHA', async () => {
      setupExecuteHappyPathMocks();
      git.getStatus.mockReset();
      git.getStatus
        .mockResolvedValueOnce({
          clean: false,
          files: [{ path: 'src/a.ts', status: 'MODIFIED', staged: false }],
        }) // baseline
        .mockResolvedValueOnce({
          clean: false,
          files: [{ path: 'src/a.ts', status: 'MODIFIED', staged: false }],
        }) // post-validation recheck (unchanged)
        .mockResolvedValueOnce({
          clean: false,
          files: [{ path: 'leftover.txt', status: 'UNTRACKED', staged: false }],
        }); // after commit

      await service.execute('attempt-1', context);

      expect(prisma.task.update).not.toHaveBeenCalled();
      const attemptUpdateCalls = prisma.validationAttempt.update.mock.calls.map(
        (c: any[]) => c[0],
      );
      const failedUpdate = attemptUpdateCalls.find(
        (c: any) => c.data.status === 'FAILED',
      );
      expect(failedUpdate.data.errorCode).toBe(
        TaskValidationErrorCode.WORKSPACE_NOT_CLEAN_AFTER_COMMIT,
      );
      expect(failedUpdate.data.commitSha).toBe('commit-sha-1');
    });

    it('passes with no commit when the Task legitimately required no changes', async () => {
      setupExecuteHappyPathMocks();
      prisma.taskExecution.findUniqueOrThrow.mockResolvedValue(
        buildExecution({ changedFiles: [] }),
      );
      git.getStatus.mockReset();
      git.getStatus.mockResolvedValue({ clean: true, files: [] });

      await service.execute('attempt-1', context);

      expect(git.commit).not.toHaveBeenCalled();
      expect(git.stageFiles).not.toHaveBeenCalled();
      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'PASSED' } }),
      );
    });

    it('leaves the Task untouched (still REVIEWING) when cancelled before starting', async () => {
      setupExecuteHappyPathMocks();
      context.isCancellationRequested.mockResolvedValue(true);

      await service.execute('attempt-1', context);

      expect(executor.run).not.toHaveBeenCalled();
      expect(prisma.task.update).not.toHaveBeenCalled();
      expect(prisma.task.updateMany).not.toHaveBeenCalled();
      const attemptUpdateCalls = prisma.validationAttempt.update.mock.calls.map(
        (c: any[]) => c[0],
      );
      expect(
        attemptUpdateCalls.some((c: any) => c.data.status === 'CANCELLED'),
      ).toBe(true);
    });

    it('cancels remaining checks mid-sequence and never commits', async () => {
      setupExecuteHappyPathMocks();
      planResolver.resolve.mockResolvedValue([
        buildCheck({ name: 'first' }),
        buildCheck({ name: 'second' }),
      ]);
      let calls = 0;
      context.isCancellationRequested.mockImplementation(() => {
        calls += 1;
        return Promise.resolve(calls > 1);
      });

      await service.execute('attempt-1', context);

      expect(git.commit).not.toHaveBeenCalled();
      expect(prisma.task.update).not.toHaveBeenCalled();
      expect(prisma.task.updateMany).not.toHaveBeenCalled();
    });

    it('never re-commits when the TaskExecution already has a commitSha (idempotent finalization)', async () => {
      setupExecuteHappyPathMocks();
      prisma.taskExecution.findUniqueOrThrow.mockResolvedValue(
        buildExecution({ commitSha: 'already-committed-sha' }),
      );

      await service.execute('attempt-1', context);

      expect(planResolver.resolve).not.toHaveBeenCalled();
      expect(executor.run).not.toHaveBeenCalled();
      expect(git.commit).not.toHaveBeenCalled();
      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'PASSED' } }),
      );
    });
  });
});
