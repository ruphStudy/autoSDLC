import { ExecutionMonitorService } from './execution-monitor.service';

function buildProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'project-1',
    userId: 'user-1',
    status: 'DEVELOPING',
    archivedAt: null,
    ...overrides,
  };
}

function buildSprint(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sprint-1',
    sprintPlanId: 'plan-1',
    number: 1,
    title: 'Foundations',
    objective: 'Ship the basics.',
    status: 'RUNNING',
    order: 1,
    ...overrides,
  };
}

function buildExecution(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'sprint-exec-1',
    projectId: 'project-1',
    sprintId: 'sprint-1',
    sprintPlanId: 'plan-1',
    attempt: 1,
    status: 'RUNNING',
    currentTaskId: null,
    pauseRequested: false,
    totalTasks: 5,
    passedTasks: 2,
    failedTasks: 0,
    blockedTasks: 0,
    repositoryStartSha: 'start-sha',
    repositoryEndSha: null,
    backgroundJobId: 'job-1',
    errorCode: null,
    errorMessage: null,
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildTaskExecution(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'task-exec-1',
    projectId: 'project-1',
    taskId: 'task-1',
    attempt: 1,
    status: 'RUNNING',
    taskInstructionId: null,
    agentJobId: null,
    changedFiles: null,
    gitDiff: null,
    gitDiffTruncated: false,
    errorCode: null,
    errorMessage: null,
    startedAt: new Date('2026-01-01T00:01:00.000Z'),
    completedAt: null,
    durationMs: null,
    commitSha: null,
    createdAt: new Date('2026-01-01T00:01:00.000Z'),
    updatedAt: new Date('2026-01-01T00:01:00.000Z'),
    ...overrides,
  };
}

describe('ExecutionMonitorService', () => {
  let prisma: any;
  let projectsService: any;
  let workspaceService: any;
  let git: any;
  let sprintExecutionService: any;
  let service: ExecutionMonitorService;

  beforeEach(() => {
    prisma = {
      sprintPlan: { findFirst: jest.fn().mockResolvedValue(null) },
      sprint: { findMany: jest.fn().mockResolvedValue([]) },
      sprintExecution: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      task: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      taskExecution: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      agentJob: {
        findUnique: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { inputTokens: null, outputTokens: null },
        }),
      },
      taskInstruction: {
        findUnique: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { inputTokens: null, outputTokens: null },
        }),
      },
      validationAttempt: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      projectWorkspace: { findUnique: jest.fn().mockResolvedValue(null) },
      sprintAcceptance: { findMany: jest.fn().mockResolvedValue([]) },
    };
    projectsService = {
      findOneForUser: jest.fn().mockResolvedValue(buildProject()),
    };
    workspaceService = {
      getReadyWorkspacePath: jest
        .fn()
        .mockRejectedValue(new Error('not ready')),
    };
    git = {
      getCurrentBranch: jest.fn(),
      getStatus: jest.fn(),
      getHeadCommitSha: jest.fn(),
    };
    sprintExecutionService = {
      getEligibility: jest.fn().mockResolvedValue({
        runnable: false,
        reasons: [],
        sprint: { id: '', status: 'PENDING' },
      }),
    };

    service = new ExecutionMonitorService(
      prisma,
      projectsService,
      workspaceService,
      git,
      sprintExecutionService,
    );
  });

  it('reports IDLE / no active execution when no SprintPlan exists yet', async () => {
    const overview = await service.getOverview('user-1', 'project-1');
    expect(overview.hasActiveExecution).toBe(false);
    expect(overview.activeSprintExecution).toBeNull();
    expect(overview.sprintProgress).toEqual([]);
  });

  it('resolves QUEUED phase for a queued SprintExecution', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprint.findMany.mockResolvedValue([buildSprint()]);
    prisma.sprintExecution.findFirst.mockResolvedValue(
      buildExecution({ status: 'QUEUED', currentTaskId: null }),
    );
    prisma.task.findMany.mockResolvedValue([]);

    const overview = await service.getOverview('user-1', 'project-1');
    expect(overview.hasActiveExecution).toBe(true);
    expect(overview.activeSprintExecution?.currentPhase).toBe('QUEUED');
    expect(overview.activeSprintExecution?.isLive).toBe(true);
  });

  it('resolves CODING phase for the current Task while the agent is running', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprint.findMany.mockResolvedValue([buildSprint()]);
    prisma.sprintExecution.findFirst.mockResolvedValue(
      buildExecution({ status: 'RUNNING', currentTaskId: 'task-1' }),
    );
    prisma.task.findMany.mockResolvedValue([
      { id: 'task-1', key: 'S1-T1', title: 'Add file A', status: 'RUNNING' },
    ]);
    prisma.task.findUnique.mockResolvedValue({
      id: 'task-1',
      key: 'S1-T1',
      title: 'Add file A',
      status: 'RUNNING',
    });
    prisma.taskExecution.findFirst.mockResolvedValue(
      buildTaskExecution({ status: 'RUNNING', agentJobId: 'agent-1' }),
    );
    prisma.agentJob.findUnique.mockResolvedValue({
      id: 'agent-1',
      provider: 'claude',
      model: 'claude-x',
      status: 'RUNNING',
      startedAt: new Date(),
      completedAt: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      turns: null,
      changedFiles: null,
      toolActivities: null,
      commandActivities: null,
      summary: null,
      errorCode: null,
      errorMessage: null,
    });

    const overview = await service.getOverview('user-1', 'project-1');
    expect(overview.activeSprintExecution?.currentPhase).toBe('CODING');
    expect(overview.agent?.status).toBe('RUNNING');
    expect(overview.currentTask?.key).toBe('S1-T1');
  });

  it('resolves VALIDATING phase while a required check is still running', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprint.findMany.mockResolvedValue([buildSprint()]);
    prisma.sprintExecution.findFirst.mockResolvedValue(
      buildExecution({ status: 'RUNNING', currentTaskId: 'task-1' }),
    );
    prisma.task.findMany.mockResolvedValue([
      { id: 'task-1', key: 'S1-T1', title: 'Add file A', status: 'REVIEWING' },
    ]);
    prisma.task.findUnique.mockResolvedValue({
      id: 'task-1',
      key: 'S1-T1',
      title: 'Add file A',
      status: 'REVIEWING',
    });
    prisma.taskExecution.findFirst.mockResolvedValue(
      buildTaskExecution({
        status: 'READY_FOR_VALIDATION',
        agentJobId: 'agent-1',
      }),
    );
    prisma.agentJob.findUnique.mockResolvedValue({
      id: 'agent-1',
      status: 'SUCCEEDED',
      provider: 'claude',
      model: null,
      startedAt: null,
      completedAt: new Date(),
      durationMs: 1000,
      inputTokens: 10,
      outputTokens: 20,
      turns: 3,
      changedFiles: [{ path: 'a.txt' }],
      toolActivities: null,
      commandActivities: null,
      summary: 'Added a file.',
      errorCode: null,
      errorMessage: null,
    });
    prisma.validationAttempt.findFirst.mockResolvedValue({
      id: 'val-1',
      attempt: 1,
      status: 'RUNNING',
      requiredPassed: 0,
      requiredFailed: 0,
      optionalPassed: 0,
      optionalFailed: 0,
      commitSha: null,
      errorCode: null,
      errorMessage: null,
      runs: [
        {
          status: 'RUNNING',
          type: 'LINT',
          name: 'lint',
          required: true,
          durationMs: null,
          exitCode: null,
        },
      ],
    });

    const overview = await service.getOverview('user-1', 'project-1');
    expect(overview.activeSprintExecution?.currentPhase).toBe('VALIDATING');
    expect(overview.validation?.checks).toHaveLength(1);
  });

  it('resolves PAUSED regardless of subordinate state', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprint.findMany.mockResolvedValue([buildSprint()]);
    prisma.sprintExecution.findFirst.mockResolvedValue(
      buildExecution({ status: 'PAUSED', pauseRequested: false }),
    );
    prisma.task.findMany.mockResolvedValue([]);

    const overview = await service.getOverview('user-1', 'project-1');
    expect(overview.activeSprintExecution?.currentPhase).toBe('PAUSED');
    expect(overview.activeSprintExecution?.isLive).toBe(true);
  });

  it('resolves BLOCKED and keeps isLive true (still an active status)', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprint.findMany.mockResolvedValue([buildSprint()]);
    prisma.sprintExecution.findFirst.mockResolvedValue(
      buildExecution({ status: 'BLOCKED' }),
    );
    prisma.task.findMany.mockResolvedValue([]);

    const overview = await service.getOverview('user-1', 'project-1');
    expect(overview.activeSprintExecution?.currentPhase).toBe('BLOCKED');
    expect(overview.activeSprintExecution?.isLive).toBe(true);
  });

  it('resolves FAILED and marks the execution as no longer live', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprint.findMany.mockResolvedValue([buildSprint()]);
    prisma.sprintExecution.findFirst.mockResolvedValue(
      buildExecution({
        status: 'FAILED',
        currentTaskId: 'task-1',
        errorCode: 'TASK_NOT_PASSED',
        errorMessage: 'S1-T1: failed',
      }),
    );
    prisma.task.findMany.mockResolvedValue([
      { id: 'task-1', key: 'S1-T1', title: 'Add file A', status: 'FAILED' },
    ]);
    prisma.task.findUnique.mockResolvedValue({
      id: 'task-1',
      key: 'S1-T1',
      title: 'Add file A',
      status: 'FAILED',
    });

    const overview = await service.getOverview('user-1', 'project-1');
    expect(overview.activeSprintExecution?.currentPhase).toBe('FAILED');
    expect(overview.activeSprintExecution?.isLive).toBe(false);
    expect(overview.hasActiveExecution).toBe(false);
    expect(overview.activeSprintExecution?.errorMessage).toBe('S1-T1: failed');
  });

  it('resolves COMPLETED for a finished Sprint', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprint.findMany.mockResolvedValue([
      buildSprint({ status: 'PASSED' }),
    ]);
    prisma.sprintExecution.findFirst.mockResolvedValue(
      buildExecution({
        status: 'COMPLETED',
        currentTaskId: null,
        passedTasks: 5,
        repositoryEndSha: 'end-sha',
        completedAt: new Date(),
      }),
    );
    prisma.task.findMany.mockResolvedValue([]);

    const overview = await service.getOverview('user-1', 'project-1');
    expect(overview.activeSprintExecution?.currentPhase).toBe('COMPLETED');
    expect(overview.activeSprintExecution?.progressPercent).toBe(100);
  });

  it('resolves CANCELLED for a cancelled Sprint execution', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprint.findMany.mockResolvedValue([buildSprint()]);
    prisma.sprintExecution.findFirst.mockResolvedValue(
      buildExecution({ status: 'CANCELLED' }),
    );
    prisma.task.findMany.mockResolvedValue([]);

    const overview = await service.getOverview('user-1', 'project-1');
    expect(overview.activeSprintExecution?.currentPhase).toBe('CANCELLED');
  });

  it('computes progressPercent from passedTasks/totalTasks', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprint.findMany.mockResolvedValue([buildSprint()]);
    prisma.sprintExecution.findFirst.mockResolvedValue(
      buildExecution({ totalTasks: 5, passedTasks: 2, currentTaskId: null }),
    );
    prisma.task.findMany.mockResolvedValue([]);

    const overview = await service.getOverview('user-1', 'project-1');
    expect(overview.activeSprintExecution?.progressPercent).toBe(40);
  });

  it('aggregates per-Sprint Task status counts for sprintProgress', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprint.findMany.mockResolvedValue([
      buildSprint({ id: 'sprint-1', number: 1 }),
    ]);
    prisma.sprintExecution.findFirst.mockResolvedValue(null);
    prisma.task.groupBy.mockResolvedValue([
      { sprintId: 'sprint-1', status: 'PASSED', _count: { _all: 2 } },
      { sprintId: 'sprint-1', status: 'RUNNING', _count: { _all: 1 } },
      { sprintId: 'sprint-1', status: 'PENDING', _count: { _all: 2 } },
    ]);

    const overview = await service.getOverview('user-1', 'project-1');
    expect(overview.sprintProgress).toHaveLength(1);
    expect(overview.sprintProgress[0]).toMatchObject({
      totalTasks: 5,
      passedTasks: 2,
      runningTasks: 1,
      remainingTasks: 3,
      progressPercent: 40,
    });
  });

  it('surfaces a lightweight acceptance summary per Sprint, flagging staleness against the live HEAD', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprint.findMany.mockResolvedValue([
      buildSprint({ id: 'sprint-1', number: 1, status: 'PASSED' }),
    ]);
    prisma.sprintExecution.findFirst.mockResolvedValue(null);
    prisma.task.groupBy.mockResolvedValue([
      { sprintId: 'sprint-1', status: 'PASSED', _count: { _all: 2 } },
    ]);
    prisma.sprintAcceptance.findMany.mockResolvedValue([
      {
        sprintId: 'sprint-1',
        status: 'READY_FOR_DECISION',
        recommendation: 'ACCEPT',
        repositoryHeadSha: 'old-sha',
        version: 2,
      },
    ]);
    prisma.projectWorkspace.findUnique.mockResolvedValue({ status: 'READY' });
    workspaceService.getReadyWorkspacePath.mockResolvedValue(
      '/workspaces/project-1',
    );
    git.getStatus.mockResolvedValue({ clean: true, files: [] });
    git.getHeadCommitSha.mockResolvedValue('new-sha');
    git.getCurrentBranch.mockResolvedValue('autodev/development');

    const overview = await service.getOverview('user-1', 'project-1');
    expect(overview.sprintProgress[0].acceptance).toEqual({
      status: 'READY_FOR_DECISION',
      recommendation: 'ACCEPT',
      stale: true,
      latestVersion: 2,
    });
  });

  it('reports acceptance as not stale when the live HEAD still matches', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprint.findMany.mockResolvedValue([
      buildSprint({ id: 'sprint-1', number: 1, status: 'PASSED' }),
    ]);
    prisma.sprintExecution.findFirst.mockResolvedValue(null);
    prisma.task.groupBy.mockResolvedValue([]);
    prisma.sprintAcceptance.findMany.mockResolvedValue([
      {
        sprintId: 'sprint-1',
        status: 'ACCEPTED',
        recommendation: 'ACCEPT',
        repositoryHeadSha: 'same-sha',
        version: 1,
      },
    ]);
    prisma.projectWorkspace.findUnique.mockResolvedValue({ status: 'READY' });
    workspaceService.getReadyWorkspacePath.mockResolvedValue(
      '/workspaces/project-1',
    );
    git.getStatus.mockResolvedValue({ clean: true, files: [] });
    git.getHeadCommitSha.mockResolvedValue('same-sha');
    git.getCurrentBranch.mockResolvedValue('autodev/development');

    const overview = await service.getOverview('user-1', 'project-1');
    expect(overview.sprintProgress[0].acceptance).toEqual({
      status: 'ACCEPTED',
      recommendation: 'ACCEPT',
      stale: false,
      latestVersion: 1,
    });
  });

  it('aggregates coding-agent and planning-AI usage without double counting', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprint.findMany.mockResolvedValue([buildSprint()]);
    prisma.sprintExecution.findFirst.mockResolvedValue(
      buildExecution({ currentTaskId: null }),
    );
    prisma.task.findMany.mockResolvedValue([
      { id: 'task-1', key: 'S1-T1', title: 'A', status: 'PASSED' },
      { id: 'task-2', key: 'S1-T2', title: 'B', status: 'PASSED' },
    ]);
    prisma.agentJob.aggregate.mockResolvedValue({
      _sum: { inputTokens: 1000, outputTokens: 500 },
    });
    prisma.taskInstruction.aggregate.mockResolvedValue({
      _sum: { inputTokens: 200, outputTokens: 100 },
    });

    const overview = await service.getOverview('user-1', 'project-1');
    expect(overview.usage.codingAgent).toEqual({
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    });
    expect(overview.usage.planningAi).toEqual({
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
    });
    expect(prisma.agentJob.aggregate).toHaveBeenCalledTimes(1);
  });

  it('builds commit history from TaskExecutions with a real commitSha', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprint.findMany.mockResolvedValue([buildSprint()]);
    prisma.sprintExecution.findFirst.mockResolvedValue(null);
    prisma.taskExecution.findMany.mockImplementation((args: any) => {
      if (args?.where?.commitSha) {
        return Promise.resolve([
          {
            id: 'exec-1',
            taskId: 'task-1',
            commitSha: 'abc1234',
            completedAt: new Date('2026-01-01T00:05:00.000Z'),
            changedFiles: [{ path: 'a.txt' }],
            task: { key: 'S1-T1', title: 'Add file A' },
          },
        ]);
      }
      return Promise.resolve([]);
    });
    prisma.validationAttempt.findMany.mockResolvedValue([
      { taskExecutionId: 'exec-1', attempt: 1 },
    ]);

    const overview = await service.getOverview('user-1', 'project-1');
    expect(overview.recentCommits).toEqual([
      {
        taskId: 'task-1',
        taskKey: 'S1-T1',
        taskTitle: 'Add file A',
        commitSha: 'abc1234',
        committedAt: '2026-01-01T00:05:00.000Z',
        validationAttempt: 1,
        changedFileCount: 1,
      },
    ]);
  });

  it('orders the timeline newest first', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprintExecution.findMany.mockResolvedValue([
      {
        id: 'exec-1',
        sprintId: 'sprint-1',
        status: 'COMPLETED',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        completedAt: new Date('2026-01-01T00:10:00.000Z'),
        errorMessage: null,
        sprint: { number: 1, title: 'Foundations' },
      },
    ]);

    const page = await service.getTimeline('user-1', 'project-1', {});
    expect(page.events.length).toBeGreaterThanOrEqual(2);
    const timestamps = page.events.map((e) => e.timestamp);
    const sorted = [...timestamps].sort().reverse();
    expect(timestamps).toEqual(sorted);
  });

  it('bounds the timeline to the requested limit and returns a cursor', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprintExecution.findMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `exec-${i}`,
        sprintId: 'sprint-1',
        status: 'COMPLETED',
        startedAt: new Date(2026, 0, 1, 0, i),
        completedAt: new Date(2026, 0, 1, 0, i, 30),
        errorMessage: null,
        sprint: { number: 1, title: 'Foundations' },
      })),
    );

    const page = await service.getTimeline('user-1', 'project-1', { limit: 3 });
    expect(page.events).toHaveLength(3);
    expect(page.nextCursor).not.toBeNull();
  });

  it('selects only the most recent SprintExecution as the active one', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprint.findMany.mockResolvedValue([buildSprint()]);
    prisma.sprintExecution.findFirst.mockResolvedValue(
      buildExecution({ attempt: 2, status: 'RUNNING' }),
    );
    prisma.task.findMany.mockResolvedValue([]);

    const overview = await service.getOverview('user-1', 'project-1');
    expect(overview.activeSprintExecution?.attempt).toBe(2);
    expect(prisma.sprintExecution.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'desc' }] }),
    );
  });

  it('shows a historical (non-live) summary when the latest execution is terminal', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprint.findMany.mockResolvedValue([buildSprint()]);
    prisma.sprintExecution.findFirst.mockResolvedValue(
      buildExecution({ status: 'COMPLETED', currentTaskId: null }),
    );
    prisma.task.findMany.mockResolvedValue([]);

    const overview = await service.getOverview('user-1', 'project-1');
    expect(overview.activeSprintExecution).not.toBeNull();
    expect(overview.activeSprintExecution?.isLive).toBe(false);
    expect(overview.hasActiveExecution).toBe(false);
  });

  it('returns multiple Sprint execution attempts newest-first from history', async () => {
    prisma.sprintExecution.findMany.mockResolvedValue([
      {
        id: 'exec-2',
        sprintId: 'sprint-1',
        attempt: 2,
        status: 'COMPLETED',
        startedAt: new Date('2026-01-02T00:00:00.000Z'),
        completedAt: new Date('2026-01-02T01:00:00.000Z'),
        totalTasks: 5,
        passedTasks: 5,
        repositoryStartSha: 'sha-2',
        repositoryEndSha: 'sha-2-end',
        errorCode: null,
        errorMessage: null,
        sprint: { number: 1, title: 'Foundations' },
      },
      {
        id: 'exec-1',
        sprintId: 'sprint-1',
        attempt: 1,
        status: 'FAILED',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        completedAt: new Date('2026-01-01T00:30:00.000Z'),
        totalTasks: 5,
        passedTasks: 1,
        repositoryStartSha: 'sha-1',
        repositoryEndSha: null,
        errorCode: 'TASK_NOT_PASSED',
        errorMessage: 'S1-T2: failed',
        sprint: { number: 1, title: 'Foundations' },
      },
    ]);

    const history = await service.getHistory('user-1', 'project-1', {});
    expect(history.executions.map((e) => e.attempt)).toEqual([2, 1]);
  });

  it("never returns another user's project (ownership enforced upstream)", async () => {
    projectsService.findOneForUser.mockRejectedValue(new Error('not found'));
    await expect(service.getOverview('user-2', 'project-1')).rejects.toThrow(
      'not found',
    );
  });

  it('surfaces the next eligible Sprint only when nothing is currently active', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprint.findMany.mockResolvedValue([
      buildSprint({ id: 'sprint-1', number: 1, status: 'PASSED' }),
      buildSprint({ id: 'sprint-2', number: 2, status: 'PENDING' }),
    ]);
    prisma.sprintExecution.findFirst.mockResolvedValue(null);
    sprintExecutionService.getEligibility.mockImplementation(
      (_u: string, _p: string, sprintId: string) =>
        Promise.resolve({
          runnable: sprintId === 'sprint-2',
          reasons: [],
          sprint: { id: sprintId, status: 'PENDING' },
        }),
    );

    const overview = await service.getOverview('user-1', 'project-1');
    expect(overview.nextSprintEligible).toEqual({
      sprintId: 'sprint-2',
      number: 2,
      title: 'Foundations',
    });
  });

  it('does not surface a next-Sprint suggestion while a Sprint is actively running', async () => {
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    prisma.sprint.findMany.mockResolvedValue([buildSprint()]);
    prisma.sprintExecution.findFirst.mockResolvedValue(
      buildExecution({ status: 'RUNNING', currentTaskId: null }),
    );
    prisma.task.findMany.mockResolvedValue([]);

    const overview = await service.getOverview('user-1', 'project-1');
    expect(overview.nextSprintEligible).toBeNull();
    expect(sprintExecutionService.getEligibility).not.toHaveBeenCalled();
  });
});
