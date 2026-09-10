import { ProjectDeliveryEvidenceBuilder } from './evidence-builder.service';

function buildSprint(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sprint-1',
    number: 1,
    title: 'Foundations',
    status: 'PASSED',
    order: 1,
    ...overrides,
  };
}

function buildTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'task-1',
    key: 'S1-T1',
    sprintId: 'sprint-1',
    status: 'PASSED',
    requirementIds: ['FR-001'],
    order: 1,
    ...overrides,
  };
}

describe('ProjectDeliveryEvidenceBuilder', () => {
  let prisma: any;
  let workspaceService: any;
  let git: any;
  let builder: ProjectDeliveryEvidenceBuilder;

  beforeEach(() => {
    prisma = {
      project: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'project-1', name: 'My Project' }),
      },
      sprintPlan: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'plan-1',
          version: 1,
          architectureId: 'arch-1',
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      architecture: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'arch-1',
          version: 1,
          projectAnalysisId: 'analysis-1',
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      projectAnalysis: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'analysis-1',
          version: 1,
          functionalRequirements: [{ id: 'FR-001', title: 'Do the thing' }],
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      sprint: { findMany: jest.fn().mockResolvedValue([buildSprint()]) },
      sprintExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'exec-1',
            sprintId: 'sprint-1',
            attempt: 1,
            repositoryEndSha: 'end-sha',
            completedAt: new Date('2026-01-01T01:00:00.000Z'),
          },
        ]),
      },
      sprintAcceptance: {
        findMany: jest.fn().mockResolvedValue([
          {
            sprintId: 'sprint-1',
            version: 1,
            status: 'ACCEPTED',
            recommendation: 'ACCEPT',
          },
        ]),
      },
      task: { findMany: jest.fn().mockResolvedValue([buildTask()]) },
      taskExecution: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { taskId: 'task-1', attempt: 1, commitSha: 'commit-sha-1' },
          ]),
      },
      validationAttempt: {
        findMany: jest.fn().mockResolvedValue([
          {
            taskId: 'task-1',
            attempt: 1,
            runs: [{ required: true, status: 'PASSED' }],
          },
        ]),
      },
      taskInstruction: { findMany: jest.fn().mockResolvedValue([]) },
      agentJob: { findMany: jest.fn().mockResolvedValue([]) },
    };
    workspaceService = {
      getReadyWorkspacePath: jest
        .fn()
        .mockResolvedValue('/workspaces/project-1'),
    };
    git = {
      getStatus: jest.fn().mockResolvedValue({ clean: true, files: [] }),
      getHeadCommitSha: jest.fn().mockResolvedValue('end-sha'),
      getCurrentBranch: jest.fn().mockResolvedValue('autodev/development'),
    };
    builder = new ProjectDeliveryEvidenceBuilder(prisma, workspaceService, git);
  });

  it('walks the current SprintPlan/Architecture/ProjectAnalysis lineage', async () => {
    const { evidence } = await builder.build('project-1', 'plan-1');
    expect(evidence.sprintPlan).toEqual({ id: 'plan-1', version: 1 });
    expect(evidence.projectAnalysis).toEqual({ id: 'analysis-1', version: 1 });
    expect(prisma.architecture.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'arch-1' },
    });
  });

  it('builds one requiredSprint entry per Sprint in the plan with its latest execution and acceptance', async () => {
    const { evidence } = await builder.build('project-1', 'plan-1');
    expect(evidence.requiredSprints).toEqual([
      {
        sprintId: 'sprint-1',
        number: 1,
        title: 'Foundations',
        status: 'PASSED',
        sprintExecutionId: 'exec-1',
        sprintExecutionAttempt: 1,
        repositoryEndSha: 'end-sha',
        completedAt: '2026-01-01T01:00:00.000Z',
        acceptanceVersion: 1,
        acceptanceStatus: 'ACCEPTED',
      },
    ]);
  });

  it('uses the latest execution/acceptance per Sprint, not the first row returned', async () => {
    prisma.sprintExecution.findMany.mockResolvedValue([
      {
        id: 'exec-2',
        sprintId: 'sprint-1',
        attempt: 2,
        repositoryEndSha: 'end-sha-2',
        completedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      {
        id: 'exec-1',
        sprintId: 'sprint-1',
        attempt: 1,
        repositoryEndSha: 'end-sha-1',
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    const { evidence } = await builder.build('project-1', 'plan-1');
    expect(evidence.requiredSprints[0].sprintExecutionId).toBe('exec-2');
    expect(evidence.requiredSprints[0].repositoryEndSha).toBe('end-sha-2');
  });

  it('resolves the authoritative final SHA as the last-completed required Sprint execution, not array order', async () => {
    prisma.sprint.findMany.mockResolvedValue([
      buildSprint({ id: 'sprint-1', number: 1, order: 1 }),
      buildSprint({ id: 'sprint-2', number: 2, order: 2 }),
    ]);
    prisma.sprintExecution.findMany.mockResolvedValue([
      {
        id: 'exec-1',
        sprintId: 'sprint-1',
        attempt: 1,
        repositoryEndSha: 'sha-late',
        completedAt: new Date('2026-01-05T00:00:00.000Z'),
      },
      {
        id: 'exec-2',
        sprintId: 'sprint-2',
        attempt: 1,
        repositoryEndSha: 'sha-early',
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    prisma.sprintAcceptance.findMany.mockResolvedValue([
      { sprintId: 'sprint-1', version: 1, status: 'ACCEPTED' },
      { sprintId: 'sprint-2', version: 1, status: 'ACCEPTED' },
    ]);
    const { evidence } = await builder.build('project-1', 'plan-1');
    // sprint-1 (array index 0, "later" Sprint.order) finished BEFORE
    // sprint-2 in wall-clock time — the resolver must pick sprint-2's SHA
    // (last completedAt), never "the last Sprint in the returned array".
    expect(evidence.resolvedFinalSha).toBe('sha-late');
  });

  it('reports requirement coverage as covered only when a PASSED Task belongs to an ACCEPTED Sprint', async () => {
    const { evidence } = await builder.build('project-1', 'plan-1');
    expect(evidence.requirementCoverage).toEqual([
      {
        requirementId: 'FR-001',
        title: 'Do the thing',
        covered: true,
        taskKeys: ['S1-T1'],
      },
    ]);
  });

  it('flags a requirement as not covered when its owning Sprint is not yet ACCEPTED', async () => {
    prisma.sprintAcceptance.findMany.mockResolvedValue([
      { sprintId: 'sprint-1', version: 1, status: 'READY_FOR_DECISION' },
    ]);
    const { evidence } = await builder.build('project-1', 'plan-1');
    expect(evidence.requirementCoverage[0].covered).toBe(false);
  });

  it('flags a requirement as not covered when it has no owning Task at all', async () => {
    prisma.projectAnalysis.findUniqueOrThrow.mockResolvedValue({
      id: 'analysis-1',
      version: 1,
      functionalRequirements: [
        { id: 'FR-001', title: 'Do the thing' },
        { id: 'FR-999', title: 'Never implemented' },
      ],
    });
    const { evidence } = await builder.build('project-1', 'plan-1');
    const fr999 = evidence.requirementCoverage.find(
      (r) => r.requirementId === 'FR-999',
    );
    expect(fr999).toEqual({
      requirementId: 'FR-999',
      title: 'Never implemented',
      covered: false,
      taskKeys: [],
    });
  });

  it('summarizes Task pass/fail counts across the whole plan', async () => {
    prisma.task.findMany.mockResolvedValue([
      buildTask({ id: 'task-1', key: 'S1-T1', status: 'PASSED' }),
      buildTask({ id: 'task-2', key: 'S1-T2', status: 'FAILED', order: 2 }),
    ]);
    const { evidence } = await builder.build('project-1', 'plan-1');
    expect(evidence.taskSummary).toEqual({
      totalTasks: 2,
      passedTasks: 1,
      nonPassedTaskKeys: ['S1-T2'],
    });
  });

  it('aggregates required/optional validation pass/fail counts across every Task', async () => {
    prisma.validationAttempt.findMany.mockResolvedValue([
      {
        taskId: 'task-1',
        attempt: 1,
        runs: [
          { required: true, status: 'PASSED' },
          { required: false, status: 'FAILED' },
        ],
      },
    ]);
    const { evidence } = await builder.build('project-1', 'plan-1');
    expect(evidence.validationSummary).toEqual({
      totalChecks: 2,
      requiredPassed: 1,
      requiredFailed: 0,
      optionalPassed: 0,
      optionalFailed: 1,
    });
  });

  it('reports the first and last commit SHA in Task plan order', async () => {
    prisma.task.findMany.mockResolvedValue([
      buildTask({ id: 'task-1', key: 'S1-T1', order: 1 }),
      buildTask({ id: 'task-2', key: 'S1-T2', order: 2 }),
    ]);
    prisma.taskExecution.findMany.mockResolvedValue([
      { taskId: 'task-1', attempt: 1, commitSha: 'sha-1' },
      { taskId: 'task-2', attempt: 1, commitSha: 'sha-2' },
    ]);
    const { evidence } = await builder.build('project-1', 'plan-1');
    expect(evidence.commitSummary).toEqual({
      totalCommits: 2,
      firstCommitSha: 'sha-1',
      lastCommitSha: 'sha-2',
    });
  });

  it('aggregates AI token usage by category across the whole Project, treating nulls as 0', async () => {
    prisma.projectAnalysis.findMany.mockResolvedValue([
      { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      { inputTokens: null, outputTokens: null, totalTokens: null },
    ]);
    prisma.agentJob.findMany.mockResolvedValue([
      { inputTokens: 10, outputTokens: 5 },
    ]);
    const { evidence } = await builder.build('project-1', 'plan-1');
    expect(evidence.usageSummary.totalInputTokens).toBe(110);
    expect(evidence.usageSummary.totalOutputTokens).toBe(55);
    expect(
      evidence.usageSummary.byCategory.find(
        (c) => c.category === 'coding_agent',
      ),
    ).toEqual({
      category: 'coding_agent',
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
  });

  it('warns when a Sprint was accepted despite an AI review recommendation of NEEDS_ATTENTION or REJECT', async () => {
    prisma.sprintAcceptance.findMany.mockResolvedValue([
      {
        sprintId: 'sprint-1',
        version: 1,
        status: 'ACCEPTED',
        recommendation: 'NEEDS_ATTENTION',
      },
    ]);
    const { evidence } = await builder.build('project-1', 'plan-1');
    expect(evidence.warnings).toEqual([
      expect.stringContaining('accepted despite an AI review recommendation'),
    ]);
  });

  it('reports the live workspace HEAD and clean state', async () => {
    const { evidence, liveHeadSha } = await builder.build(
      'project-1',
      'plan-1',
    );
    expect(liveHeadSha).toBe('end-sha');
    expect(evidence.workspace).toEqual({
      clean: true,
      headCommitSha: 'end-sha',
      branch: 'autodev/development',
    });
  });

  it('returns null workspace fields when the workspace is not ready, never throwing', async () => {
    workspaceService.getReadyWorkspacePath.mockRejectedValue(
      new Error('not ready'),
    );
    const { evidence, liveHeadSha } = await builder.build(
      'project-1',
      'plan-1',
    );
    expect(liveHeadSha).toBeNull();
    expect(evidence.workspace).toEqual({
      clean: null,
      headCommitSha: null,
      branch: null,
    });
  });
});
