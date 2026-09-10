import { SprintAcceptanceEvidenceBuilder } from './evidence-builder.service';

function buildTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'task-1',
    key: 'S1-T1',
    title: 'Add file A',
    description: 'Create file-a.txt.',
    status: 'PASSED',
    acceptanceCriteria: ['file-a.txt exists.'],
    requirementIds: ['FR-001'],
    architectureAreas: ['Backend Architecture'],
    order: 1,
    ...overrides,
  };
}

describe('SprintAcceptanceEvidenceBuilder', () => {
  let prisma: any;
  let workspaceService: any;
  let git: any;
  let builder: SprintAcceptanceEvidenceBuilder;

  beforeEach(() => {
    prisma = {
      sprintExecution: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'exec-1',
          projectId: 'project-1',
          sprintId: 'sprint-1',
          sprintPlanId: 'plan-1',
          attempt: 1,
          status: 'COMPLETED',
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          completedAt: new Date('2026-01-01T01:00:00.000Z'),
          repositoryStartSha: 'start-sha',
          repositoryEndSha: 'end-sha',
          totalTasks: 1,
          passedTasks: 1,
        }),
      },
      sprint: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'sprint-1',
          number: 1,
          title: 'Foundations',
          objective: 'Ship the basics.',
          status: 'PASSED',
        }),
      },
      sprintPlan: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'plan-1',
          version: 1,
          architectureId: 'arch-1',
        }),
      },
      architecture: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'arch-1',
          version: 1,
          projectAnalysisId: 'analysis-1',
          architectureDecisions: [
            {
              id: 'ADR-001',
              title: 'Use Postgres',
              decision: 'Use Postgres with Prisma.',
            },
          ],
          unresolvedQuestions: [
            { question: 'Which cache?', impact: 'Perf unclear.' },
          ],
        }),
      },
      projectAnalysis: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'analysis-1',
          version: 1,
          functionalRequirements: [{ id: 'FR-001', title: 'Do the thing' }],
          risks: [
            {
              risk: 'Vendor lock-in',
              severity: 'medium',
              mitigation: 'Abstract provider.',
            },
          ],
        }),
      },
      task: { findMany: jest.fn().mockResolvedValue([buildTask()]) },
      taskExecution: {
        findMany: jest.fn().mockResolvedValue([
          {
            taskId: 'task-1',
            attempt: 1,
            commitSha: 'commit-sha-1',
            changedFiles: [{ path: 'file-a.txt', changeType: 'ADDED' }],
          },
        ]),
      },
      validationAttempt: {
        findMany: jest.fn().mockResolvedValue([
          {
            taskId: 'task-1',
            attempt: 1,
            status: 'PASSED',
            requiredPassed: 1,
            requiredFailed: 0,
            runs: [{ name: 'lint', required: true, status: 'PASSED' }],
          },
        ]),
      },
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
    builder = new SprintAcceptanceEvidenceBuilder(
      prisma,
      workspaceService,
      git,
    );
  });

  it('walks the exact Sprint/SprintPlan/Architecture/ProjectAnalysis lineage pinned by the SprintExecution', async () => {
    const { evidence } = await builder.build('exec-1');
    expect(evidence.sprint.id).toBe('sprint-1');
    expect(evidence.sprintPlan).toEqual({ id: 'plan-1', version: 1 });
    expect(evidence.architecture).toEqual({ id: 'arch-1', version: 1 });
    expect(evidence.projectAnalysis).toEqual({ id: 'analysis-1', version: 1 });
    expect(prisma.sprintPlan.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'plan-1' },
    });
    expect(prisma.architecture.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'arch-1' },
    });
  });

  it('uses the exact SprintExecution passed in, never re-deriving "latest"', async () => {
    const { evidence } = await builder.build('exec-1');
    expect(evidence.sprintExecution.id).toBe('exec-1');
    expect(evidence.sprintExecution.repositoryStartSha).toBe('start-sha');
    expect(evidence.sprintExecution.repositoryEndSha).toBe('end-sha');
  });

  it('aggregates Task acceptance criteria and requirement/architecture mappings', async () => {
    const { evidence } = await builder.build('exec-1');
    expect(evidence.tasks).toHaveLength(1);
    expect(evidence.tasks[0]).toMatchObject({
      key: 'S1-T1',
      acceptanceCriteria: ['file-a.txt exists.'],
      requirementIds: ['FR-001'],
      architectureAreas: ['Backend Architecture'],
      commitSha: 'commit-sha-1',
      changedFileCount: 1,
      validationStatus: 'PASSED',
    });
  });

  it("scopes requirement coverage to only this Sprint's own Tasks, not every Project FR", async () => {
    prisma.projectAnalysis.findUniqueOrThrow.mockResolvedValue({
      id: 'analysis-1',
      version: 1,
      functionalRequirements: [
        { id: 'FR-001', title: 'Do the thing' },
        { id: 'FR-999', title: 'Unrelated requirement from another Sprint' },
      ],
      risks: [],
    });
    const { evidence } = await builder.build('exec-1');
    expect(evidence.requirementCoverage).toHaveLength(1);
    expect(evidence.requirementCoverage[0]).toEqual({
      requirementId: 'FR-001',
      title: 'Do the thing',
      taskKeys: ['S1-T1'],
      tasksPassed: true,
      validationPassed: true,
      commitShas: ['commit-sha-1'],
    });
  });

  it('aggregates deterministic validation evidence from ValidationRuns', async () => {
    const { evidence } = await builder.build('exec-1');
    expect(evidence.validationSummary).toEqual({
      totalRuns: 1,
      requiredRuns: 1,
      requiredPassed: 1,
      optionalPassed: 0,
      optionalFailed: 0,
      failedRequiredChecks: [],
    });
  });

  it('reports failed required checks by name', async () => {
    prisma.validationAttempt.findMany.mockResolvedValue([
      {
        taskId: 'task-1',
        attempt: 1,
        status: 'FAILED',
        requiredPassed: 0,
        requiredFailed: 1,
        runs: [{ name: 'typecheck', required: true, status: 'FAILED' }],
      },
    ]);
    const { evidence } = await builder.build('exec-1');
    expect(evidence.validationSummary.failedRequiredChecks).toEqual([
      'typecheck',
    ]);
  });

  it('aggregates commit evidence and flags the chain complete when every PASSED Task has a commit', async () => {
    const { evidence } = await builder.build('exec-1');
    expect(evidence.commitSummary).toEqual({
      startSha: 'start-sha',
      endSha: 'end-sha',
      commits: [
        { taskKey: 'S1-T1', commitSha: 'commit-sha-1', changedFileCount: 1 },
      ],
      chainComplete: true,
    });
  });

  it('flags an incomplete commit chain when a PASSED Task has no recorded commit', async () => {
    prisma.taskExecution.findMany.mockResolvedValue([
      { taskId: 'task-1', attempt: 1, commitSha: null, changedFiles: [] },
    ]);
    const { evidence } = await builder.build('exec-1');
    expect(evidence.commitSummary.chainComplete).toBe(false);
  });

  it('deduplicates changed files across Tasks and counts how many Tasks touched each', async () => {
    prisma.task.findMany.mockResolvedValue([
      buildTask({ id: 'task-1', key: 'S1-T1' }),
      buildTask({ id: 'task-2', key: 'S1-T2', order: 2 }),
    ]);
    prisma.taskExecution.findMany.mockResolvedValue([
      {
        taskId: 'task-1',
        attempt: 1,
        commitSha: 'sha-1',
        changedFiles: [{ path: 'shared.ts' }],
      },
      {
        taskId: 'task-2',
        attempt: 1,
        commitSha: 'sha-2',
        changedFiles: [{ path: 'shared.ts' }],
      },
    ]);
    const { evidence } = await builder.build('exec-1');
    expect(evidence.changedFiles).toEqual([
      { path: 'shared.ts', taskCount: 2 },
    ]);
  });

  it('reports the live final repository SHA and workspace clean state', async () => {
    const { evidence, liveHeadSha } = await builder.build('exec-1');
    expect(liveHeadSha).toBe('end-sha');
    expect(evidence.workspace).toEqual({
      clean: true,
      headCommitSha: 'end-sha',
      branch: 'autodev/development',
    });
  });

  it('collects Project risks and unresolved Architecture questions', async () => {
    const { evidence } = await builder.build('exec-1');
    expect(evidence.riskSummary.projectRisks).toEqual([
      {
        risk: 'Vendor lock-in',
        severity: 'medium',
        mitigation: 'Abstract provider.',
      },
    ]);
    expect(evidence.riskSummary.unresolvedArchitectureQuestions).toEqual([
      { question: 'Which cache?', impact: 'Perf unclear.' },
    ]);
  });

  it('exposes the full ADR id set for identifier validation, bounded to what Architecture actually declares', async () => {
    const { evidence } = await builder.build('exec-1');
    expect(evidence.architectureContext.allAdrIds).toEqual(['ADR-001']);
  });

  it('returns null workspace fields when the workspace is not ready, never throwing', async () => {
    workspaceService.getReadyWorkspacePath.mockRejectedValue(
      new Error('not ready'),
    );
    const { evidence, liveHeadSha } = await builder.build('exec-1');
    expect(liveHeadSha).toBeNull();
    expect(evidence.workspace).toEqual({
      clean: null,
      headCommitSha: null,
      branch: null,
    });
  });
});
