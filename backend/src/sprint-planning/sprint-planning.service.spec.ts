import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { AnalysisSource, ProjectStatus, RepositoryType } from '@prisma/client';
import { SprintPlanningService } from './sprint-planning.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { PlanningAIProvider } from '../ai/planning/contracts/planning-provider.interface';
import {
  PlanningAIError,
  PlanningErrorCode,
} from '../ai/planning/errors/planning-ai.error';
import { PlanningOperation } from '../ai/planning/planning-ai.constants';

function buildProject(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    id: 'project-1',
    userId: 'user-1',
    name: 'Interview Prep Platform',
    description: null,
    brief: 'Build a mock interview platform.',
    preferredStack: 'React + NestJS + PostgreSQL',
    repositoryType: RepositoryType.NEW,
    repositoryUrl: null,
    status: ProjectStatus.ANALYSIS_READY,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildAnalysis(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    id: 'analysis-1',
    projectId: 'project-1',
    version: 1,
    source: AnalysisSource.AI_GENERATED,
    basedOnVersion: null,
    summary: 'A mock interview platform.',
    targetUsers: [],
    goals: [],
    features: [],
    functionalRequirements: [
      {
        id: 'FR-001',
        title: 'Start interview',
        description: 'x',
        priority: 'must_have',
      },
    ],
    nonFunctionalRequirements: [],
    assumptions: [],
    risks: [],
    unresolvedQuestions: [],
    integrations: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildArchitectureRow(
  overrides: Partial<Record<string, unknown>> = {},
) {
  const now = new Date();
  return {
    id: 'architecture-1',
    projectId: 'project-1',
    projectAnalysisId: 'analysis-1',
    version: 1,
    summary: 'A modular NestJS monolith.',
    frontendArchitecture: {},
    backendArchitecture: {},
    apiArchitecture: {},
    databaseArchitecture: {},
    authenticationArchitecture: {},
    integrationArchitecture: [],
    securityArchitecture: {},
    testingStrategy: {},
    architectureDecisions: [],
    nonFunctionalDecisions: [],
    constraints: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildValidationExpectation(
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    type: 'unit_test',
    description: 'Unit tests pass.',
    required: true,
    ...overrides,
  };
}

function buildSprintPlanContent(
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    summary: 'Deliver the interview flow across two sprints.',
    strategy: 'Build foundations first, then layer features.',
    sprints: [
      {
        number: 1,
        title: 'Foundations',
        objective: 'Stand up the core interview session model.',
        dependencies: [],
        tasks: [
          {
            key: 'S1-T1',
            title: 'Create interview session model',
            description: 'Implement the session entity and start endpoint.',
            dependencies: [],
            acceptanceCriteria: ['A session can be started.'],
            validationExpectations: [buildValidationExpectation()],
            requirementIds: ['FR-001'],
            architectureAreas: ['backendArchitecture'],
          },
        ],
      },
      {
        number: 2,
        title: 'Session UI',
        objective: 'Expose the session flow in the frontend.',
        dependencies: [1],
        tasks: [
          {
            key: 'S2-T1',
            title: 'Build session start page',
            description:
              'Frontend page to start and view an interview session.',
            dependencies: ['S1-T1'],
            acceptanceCriteria: ['A user can start a session from the UI.'],
            validationExpectations: [
              buildValidationExpectation({ type: 'e2e_test' }),
            ],
            requirementIds: [],
            architectureAreas: ['frontendArchitecture'],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function buildSprintPlanRow(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    id: 'plan-1',
    projectId: 'project-1',
    architectureId: 'architecture-1',
    version: 1,
    source: AnalysisSource.AI_GENERATED,
    basedOnVersion: null,
    summary: buildSprintPlanContent().summary,
    strategy: buildSprintPlanContent().strategy,
    estimatedSprintCount: 2,
    promptName: 'sprint-planning',
    promptVersion: '1',
    provider: 'openai',
    model: 'gpt-4o-mini',
    inputTokens: 500,
    outputTokens: 300,
    totalTokens: 800,
    latencyMs: 1200,
    attempts: 1,
    providerRequestId: 'req-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('SprintPlanningService', () => {
  let prisma: {
    sprintPlan: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      aggregate: jest.Mock;
      create: jest.Mock;
    };
    sprint: { create: jest.Mock; findMany: jest.Mock };
    task: { create: jest.Mock; findMany: jest.Mock };
    sprintDependency: { create: jest.Mock; findMany: jest.Mock };
    taskDependency: { create: jest.Mock; findMany: jest.Mock };
    architecture: { findFirst: jest.Mock; findUniqueOrThrow: jest.Mock };
    projectAnalysis: { findUniqueOrThrow: jest.Mock };
    project: { update: jest.Mock };
    $transaction: jest.Mock;
  };
  let projectsService: {
    findOneForUser: jest.Mock;
    transitionStatus: jest.Mock;
  };
  let planningAIProvider: { generateStructuredOutput: jest.Mock };
  let service: SprintPlanningService;

  function mockHydrationReads(planRow = buildSprintPlanRow()) {
    prisma.sprintPlan.findUniqueOrThrow.mockResolvedValue(planRow);
    prisma.sprint.findMany.mockResolvedValue([
      {
        id: 'sprint-1',
        sprintPlanId: planRow.id,
        number: 1,
        title: 'Foundations',
        objective: 'x',
        description: null,
        status: 'PENDING',
        order: 1,
      },
      {
        id: 'sprint-2',
        sprintPlanId: planRow.id,
        number: 2,
        title: 'Session UI',
        objective: 'y',
        description: null,
        status: 'PENDING',
        order: 2,
      },
    ]);
    prisma.task.findMany.mockResolvedValue([
      {
        id: 'task-S1-T1',
        sprintPlanId: planRow.id,
        sprintId: 'sprint-1',
        key: 'S1-T1',
        title: 't1',
        description: 'd1',
        status: 'PENDING',
        order: 0,
        acceptanceCriteria: [],
        validationExpectations: [],
        requirementIds: ['FR-001'],
        architectureAreas: [],
      },
      {
        id: 'task-S2-T1',
        sprintPlanId: planRow.id,
        sprintId: 'sprint-2',
        key: 'S2-T1',
        title: 't2',
        description: 'd2',
        status: 'PENDING',
        order: 0,
        acceptanceCriteria: [],
        validationExpectations: [],
        requirementIds: [],
        architectureAreas: [],
      },
    ]);
    prisma.sprintDependency.findMany.mockResolvedValue([
      { sprintId: 'sprint-2', dependsOnSprintId: 'sprint-1' },
    ]);
    prisma.taskDependency.findMany.mockResolvedValue([
      { taskId: 'task-S2-T1', dependsOnTaskId: 'task-S1-T1' },
    ]);
  }

  beforeEach(() => {
    prisma = {
      sprintPlan: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        aggregate: jest.fn(),
        create: jest.fn(),
      },
      sprint: {
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: `sprint-${args.data.number}`, ...args.data }),
        ),
        findMany: jest.fn(),
      },
      task: {
        create: jest.fn((args: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: `task-${args.data.key}`, ...args.data }),
        ),
        findMany: jest.fn(),
      },
      sprintDependency: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(),
      },
      taskDependency: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(),
      },
      architecture: {
        findFirst: jest.fn().mockResolvedValue(buildArchitectureRow()),
        findUniqueOrThrow: jest.fn().mockResolvedValue(buildArchitectureRow()),
      },
      projectAnalysis: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(buildAnalysis()),
      },
      project: { update: jest.fn() },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    projectsService = {
      findOneForUser: jest.fn().mockResolvedValue(buildProject()),
      transitionStatus: jest
        .fn()
        .mockResolvedValue(buildProject({ status: ProjectStatus.PLANNING })),
    };
    planningAIProvider = { generateStructuredOutput: jest.fn() };

    service = new SprintPlanningService(
      prisma as unknown as PrismaService,
      projectsService as unknown as ProjectsService,
      planningAIProvider as unknown as PlanningAIProvider,
    );
  });

  describe('generate', () => {
    it('generates sprint plan v1 from the latest architecture, using ANALYSIS_READY <-> PLANNING as the lock', async () => {
      prisma.sprintPlan.findFirst.mockResolvedValue(null);
      prisma.sprintPlan.aggregate.mockResolvedValue({
        _max: { version: null },
      });
      prisma.sprintPlan.create.mockResolvedValue(buildSprintPlanRow());
      planningAIProvider.generateStructuredOutput.mockResolvedValue({
        data: buildSprintPlanContent(),
        usage: { inputTokens: 500, outputTokens: 300, totalTokens: 800 },
        metadata: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          operation: PlanningOperation.SPRINT_PLANNING,
          latencyMs: 1200,
          attempts: 1,
          requestId: 'req-1',
        },
      });
      mockHydrationReads();

      const plan = await service.generate('user-1', 'project-1');

      expect(projectsService.transitionStatus).toHaveBeenNthCalledWith(
        1,
        'user-1',
        'project-1',
        ProjectStatus.ANALYSIS_READY,
        ProjectStatus.PLANNING,
      );
      expect(planningAIProvider.generateStructuredOutput).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: PlanningOperation.SPRINT_PLANNING,
        }),
      );

      const createArgs = prisma.sprintPlan.create.mock.calls[0][0];
      expect(createArgs.data.version).toBe(1);
      expect(createArgs.data.source).toBe(AnalysisSource.AI_GENERATED);
      expect(createArgs.data.architectureId).toBe('architecture-1');
      expect(createArgs.data.promptName).toBe('sprint-planning');
      expect(createArgs.data.provider).toBe('openai');

      // Natural-key (sprint number / task key) dependency references must be
      // resolved to the actual generated DB ids before hitting the join tables.
      expect(prisma.sprintDependency.create).toHaveBeenCalledWith({
        data: { sprintId: 'sprint-2', dependsOnSprintId: 'sprint-1' },
      });
      expect(prisma.taskDependency.create).toHaveBeenCalledWith({
        data: { taskId: 'task-S2-T1', dependsOnTaskId: 'task-S1-T1' },
      });

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        data: { status: ProjectStatus.PLAN_READY },
      });

      expect(plan.version).toBe(1);
      expect(plan.sprints).toHaveLength(2);
      expect(plan.sprints[1].dependsOnSprintNumbers).toEqual([1]);
      expect(plan.sprints[1].tasks[0].dependsOnTaskKeys).toEqual(['S1-T1']);
    });

    it('rejects generation when a sprint plan already exists (use regenerate instead)', async () => {
      prisma.sprintPlan.findFirst.mockResolvedValue(buildSprintPlanRow());

      await expect(
        service.generate('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(projectsService.transitionStatus).not.toHaveBeenCalled();
    });

    it('rejects generation when no Architecture exists', async () => {
      prisma.architecture.findFirst.mockResolvedValue(null);

      await expect(
        service.generate('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(projectsService.transitionStatus).not.toHaveBeenCalled();
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
    });

    it('blocks a non-owned project', async () => {
      projectsService.findOneForUser.mockRejectedValue(
        new NotFoundException('Project not found'),
      );

      await expect(
        service.generate('user-2', 'project-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
    });

    it('blocks generation for an archived project', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ archivedAt: new Date() }),
      );

      await expect(
        service.generate('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(projectsService.transitionStatus).not.toHaveBeenCalled();
    });

    it('blocks generation from an invalid project state / concurrent generation', async () => {
      prisma.sprintPlan.findFirst.mockResolvedValue(null);
      projectsService.transitionStatus.mockRejectedValue(
        new ConflictException(
          'Project status is PLANNING, expected ANALYSIS_READY',
        ),
      );

      await expect(
        service.generate('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
      expect(prisma.sprintPlan.create).not.toHaveBeenCalled();
    });

    it('restores ANALYSIS_READY and normalizes the error when the provider fails', async () => {
      prisma.sprintPlan.findFirst.mockResolvedValue(null);
      planningAIProvider.generateStructuredOutput.mockRejectedValue(
        new PlanningAIError({
          code: PlanningErrorCode.PROVIDER_UNAVAILABLE,
          message: 'raw provider detail',
          provider: 'openai',
          retryable: true,
        }),
      );

      await expect(
        service.generate('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(HttpException);

      expect(projectsService.transitionStatus).toHaveBeenNthCalledWith(
        2,
        'user-1',
        'project-1',
        ProjectStatus.PLANNING,
        ProjectStatus.ANALYSIS_READY,
      );
      expect(prisma.sprintPlan.create).not.toHaveBeenCalled();
    });

    it('rejects and does not persist when the AI result leaves a functional requirement uncovered', async () => {
      prisma.sprintPlan.findFirst.mockResolvedValue(null);
      planningAIProvider.generateStructuredOutput.mockResolvedValue({
        data: buildSprintPlanContent({
          sprints: [
            {
              number: 1,
              title: 'Foundations',
              objective: 'x',
              dependencies: [],
              tasks: [
                {
                  key: 'S1-T1',
                  title: 't',
                  description: 'd',
                  dependencies: [],
                  acceptanceCriteria: ['x'],
                  validationExpectations: [buildValidationExpectation()],
                  requirementIds: [],
                  architectureAreas: [],
                },
              ],
            },
          ],
        }),
        usage: {},
        metadata: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          operation: PlanningOperation.SPRINT_PLANNING,
          latencyMs: 10,
          attempts: 1,
        },
      });

      await expect(
        service.generate('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.sprintPlan.create).not.toHaveBeenCalled();
      expect(projectsService.transitionStatus).toHaveBeenNthCalledWith(
        2,
        'user-1',
        'project-1',
        ProjectStatus.PLANNING,
        ProjectStatus.ANALYSIS_READY,
      );
    });

    it('rejects when the AI result references an unknown functional requirement id', async () => {
      prisma.sprintPlan.findFirst.mockResolvedValue(null);
      planningAIProvider.generateStructuredOutput.mockResolvedValue({
        data: buildSprintPlanContent({
          sprints: [
            {
              number: 1,
              title: 'Foundations',
              objective: 'x',
              dependencies: [],
              tasks: [
                {
                  key: 'S1-T1',
                  title: 't',
                  description: 'd',
                  dependencies: [],
                  acceptanceCriteria: ['x'],
                  validationExpectations: [buildValidationExpectation()],
                  requirementIds: ['FR-999'],
                  architectureAreas: [],
                },
              ],
            },
          ],
        }),
        usage: {},
        metadata: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          operation: PlanningOperation.SPRINT_PLANNING,
          latencyMs: 10,
          attempts: 1,
        },
      });

      await expect(
        service.generate('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.sprintPlan.create).not.toHaveBeenCalled();
    });

    it('restores status even when persistence itself fails after a successful AI call', async () => {
      prisma.sprintPlan.findFirst.mockResolvedValue(null);
      planningAIProvider.generateStructuredOutput.mockResolvedValue({
        data: buildSprintPlanContent(),
        usage: {},
        metadata: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          operation: PlanningOperation.SPRINT_PLANNING,
          latencyMs: 10,
          attempts: 1,
        },
      });
      prisma.$transaction.mockRejectedValue(new Error('db unavailable'));

      await expect(service.generate('user-1', 'project-1')).rejects.toThrow(
        'db unavailable',
      );
      expect(projectsService.transitionStatus).toHaveBeenNthCalledWith(
        2,
        'user-1',
        'project-1',
        ProjectStatus.PLANNING,
        ProjectStatus.ANALYSIS_READY,
      );
    });
  });

  describe('regenerate', () => {
    it('requires an existing sprint plan, uses PLAN_READY <-> PLANNING as the lock, and creates the next version', async () => {
      prisma.sprintPlan.findFirst.mockResolvedValue(
        buildSprintPlanRow({ version: 1 }),
      );
      prisma.sprintPlan.aggregate.mockResolvedValue({ _max: { version: 1 } });
      prisma.sprintPlan.create.mockResolvedValue(
        buildSprintPlanRow({ id: 'plan-2', version: 2 }),
      );
      planningAIProvider.generateStructuredOutput.mockResolvedValue({
        data: buildSprintPlanContent({ summary: 'Updated summary' }),
        usage: {},
        metadata: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          operation: PlanningOperation.SPRINT_PLANNING,
          latencyMs: 10,
          attempts: 1,
        },
      });
      mockHydrationReads(buildSprintPlanRow({ id: 'plan-2', version: 2 }));

      const plan = await service.regenerate('user-1', 'project-1');

      expect(projectsService.transitionStatus).toHaveBeenNthCalledWith(
        1,
        'user-1',
        'project-1',
        ProjectStatus.PLAN_READY,
        ProjectStatus.PLANNING,
      );
      expect(plan.version).toBe(2);
      expect(prisma.sprintPlan.create).toHaveBeenCalledTimes(1);
    });

    it('rejects regeneration when no sprint plan exists yet', async () => {
      prisma.sprintPlan.findFirst.mockResolvedValue(null);

      await expect(
        service.regenerate('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
    });

    it('restores PLAN_READY and preserves the existing plan when regeneration fails', async () => {
      prisma.sprintPlan.findFirst.mockResolvedValue(buildSprintPlanRow());
      planningAIProvider.generateStructuredOutput.mockRejectedValue(
        new PlanningAIError({
          code: PlanningErrorCode.TIMEOUT,
          message: 'timed out',
          provider: 'openai',
          retryable: true,
        }),
      );

      await expect(
        service.regenerate('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(HttpException);

      expect(projectsService.transitionStatus).toHaveBeenNthCalledWith(
        2,
        'user-1',
        'project-1',
        ProjectStatus.PLANNING,
        ProjectStatus.PLAN_READY,
      );
      expect(prisma.sprintPlan.create).not.toHaveBeenCalled();
    });

    it('picks up a newer Architecture than the one the current plan was based on', async () => {
      prisma.sprintPlan.findFirst.mockResolvedValue(
        buildSprintPlanRow({ architectureId: 'architecture-1', version: 1 }),
      );
      prisma.architecture.findFirst.mockResolvedValue(
        buildArchitectureRow({ id: 'architecture-2', version: 2 }),
      );
      prisma.architecture.findUniqueOrThrow.mockResolvedValue(
        buildArchitectureRow({ id: 'architecture-2', version: 2 }),
      );
      prisma.sprintPlan.aggregate.mockResolvedValue({ _max: { version: 1 } });
      prisma.sprintPlan.create.mockResolvedValue(
        buildSprintPlanRow({
          id: 'plan-2',
          architectureId: 'architecture-2',
          version: 2,
        }),
      );
      planningAIProvider.generateStructuredOutput.mockResolvedValue({
        data: buildSprintPlanContent(),
        usage: {},
        metadata: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          operation: PlanningOperation.SPRINT_PLANNING,
          latencyMs: 10,
          attempts: 1,
        },
      });
      mockHydrationReads(
        buildSprintPlanRow({
          id: 'plan-2',
          architectureId: 'architecture-2',
          version: 2,
        }),
      );

      await service.regenerate('user-1', 'project-1');

      const createArgs = prisma.sprintPlan.create.mock.calls[0][0];
      expect(createArgs.data.architectureId).toBe('architecture-2');
    });
  });

  describe('edit', () => {
    it('creates a new USER_EDITED version as a full structured replacement, preserving architecture lineage', async () => {
      prisma.sprintPlan.findFirst.mockResolvedValue(
        buildSprintPlanRow({ version: 1 }),
      );
      prisma.sprintPlan.aggregate.mockResolvedValue({ _max: { version: 1 } });
      prisma.sprintPlan.create.mockResolvedValue(
        buildSprintPlanRow({
          id: 'plan-2',
          version: 2,
          source: AnalysisSource.USER_EDITED,
          basedOnVersion: 1,
        }),
      );
      mockHydrationReads(
        buildSprintPlanRow({
          id: 'plan-2',
          version: 2,
          source: AnalysisSource.USER_EDITED,
        }),
      );

      const plan = await service.edit(
        'user-1',
        'project-1',
        buildSprintPlanContent(),
      );

      expect(plan.version).toBe(2);
      expect(plan.source).toBe(AnalysisSource.USER_EDITED);
      const createArgs = prisma.sprintPlan.create.mock.calls[0][0];
      expect(createArgs.data.basedOnVersion).toBe(1);
      expect(createArgs.data.architectureId).toBe('architecture-1');
      expect(createArgs.data.provider).toBeNull();
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
    });

    it('rejects an edit when no sprint plan exists yet', async () => {
      prisma.sprintPlan.findFirst.mockResolvedValue(null);

      await expect(
        service.edit('user-1', 'project-1', buildSprintPlanContent()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an edit payload that fails schema/graph validation', async () => {
      prisma.sprintPlan.findFirst.mockResolvedValue(buildSprintPlanRow());

      await expect(
        service.edit(
          'user-1',
          'project-1',
          buildSprintPlanContent({ summary: '' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.sprintPlan.create).not.toHaveBeenCalled();
    });

    it('rejects an edit that leaves a functional requirement uncovered', async () => {
      prisma.sprintPlan.findFirst.mockResolvedValue(buildSprintPlanRow());

      const content = buildSprintPlanContent();
      content.sprints[0].tasks[0].requirementIds = [];

      await expect(
        service.edit('user-1', 'project-1', content),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.sprintPlan.create).not.toHaveBeenCalled();
    });

    it('blocks editing for an archived project', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ archivedAt: new Date() }),
      );

      await expect(
        service.edit('user-1', 'project-1', buildSprintPlanContent()),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it.each([
      ProjectStatus.DEVELOPING,
      ProjectStatus.TESTING,
      ProjectStatus.COMPLETED,
    ])('blocks editing once the project has moved to %s', async (status) => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ status }),
      );

      await expect(
        service.edit('user-1', 'project-1', buildSprintPlanContent()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.sprintPlan.create).not.toHaveBeenCalled();
    });
  });

  describe('getCurrent / listVersions / getVersion', () => {
    it('returns the highest version as current, hydrated with its sprint/task graph', async () => {
      prisma.sprintPlan.findFirst.mockResolvedValue(
        buildSprintPlanRow({ version: 3 }),
      );
      mockHydrationReads(buildSprintPlanRow({ version: 3 }));

      const plan = await service.getCurrent('user-1', 'project-1');
      expect(plan.version).toBe(3);
      expect(plan.sprints).toHaveLength(2);
    });

    it('returns 404 when no sprint plan exists', async () => {
      prisma.sprintPlan.findFirst.mockResolvedValue(null);
      await expect(
        service.getCurrent('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lists version history ordered by version desc', async () => {
      prisma.sprintPlan.findMany.mockResolvedValue([
        { version: 2 },
        { version: 1 },
      ]);
      const versions = await service.listVersions('user-1', 'project-1');
      expect(versions).toEqual([{ version: 2 }, { version: 1 }]);
      expect(prisma.sprintPlan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { version: 'desc' } }),
      );
    });

    it("rejects access to another user's sprint plan history", async () => {
      projectsService.findOneForUser.mockRejectedValue(new NotFoundException());
      await expect(
        service.listVersions('user-2', 'project-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.sprintPlan.findMany).not.toHaveBeenCalled();
    });

    it('retrieves a specific version', async () => {
      prisma.sprintPlan.findUnique.mockResolvedValue(
        buildSprintPlanRow({ version: 1 }),
      );
      mockHydrationReads(buildSprintPlanRow({ version: 1 }));

      const plan = await service.getVersion('user-1', 'project-1', 1);
      expect(plan.version).toBe(1);
      expect(prisma.sprintPlan.findUnique).toHaveBeenCalledWith({
        where: { projectId_version: { projectId: 'project-1', version: 1 } },
      });
    });

    it('returns 404 for a version that does not exist', async () => {
      prisma.sprintPlan.findUnique.mockResolvedValue(null);
      await expect(
        service.getVersion('user-1', 'project-1', 99),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
