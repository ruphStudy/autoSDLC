import { SprintExecutionService } from './sprint-execution.service';
import { SprintExecutionErrorCode } from './errors/sprint-execution.error';
import {
  ApprovalError,
  ApprovalErrorCode,
} from '../approval/errors/approval.error';

function buildProject(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 'project-1', userId: 'user-1', archivedAt: null, ...overrides };
}

function buildSprint(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sprint-1',
    sprintPlanId: 'plan-1',
    status: 'PENDING',
    dependencies: [],
    ...overrides,
  };
}

function buildTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'task-a',
    key: 'S1-T1',
    title: 'Task A',
    sprintId: 'sprint-1',
    sprintPlanId: 'plan-1',
    order: 1,
    status: 'PENDING',
    dependencies: [],
    ...overrides,
  };
}

function buildExecution(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    id: 'sprint-exec-1',
    projectId: 'project-1',
    sprintId: 'sprint-1',
    sprintPlanId: 'plan-1',
    attempt: 1,
    status: 'QUEUED',
    currentTaskId: null,
    pauseRequested: false,
    totalTasks: 2,
    passedTasks: 0,
    failedTasks: 0,
    blockedTasks: 0,
    repositoryStartSha: 'sha-start',
    repositoryEndSha: null,
    backgroundJobId: null,
    errorCode: null,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function taskExecResult(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 'texec-1', status: 'READY_FOR_VALIDATION', ...overrides };
}

function validationResult(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 'vattempt-1', status: 'PASSED', ...overrides };
}

describe('SprintExecutionService', () => {
  let prisma: any;
  let projectsService: any;
  let approvalService: any;
  let workspaceService: any;
  let git: any;
  let jobService: any;
  let taskExecutionService: any;
  let taskValidationService: any;
  let sprintAcceptanceService: any;
  let context: any;
  let service: SprintExecutionService;

  beforeEach(() => {
    prisma = {
      sprint: {
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      sprintPlan: { findFirst: jest.fn() },
      sprintExecution: {
        create: jest.fn(),
        update: jest
          .fn()
          .mockImplementation((args: any) =>
            buildExecution({ id: args.where.id, ...args.data }),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _max: { attempt: null } }),
      },
      task: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(2),
      },
      taskExecution: { findFirst: jest.fn(), update: jest.fn() },
      projectWorkspace: { findUnique: jest.fn() },
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
    };
    jobService = { enqueue: jest.fn() };
    taskExecutionService = {
      beginForOrchestrator: jest.fn(),
      execute: jest.fn(),
    };
    taskValidationService = {
      beginForOrchestrator: jest.fn(),
      execute: jest.fn(),
    };
    sprintAcceptanceService = {
      getGateStatus: jest
        .fn()
        .mockResolvedValue({ accepted: true, status: 'ACCEPTED', version: 1 }),
    };
    context = {
      reportProgress: jest.fn().mockResolvedValue(undefined),
      isCancellationRequested: jest.fn().mockResolvedValue(false),
      heartbeat: jest.fn().mockResolvedValue(undefined),
    };

    service = new SprintExecutionService(
      prisma,
      projectsService,
      approvalService,
      workspaceService,
      git,
      jobService,
      taskExecutionService,
      taskValidationService,
      sprintAcceptanceService,
    );
  });

  function setupEligibleMocks() {
    projectsService.findOneForUser.mockResolvedValue(buildProject());
    prisma.sprint.findFirst.mockResolvedValue(buildSprint());
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprintExecution.findFirst.mockResolvedValue(null);
    workspaceService.getReadyWorkspacePath.mockResolvedValue(
      '/workspaces/project-1',
    );
    prisma.projectWorkspace.findUnique.mockResolvedValue({
      developmentBranch: 'autodev/development',
    });
    git.getCurrentBranch.mockResolvedValue('autodev/development');
    git.getStatus.mockResolvedValue({ clean: true, files: [] });
  }

  describe('getEligibility', () => {
    it('is runnable when every gate passes', async () => {
      setupEligibleMocks();
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.runnable).toBe(true);
      expect(result.reasons).toEqual([]);
    });

    it('flags an archived project', async () => {
      setupEligibleMocks();
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ archivedAt: new Date() }),
      );
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.reasons).toContain(
        SprintExecutionErrorCode.PROJECT_ARCHIVED,
      );
    });

    it('flags a Sprint belonging to a superseded plan', async () => {
      setupEligibleMocks();
      prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-2' });
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.reasons).toContain(
        SprintExecutionErrorCode.SPRINT_NOT_IN_CURRENT_PLAN,
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
        'sprint-1',
      );
      expect(result.reasons).toContain(
        SprintExecutionErrorCode.DEVELOPMENT_NOT_APPROVED,
      );
    });

    it('flags an already-PASSED Sprint', async () => {
      setupEligibleMocks();
      prisma.sprint.findFirst.mockResolvedValue(
        buildSprint({ status: 'PASSED' }),
      );
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.reasons).toContain(
        SprintExecutionErrorCode.SPRINT_ALREADY_PASSED,
      );
    });

    it('flags an unmet Sprint dependency (only exactly PASSED satisfies it)', async () => {
      setupEligibleMocks();
      prisma.sprint.findFirst.mockResolvedValue(
        buildSprint({
          dependencies: [{ dependsOnSprint: { status: 'RUNNING' } }],
        }),
      );
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.reasons).toContain(
        SprintExecutionErrorCode.SPRINT_DEPENDENCY_NOT_PASSED,
      );
    });

    // Sprint 16's dependency-acceptance gate (item 58/59/89) — a prerequisite
    // Sprint that mechanically PASSED but was not formally ACCEPTED still
    // blocks the dependent Sprint from starting.
    it('flags a Sprint dependency that PASSED but was not yet ACCEPTED', async () => {
      setupEligibleMocks();
      prisma.sprint.findFirst.mockResolvedValue(
        buildSprint({
          dependencies: [
            { dependsOnSprint: { id: 'sprint-0', status: 'PASSED' } },
          ],
        }),
      );
      sprintAcceptanceService.getGateStatus.mockResolvedValue({
        accepted: false,
        status: 'READY_FOR_DECISION',
        version: 1,
      });
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.reasons).toContain(
        SprintExecutionErrorCode.SPRINT_DEPENDENCY_NOT_ACCEPTED,
      );
      expect(sprintAcceptanceService.getGateStatus).toHaveBeenCalledWith(
        'sprint-0',
      );
    });

    it('is runnable once the prerequisite Sprint dependency is both PASSED and ACCEPTED', async () => {
      setupEligibleMocks();
      prisma.sprint.findFirst.mockResolvedValue(
        buildSprint({
          dependencies: [
            { dependsOnSprint: { id: 'sprint-0', status: 'PASSED' } },
          ],
        }),
      );
      sprintAcceptanceService.getGateStatus.mockResolvedValue({
        accepted: true,
        status: 'ACCEPTED',
        version: 1,
      });
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.runnable).toBe(true);
      expect(result.reasons).toEqual([]);
    });

    it('flags this Sprint already having an active execution', async () => {
      setupEligibleMocks();
      prisma.sprintExecution.findFirst.mockResolvedValue(
        buildExecution({ status: 'RUNNING' }),
      );
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.reasons).toContain(
        SprintExecutionErrorCode.SPRINT_ALREADY_ACTIVE,
      );
    });

    it('flags a different Sprint in the project being active (only one Sprint executes at a time)', async () => {
      setupEligibleMocks();
      prisma.sprintExecution.findFirst
        .mockResolvedValueOnce(null) // reconcile check
        .mockResolvedValueOnce(null) // this-sprint active check
        .mockResolvedValueOnce(
          buildExecution({ sprintId: 'sprint-2', status: 'RUNNING' }),
        ); // other-sprint check

      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.reasons).toContain(
        SprintExecutionErrorCode.OTHER_SPRINT_ACTIVE,
      );
    });

    it('flags a dirty workspace', async () => {
      setupEligibleMocks();
      git.getStatus.mockResolvedValue({
        clean: false,
        files: [{ path: 'a.txt' }],
      });
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.reasons).toContain(
        SprintExecutionErrorCode.WORKSPACE_DIRTY,
      );
    });

    it('flags the wrong branch', async () => {
      setupEligibleMocks();
      git.getCurrentBranch.mockResolvedValue('main');
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.reasons).toContain(SprintExecutionErrorCode.WRONG_BRANCH);
    });
  });

  describe('run', () => {
    it('creates a QUEUED SprintExecution and enqueues a SPRINT_EXECUTION job', async () => {
      setupEligibleMocks();
      prisma.sprint.findUniqueOrThrow.mockResolvedValue(buildSprint());
      git.getHeadCommitSha.mockResolvedValue('sha-start');
      prisma.sprintExecution.create.mockResolvedValue(buildExecution());
      jobService.enqueue.mockResolvedValue({ id: 'job-1' });

      const result = await service.run('user-1', 'project-1', 'sprint-1');

      expect(prisma.sprintExecution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            attempt: 1,
            totalTasks: 2,
            repositoryStartSha: 'sha-start',
          }),
        }),
      );
      expect(jobService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SPRINT_EXECUTION', maxAttempts: 1 }),
      );
      expect(result.job.id).toBe('job-1');
    });

    it('rejects when not eligible', async () => {
      setupEligibleMocks();
      prisma.sprint.findFirst.mockResolvedValue(
        buildSprint({ status: 'PASSED' }),
      );

      await expect(
        service.run('user-1', 'project-1', 'sprint-1'),
      ).rejects.toBeInstanceOf(Error);
      expect(prisma.sprintExecution.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate concurrent run request', async () => {
      setupEligibleMocks();
      prisma.sprint.findUniqueOrThrow.mockResolvedValue(buildSprint());
      git.getHeadCommitSha.mockResolvedValue('sha-start');
      prisma.sprintExecution.findFirst
        .mockResolvedValueOnce(null) // reconcile
        .mockResolvedValueOnce(null) // eligibility this-sprint
        .mockResolvedValueOnce(null) // eligibility other-sprint
        .mockResolvedValueOnce(buildExecution({ status: 'RUNNING' })); // inside the create transaction

      await expect(
        service.run('user-1', 'project-1', 'sprint-1'),
      ).rejects.toBeInstanceOf(Error);
      expect(prisma.sprintExecution.create).not.toHaveBeenCalled();
    });
  });

  describe('pause / resume', () => {
    it('sets pauseRequested on the RUNNING execution', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.sprintExecution.findFirst.mockResolvedValue(
        buildExecution({ status: 'RUNNING' }),
      );

      await service.pause('user-1', 'project-1', 'sprint-1');

      expect(prisma.sprintExecution.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { pauseRequested: true } }),
      );
    });

    it('rejects pausing when there is no RUNNING execution', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.sprintExecution.findFirst.mockResolvedValue(null);

      await expect(
        service.pause('user-1', 'project-1', 'sprint-1'),
      ).rejects.toBeInstanceOf(Error);
    });

    it('resumes a PAUSED execution by re-validating and enqueueing a fresh job', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.sprintExecution.findFirst
        .mockResolvedValueOnce(null) // reconcile
        .mockResolvedValueOnce(buildExecution({ status: 'PAUSED' })); // the resumable lookup
      workspaceService.getReadyWorkspacePath.mockResolvedValue(
        '/workspaces/project-1',
      );
      jobService.enqueue.mockResolvedValue({ id: 'job-2' });

      const result = await service.resume('user-1', 'project-1', 'sprint-1');

      expect(jobService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SPRINT_EXECUTION', maxAttempts: 1 }),
      );
      expect(result.job.id).toBe('job-2');
    });

    it('rejects resuming when there is nothing PAUSED or BLOCKED', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.sprintExecution.findFirst.mockResolvedValue(null);

      await expect(
        service.resume('user-1', 'project-1', 'sprint-1'),
      ).rejects.toBeInstanceOf(Error);
    });
  });

  describe('execute (the orchestration loop)', () => {
    function setupLoopMocks() {
      prisma.sprintExecution.findUniqueOrThrow.mockResolvedValue(
        buildExecution(),
      );
      workspaceService.getReadyWorkspacePath.mockResolvedValue(
        '/workspaces/project-1',
      );
      approvalService.assertDevelopmentApproved.mockResolvedValue(undefined);
      git.getStatus.mockResolvedValue({ clean: true, files: [] });
      git.getHeadCommitSha.mockResolvedValue('sha-final');
      taskExecutionService.beginForOrchestrator.mockResolvedValue({
        id: 'texec-1',
      });
      taskExecutionService.execute.mockResolvedValue(taskExecResult());
      taskValidationService.beginForOrchestrator.mockResolvedValue({
        id: 'vattempt-1',
      });
      taskValidationService.execute.mockResolvedValue(validationResult());
    }

    it('executes two independent Tasks strictly sequentially (never in parallel) and completes the Sprint', async () => {
      setupLoopMocks();
      const taskA = buildTask({ id: 'task-a', key: 'S1-T1', order: 1 });
      const taskB = buildTask({ id: 'task-b', key: 'S1-T2', order: 2 });
      const callOrder: string[] = [];

      const bothPassed = [
        { ...taskA, status: 'PASSED' },
        { ...taskB, status: 'PASSED' },
      ];
      prisma.task.findMany
        .mockResolvedValueOnce([taskA, taskB]) // iteration 1: find next runnable
        .mockResolvedValueOnce([{ ...taskA, status: 'PASSED' }, taskB]) // iteration 2: find next runnable
        .mockResolvedValueOnce(bothPassed) // iteration 3: find next runnable -> none
        .mockResolvedValueOnce(bothPassed); // iteration 3: all-tasks-passed check

      taskExecutionService.beginForOrchestrator.mockImplementation(
        async (_p: string, taskId: string) => {
          callOrder.push(`begin-exec-${taskId}`);
          return { id: `texec-${taskId}` };
        },
      );
      taskExecutionService.execute.mockImplementation(async (id: string) => {
        callOrder.push(`exec-${id}`);
        return taskExecResult();
      });
      taskValidationService.beginForOrchestrator.mockImplementation(
        async (_p: string, taskId: string) => {
          callOrder.push(`begin-val-${taskId}`);
          return { id: `vattempt-${taskId}` };
        },
      );
      taskValidationService.execute.mockImplementation(async (id: string) => {
        callOrder.push(`val-${id}`);
        return validationResult();
      });

      const record = await service.execute('sprint-exec-1', context);

      expect(record.status).toBe('COMPLETED');
      expect(callOrder).toEqual([
        'begin-exec-task-a',
        'exec-texec-task-a',
        'begin-val-task-a',
        'val-vattempt-task-a',
        'begin-exec-task-b',
        'exec-texec-task-b',
        'begin-val-task-b',
        'val-vattempt-task-b',
      ]);
    });

    it('respects dependency ordering: a dependent Task never starts before its dependency has PASSED', async () => {
      setupLoopMocks();
      const taskA = buildTask({ id: 'task-a', key: 'S1-T1', order: 1 });
      const taskB = buildTask({
        id: 'task-b',
        key: 'S1-T2',
        order: 2,
        dependencies: [{ dependsOnTask: { status: 'PENDING' } }],
      });

      const bothPassed = [
        { ...taskA, status: 'PASSED' },
        { ...taskB, status: 'PASSED' },
      ];
      prisma.task.findMany
        .mockImplementationOnce(async () => [
          taskA,
          {
            ...taskB,
            dependencies: [{ dependsOnTask: { status: 'PENDING' } }],
          },
        ])
        .mockImplementationOnce(async () => [
          { ...taskA, status: 'PASSED' },
          { ...taskB, dependencies: [{ dependsOnTask: { status: 'PASSED' } }] },
        ])
        .mockImplementationOnce(async () => bothPassed)
        .mockImplementationOnce(async () => bothPassed);

      const record = await service.execute('sprint-exec-1', context);

      expect(record.status).toBe('COMPLETED');
      expect(
        taskExecutionService.beginForOrchestrator.mock.calls.map(
          (c: any[]) => c[1],
        ),
      ).toEqual(['task-a', 'task-b']);
    });

    it('stops the Sprint (FAILED) when Task execution does not reach REVIEWING, and never starts the next Task', async () => {
      setupLoopMocks();
      const taskA = buildTask({ id: 'task-a', key: 'S1-T1', order: 1 });
      const taskB = buildTask({ id: 'task-b', key: 'S1-T2', order: 2 });
      prisma.task.findMany.mockResolvedValueOnce([taskA, taskB]);
      taskExecutionService.execute.mockResolvedValue(
        taskExecResult({ status: 'FAILED' }),
      );

      const record = await service.execute('sprint-exec-1', context);

      expect(record.status).toBe('FAILED');
      expect(record.errorCode).toBe(SprintExecutionErrorCode.TASK_NOT_PASSED);
      expect(taskValidationService.beginForOrchestrator).not.toHaveBeenCalled();
      expect(taskExecutionService.beginForOrchestrator).toHaveBeenCalledTimes(
        1,
      );
    });

    it('stops the Sprint (FAILED) when Task validation does not pass, and never starts the next Task', async () => {
      setupLoopMocks();
      const taskA = buildTask({ id: 'task-a', key: 'S1-T1', order: 1 });
      const taskB = buildTask({ id: 'task-b', key: 'S1-T2', order: 2 });
      prisma.task.findMany.mockResolvedValueOnce([taskA, taskB]);
      taskValidationService.execute.mockResolvedValue(
        validationResult({ status: 'FAILED' }),
      );

      const record = await service.execute('sprint-exec-1', context);

      expect(record.status).toBe('FAILED');
      expect(taskExecutionService.beginForOrchestrator).toHaveBeenCalledTimes(
        1,
      );
    });

    it('marks the Sprint BLOCKED when no Task is runnable but not every Task has passed (dependency deadlock)', async () => {
      setupLoopMocks();
      const taskA = buildTask({ id: 'task-a', status: 'FAILED' });
      const taskB = buildTask({
        id: 'task-b',
        status: 'PENDING',
        dependencies: [{ dependsOnTask: { status: 'FAILED' } }],
      });
      prisma.task.findMany.mockResolvedValue([taskA, taskB]);

      const record = await service.execute('sprint-exec-1', context);

      expect(record.status).toBe('BLOCKED');
      expect(record.errorCode).toBe(SprintExecutionErrorCode.NO_RUNNABLE_TASKS);
      expect(taskExecutionService.beginForOrchestrator).not.toHaveBeenCalled();
    });

    it('marks the Sprint FAILED when the workspace is not clean after a Task passes', async () => {
      setupLoopMocks();
      const taskA = buildTask({ id: 'task-a' });
      prisma.task.findMany.mockResolvedValueOnce([taskA]);
      git.getStatus.mockResolvedValue({
        clean: false,
        files: [{ path: 'stray.txt' }],
      });

      const record = await service.execute('sprint-exec-1', context);

      expect(record.status).toBe('FAILED');
      expect(record.errorCode).toBe(
        SprintExecutionErrorCode.WORKSPACE_NOT_CLEAN_AFTER_TASK,
      );
    });

    it('stops as CANCELLED when cancellation is requested before any Task starts', async () => {
      setupLoopMocks();
      context.isCancellationRequested.mockResolvedValue(true);

      const record = await service.execute('sprint-exec-1', context);

      expect(record.status).toBe('CANCELLED');
      expect(taskExecutionService.beginForOrchestrator).not.toHaveBeenCalled();
    });

    it('pauses at the Task boundary (never mid-Task) when pauseRequested is set', async () => {
      setupLoopMocks();
      const taskA = buildTask({ id: 'task-a' });
      prisma.task.findMany.mockResolvedValueOnce([taskA]);
      // Call 1: the initial load outside the loop. Call 2: iteration 1's
      // pause check (must be false, so Task A is allowed to fully execute
      // + validate + commit). Call 3: iteration 2's pause check, now true
      // — pause must take effect only here, at the boundary after Task A
      // already passed, never interrupting Task A itself.
      prisma.sprintExecution.findUniqueOrThrow
        .mockResolvedValueOnce(buildExecution({ pauseRequested: false }))
        .mockResolvedValueOnce(buildExecution({ pauseRequested: false }))
        .mockResolvedValueOnce(buildExecution({ pauseRequested: true }));

      const record = await service.execute('sprint-exec-1', context);

      expect(record.status).toBe('PAUSED');
      // Task A's full execute+validate cycle still ran to completion before the pause took effect.
      expect(taskExecutionService.beginForOrchestrator).toHaveBeenCalledTimes(
        1,
      );
      expect(taskValidationService.beginForOrchestrator).toHaveBeenCalledTimes(
        1,
      );
    });
  });
});
