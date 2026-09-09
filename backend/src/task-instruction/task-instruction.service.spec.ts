import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  TaskInstructionService,
  isInstructionCurrent,
} from './task-instruction.service';
import { GitError, GitErrorCode } from '../workspace/errors/git.error';
import {
  ApprovalError,
  ApprovalErrorCode,
} from '../approval/errors/approval.error';
import {
  PlanningAIError,
  PlanningErrorCode,
} from '../ai/planning/errors/planning-ai.error';
import { TaskInstructionErrorCode } from './errors/task-instruction.error';

function buildProject(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 'project-1', userId: 'user-1', archivedAt: null, ...overrides };
}

function buildTaskRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 'task-1', key: 'S1-T1', sprintPlanId: 'plan-1', ...overrides };
}

function buildContext() {
  return {
    project: {
      id: 'project-1',
      name: 'Demo',
      brief: 'x',
      repositoryType: 'NEW',
    },
    projectAnalysis: { id: 'analysis-1', version: 1, summary: 'x' },
    architecture: {
      id: 'architecture-1',
      version: 1,
      summary: 'x',
      relevantAreas: [],
      relevantAdrs: [],
    },
    sprintPlan: { id: 'plan-1', version: 1, summary: 'x', strategy: 'x' },
    sprint: { id: 'sprint-1', number: 1, title: 'x', objective: 'x' },
    task: {
      id: 'task-1',
      key: 'S1-T1',
      title: 'x',
      description: 'x',
      acceptanceCriteria: ['A user can be created.'],
      validationExpectations: [
        { type: 'unit_test', description: 'Unit tests pass.', required: true },
      ],
      requirementIds: ['FR-001'],
      architectureAreas: [],
      relevantRequirements: [],
    },
    dependencies: [],
    repository: {
      branch: 'autodev/development',
      headCommitSha: 'sha-1',
      clean: true,
      tree: { entries: [], truncated: false },
      manifests: [],
      manifestsSkipped: [],
      manifestsTruncated: false,
      recentCommits: [],
    },
  };
}

function buildInstructionContent(
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    objective: 'Do the thing.',
    repositoryObservations: [],
    implementationPlan: [{ step: 1, description: 'Do it.', likelyFiles: [] }],
    constraints: [],
    acceptanceCriteria: ['A user can be created.'],
    validationPlan: [
      { type: 'unit_test', description: 'Unit tests pass.', required: true },
    ],
    dependencyContext: [],
    risksOrWatchouts: [],
    requirementIds: ['FR-001'],
    finalInstruction: 'TASK\n...',
    ...overrides,
  };
}

function buildPlanningResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    data: buildInstructionContent(),
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    metadata: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      operation: 'TASK_INSTRUCTION',
      latencyMs: 500,
      attempts: 1,
      requestId: 'req-1',
    },
    ...overrides,
  };
}

function buildInstructionRow(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    id: 'instr-1',
    projectId: 'project-1',
    taskId: 'task-1',
    version: 1,
    sprintPlanId: 'plan-1',
    architectureId: 'architecture-1',
    projectAnalysisId: 'analysis-1',
    objective: 'Do the thing.',
    repositoryObservations: [],
    implementationPlan: [],
    constraints: [],
    acceptanceCriteria: ['A user can be created.'],
    validationPlan: [],
    dependencyContext: [],
    risksOrWatchouts: [],
    finalInstruction: 'TASK\n...',
    contextSnapshot: {},
    repositoryHeadSha: 'sha-1',
    repositoryBranch: 'autodev/development',
    promptName: 'task-instruction',
    promptVersion: '1',
    provider: 'openai',
    model: 'gpt-4o-mini',
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    latencyMs: 500,
    attempts: 1,
    providerRequestId: 'req-1',
    createdAt: now,
    ...overrides,
  };
}

describe('TaskInstructionService', () => {
  let prisma: any;
  let projectsService: any;
  let approvalService: any;
  let workspaceService: any;
  let git: any;
  let contextBuilder: any;
  let config: any;
  let planningAIProvider: any;
  let service: TaskInstructionService;

  beforeEach(() => {
    prisma = {
      task: { findFirst: jest.fn(), findUniqueOrThrow: jest.fn() },
      sprintPlan: { findFirst: jest.fn() },
      project: { findUniqueOrThrow: jest.fn() },
      projectWorkspace: { findUnique: jest.fn() },
      taskInstruction: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        aggregate: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
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
    contextBuilder = { build: jest.fn() };
    config = { maxInstructionChars: 50000 };
    planningAIProvider = { generateStructuredOutput: jest.fn() };

    service = new TaskInstructionService(
      prisma,
      projectsService,
      approvalService,
      workspaceService,
      git,
      contextBuilder,
      config,
      planningAIProvider,
    );
  });

  function setupHappyPathMocks() {
    projectsService.findOneForUser.mockResolvedValue(buildProject());
    prisma.task.findFirst.mockResolvedValue(buildTaskRow());
    prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
    workspaceService.getReadyWorkspacePath.mockResolvedValue(
      '/workspaces/project-1',
    );
    prisma.projectWorkspace.findUnique.mockResolvedValue({
      developmentBranch: 'autodev/development',
    });
    git.getCurrentBranch.mockResolvedValue('autodev/development');
    git.getStatus.mockResolvedValue({ clean: true, files: [] });
    git.getHeadCommitSha.mockResolvedValue('sha-1');
    contextBuilder.build.mockResolvedValue(buildContext());
    planningAIProvider.generateStructuredOutput.mockResolvedValue(
      buildPlanningResult(),
    );
    prisma.taskInstruction.aggregate.mockResolvedValue({
      _max: { version: null },
    });
    prisma.taskInstruction.create.mockResolvedValue(buildInstructionRow());
  }

  describe('generate', () => {
    it('creates version 1 with the exact Task, lineage, repository SHA, and AI metadata persisted', async () => {
      setupHappyPathMocks();

      const record = await service.generate('user-1', 'project-1', 'task-1');

      expect(prisma.taskInstruction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taskId: 'task-1',
            version: 1,
            sprintPlanId: 'plan-1',
            architectureId: 'architecture-1',
            projectAnalysisId: 'analysis-1',
            repositoryHeadSha: 'sha-1',
            promptName: 'task-instruction',
            promptVersion: '1',
            provider: 'openai',
            model: 'gpt-4o-mini',
            inputTokens: 100,
            outputTokens: 50,
          }),
        }),
      );
      expect(record.version).toBe(1);
      expect(record.stale).toBe(false); // repositoryHeadSha matches live HEAD (sha-1)
    });

    it('assigns version N+1 based on the current max version', async () => {
      setupHappyPathMocks();
      prisma.taskInstruction.aggregate.mockResolvedValue({
        _max: { version: 3 },
      });
      prisma.taskInstruction.create.mockResolvedValue(
        buildInstructionRow({ version: 4 }),
      );

      const record = await service.generate('user-1', 'project-1', 'task-1');
      expect(prisma.taskInstruction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: 4 }),
        }),
      );
      expect(record.version).toBe(4);
    });

    it('rejects for an archived project', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ archivedAt: new Date() }),
      );
      await expect(
        service.generate('user-1', 'project-1', 'task-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
    });

    it('rejects a Task that does not belong to the project (safe not-found)', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.task.findFirst.mockResolvedValue(null);
      await expect(
        service.generate('user-1', 'project-1', 'foreign-task'),
      ).rejects.toThrow();
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
    });

    it('rejects a Task belonging to a Sprint Plan that is no longer current', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.task.findFirst.mockResolvedValue(
        buildTaskRow({ sprintPlanId: 'plan-old' }),
      );
      prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-2' });

      await expect(
        service.generate('user-1', 'project-1', 'task-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: TaskInstructionErrorCode.TASK_NOT_IN_CURRENT_PLAN,
        }),
      });
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
    });

    it('maps a missing development approval to an HTTP exception (plan approval gate enforced)', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.task.findFirst.mockResolvedValue(buildTaskRow());
      prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
      approvalService.assertDevelopmentApproved.mockRejectedValue(
        new ApprovalError({
          code: ApprovalErrorCode.DEVELOPMENT_PREREQUISITES_MISSING,
          message: 'not approved',
        }),
      );

      await expect(
        service.generate('user-1', 'project-1', 'task-1'),
      ).rejects.toThrow();
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
    });

    it('maps a not-ready workspace to a conflict', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.task.findFirst.mockResolvedValue(buildTaskRow());
      prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
      workspaceService.getReadyWorkspacePath.mockRejectedValue(
        new GitError({
          code: GitErrorCode.WORKSPACE_NOT_READY,
          message: 'not ready',
        }),
      );

      await expect(
        service.generate('user-1', 'project-1', 'task-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: GitErrorCode.WORKSPACE_NOT_READY,
        }),
      });
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
    });

    it('rejects on the wrong branch', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.task.findFirst.mockResolvedValue(buildTaskRow());
      prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
      workspaceService.getReadyWorkspacePath.mockResolvedValue(
        '/workspaces/project-1',
      );
      prisma.projectWorkspace.findUnique.mockResolvedValue({
        developmentBranch: 'autodev/development',
      });
      git.getCurrentBranch.mockResolvedValue('main');

      await expect(
        service.generate('user-1', 'project-1', 'task-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: TaskInstructionErrorCode.WORKSPACE_NOT_READY,
        }),
      });
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
    });

    it('rejects a dirty workspace', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.task.findFirst.mockResolvedValue(buildTaskRow());
      prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-1' });
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
        service.generate('user-1', 'project-1', 'task-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: TaskInstructionErrorCode.WORKSPACE_DIRTY,
        }),
      });
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
    });

    it('does not create an instruction when the planning provider fails', async () => {
      setupHappyPathMocks();
      planningAIProvider.generateStructuredOutput.mockRejectedValue(
        new PlanningAIError({
          code: PlanningErrorCode.PROVIDER_UNAVAILABLE,
          message: 'down',
          provider: 'openai',
          retryable: true,
        }),
      );

      await expect(
        service.generate('user-1', 'project-1', 'task-1'),
      ).rejects.toThrow();
      expect(prisma.taskInstruction.create).not.toHaveBeenCalled();
    });

    it('does not persist an instruction that fails acceptance-criteria preservation', async () => {
      setupHappyPathMocks();
      planningAIProvider.generateStructuredOutput.mockResolvedValue(
        buildPlanningResult({
          data: buildInstructionContent({
            acceptanceCriteria: ['something else entirely'],
          }),
        }),
      );

      await expect(
        service.generate('user-1', 'project-1', 'task-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: TaskInstructionErrorCode.INVALID_INSTRUCTION_RESPONSE,
        }),
      });
      expect(prisma.taskInstruction.create).not.toHaveBeenCalled();
    });

    it('does not persist an instruction that omits a required validation expectation', async () => {
      setupHappyPathMocks();
      planningAIProvider.generateStructuredOutput.mockResolvedValue(
        buildPlanningResult({
          data: buildInstructionContent({
            validationPlan: [
              { type: 'lint', description: 'Lint passes.', required: false },
            ],
          }),
        }),
      );

      await expect(
        service.generate('user-1', 'project-1', 'task-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: TaskInstructionErrorCode.INVALID_INSTRUCTION_RESPONSE,
        }),
      });
      expect(prisma.taskInstruction.create).not.toHaveBeenCalled();
    });

    it('rejects an instruction exceeding the configured max character length', async () => {
      setupHappyPathMocks();
      config.maxInstructionChars = 3;

      await expect(
        service.generate('user-1', 'project-1', 'task-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: TaskInstructionErrorCode.INVALID_INSTRUCTION_RESPONSE,
        }),
      });
      expect(prisma.taskInstruction.create).not.toHaveBeenCalled();
    });

    it('rejects with REPOSITORY_STATE_CHANGED if HEAD moved during generation, without persisting', async () => {
      setupHappyPathMocks();
      git.getHeadCommitSha
        .mockResolvedValueOnce('sha-1')
        .mockResolvedValueOnce('sha-2');

      await expect(
        service.generate('user-1', 'project-1', 'task-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: TaskInstructionErrorCode.REPOSITORY_STATE_CHANGED,
        }),
      });
      expect(prisma.taskInstruction.create).not.toHaveBeenCalled();
    });

    it('maps a concurrent-version unique-constraint race to a clean conflict', async () => {
      setupHappyPathMocks();
      prisma.taskInstruction.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '6.0.0',
        }),
      );

      await expect(
        service.generate('user-1', 'project-1', 'task-1'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: TaskInstructionErrorCode.GENERATION_IN_PROGRESS,
        }),
      });
    });
  });

  describe('reads', () => {
    it('returns the latest instruction as current when HEAD matches', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.task.findFirst.mockResolvedValue({ id: 'task-1' });
      prisma.taskInstruction.findFirst.mockResolvedValue(buildInstructionRow());
      workspaceService.getReadyWorkspacePath.mockResolvedValue(
        '/workspaces/project-1',
      );
      git.getHeadCommitSha.mockResolvedValue('sha-1');

      const record = await service.getCurrent('user-1', 'project-1', 'task-1');
      expect(record.stale).toBe(false);
    });

    it('flags an instruction as stale once HEAD has moved on', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.task.findFirst.mockResolvedValue({ id: 'task-1' });
      prisma.taskInstruction.findFirst.mockResolvedValue(buildInstructionRow());
      workspaceService.getReadyWorkspacePath.mockResolvedValue(
        '/workspaces/project-1',
      );
      git.getHeadCommitSha.mockResolvedValue('sha-2');

      const record = await service.getCurrent('user-1', 'project-1', 'task-1');
      expect(record.stale).toBe(true);
    });

    it('returns full version history, newest first, preserving earlier versions', async () => {
      projectsService.findOneForUser.mockResolvedValue(buildProject());
      prisma.task.findFirst.mockResolvedValue({ id: 'task-1' });
      prisma.taskInstruction.findMany.mockResolvedValue([
        buildInstructionRow({ id: 'instr-2', version: 2 }),
        buildInstructionRow({ id: 'instr-1', version: 1 }),
      ]);
      workspaceService.getReadyWorkspacePath.mockResolvedValue(
        '/workspaces/project-1',
      );
      git.getHeadCommitSha.mockResolvedValue('sha-1');

      const history = await service.getHistory('user-1', 'project-1', 'task-1');
      expect(history.map((h) => h.version)).toEqual([2, 1]);
    });
  });

  describe('getOrGenerateFreshInstruction (Sprint 12 integration point)', () => {
    it('generates a fresh instruction when none exists yet', async () => {
      prisma.task.findUniqueOrThrow.mockResolvedValue({
        sprintPlan: { projectId: 'project-1' },
      });
      prisma.project.findUniqueOrThrow.mockResolvedValue({ userId: 'user-1' });
      prisma.taskInstruction.findFirst.mockResolvedValue(null);
      setupHappyPathMocks();

      const record = await service.getOrGenerateFreshInstruction('task-1');
      expect(planningAIProvider.generateStructuredOutput).toHaveBeenCalled();
      expect(record.version).toBe(1);
    });

    it('reuses the current instruction without calling the planning provider when it is fresh', async () => {
      prisma.task.findUniqueOrThrow.mockResolvedValue({
        sprintPlan: { projectId: 'project-1' },
      });
      prisma.project.findUniqueOrThrow.mockResolvedValue({ userId: 'user-1' });
      prisma.taskInstruction.findFirst.mockResolvedValue(buildInstructionRow());
      workspaceService.getReadyWorkspacePath.mockResolvedValue(
        '/workspaces/project-1',
      );
      git.getHeadCommitSha.mockResolvedValue('sha-1');

      const record = await service.getOrGenerateFreshInstruction('task-1');
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
      expect(record.version).toBe(1);
    });

    it('regenerates when the existing instruction is stale (HEAD moved on)', async () => {
      prisma.task.findUniqueOrThrow.mockResolvedValue({
        sprintPlan: { projectId: 'project-1' },
      });
      prisma.project.findUniqueOrThrow.mockResolvedValue({ userId: 'user-1' });
      prisma.taskInstruction.findFirst.mockResolvedValueOnce(
        buildInstructionRow({ repositoryHeadSha: 'sha-old' }),
      );
      setupHappyPathMocks();
      prisma.taskInstruction.findFirst.mockResolvedValueOnce(
        buildInstructionRow({ repositoryHeadSha: 'sha-old' }),
      );

      const record = await service.getOrGenerateFreshInstruction('task-1');
      expect(planningAIProvider.generateStructuredOutput).toHaveBeenCalled();
      expect(record.repositoryHeadSha).toBe('sha-1');
    });
  });
});

describe('isInstructionCurrent', () => {
  it('is true only when the head sha matches exactly', () => {
    expect(isInstructionCurrent({ repositoryHeadSha: 'abc' }, 'abc')).toBe(
      true,
    );
    expect(isInstructionCurrent({ repositoryHeadSha: 'abc' }, 'def')).toBe(
      false,
    );
    expect(isInstructionCurrent({ repositoryHeadSha: 'abc' }, null)).toBe(
      false,
    );
  });
});
