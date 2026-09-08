import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { AnalysisSource, ProjectStatus, RepositoryType } from '@prisma/client';
import { ArchitectureService } from './architecture.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { PlanningAIProvider } from '../ai/planning/contracts/planning-provider.interface';
import {
  PlanningAIError,
  PlanningErrorCode,
} from '../ai/planning/errors/planning-ai.error';
import { PlanningOperation } from '../ai/planning/planning-ai.constants';
import { ApprovalService } from '../approval/approval.service';

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
    status: ProjectStatus.ANALYSIS_APPROVED,
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
    promptName: 'project-analysis',
    promptVersion: '1',
    provider: 'openai',
    model: 'gpt-4o-mini',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildArchitectureContent(
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    summary: 'A modular NestJS monolith.',
    frontendArchitecture: {
      framework: 'React',
      language: 'TypeScript',
      componentStrategy: 'Hooks-based.',
    },
    backendArchitecture: {
      framework: 'NestJS',
      language: 'TypeScript',
      architecturalStyle: 'Modular monolith',
      modules: [{ name: 'interviews', responsibility: 'Manages sessions.' }],
    },
    apiArchitecture: {
      style: 'REST',
      conventions: [],
      majorResourceGroups: [],
    },
    databaseArchitecture: {
      databaseType: 'Relational',
      technology: 'PostgreSQL',
      rationale: 'Consistency.',
      majorEntities: [],
    },
    authenticationArchitecture: {
      authenticationMethod: 'JWT',
      tokenOrSessionStrategy: 'Access + refresh.',
      authorizationModel: 'Owner-only.',
    },
    integrationArchitecture: [],
    infrastructureArchitecture: { runtimeComponents: ['API server'] },
    deploymentArchitecture: {
      environments: ['production'],
      deploymentStrategy: 'Single region.',
      ciCdApproach: 'CI on push.',
      configurationStrategy: 'Env vars.',
      secretsStrategy: 'Managed secret store.',
    },
    securityArchitecture: { controls: [] },
    testingStrategy: {
      unitTesting: { approach: 'Jest' },
      integrationTesting: { approach: 'Supertest' },
      e2eTesting: { approach: 'Supertest' },
    },
    nonFunctionalDecisions: [],
    architectureDecisions: [
      {
        id: 'ADR-001',
        title: 'Modular monolith',
        context: 'MVP.',
        decision: 'Single deployable.',
        rationale: 'Simplicity.',
      },
    ],
    requirementTraceability: [
      { requirementId: 'FR-001', architectureAreas: ['backendArchitecture'] },
    ],
    unresolvedQuestions: [],
    constraints: [],
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
    source: AnalysisSource.AI_GENERATED,
    basedOnVersion: null,
    ...buildArchitectureContent(),
    promptName: 'architecture-generation',
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

describe('ArchitectureService', () => {
  let prisma: {
    architecture: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      aggregate: jest.Mock;
      create: jest.Mock;
    };
    projectAnalysis: { findFirst: jest.Mock; findUnique: jest.Mock };
    project: { update: jest.Mock };
    $transaction: jest.Mock;
  };
  let projectsService: {
    findOneForUser: jest.Mock;
    transitionStatus: jest.Mock;
  };
  let approvalService: {
    isCurrentAnalysisApproved: jest.Mock;
    isCurrentArchitectureApproved: jest.Mock;
  };
  let planningAIProvider: { generateStructuredOutput: jest.Mock };
  let service: ArchitectureService;

  beforeEach(() => {
    prisma = {
      architecture: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        aggregate: jest.fn(),
        create: jest.fn(),
      },
      projectAnalysis: {
        findFirst: jest.fn().mockResolvedValue(buildAnalysis()),
        findUnique: jest.fn().mockResolvedValue(buildAnalysis()),
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
    approvalService = {
      isCurrentAnalysisApproved: jest.fn().mockResolvedValue(true),
      isCurrentArchitectureApproved: jest.fn().mockResolvedValue(true),
    };
    planningAIProvider = { generateStructuredOutput: jest.fn() };

    service = new ArchitectureService(
      prisma as unknown as PrismaService,
      projectsService as unknown as ProjectsService,
      approvalService as unknown as ApprovalService,
      planningAIProvider as unknown as PlanningAIProvider,
    );
  });

  describe('generate', () => {
    it('generates architecture v1 from the latest analysis, using ANALYSIS_APPROVED <-> PLANNING as the lock', async () => {
      prisma.architecture.findFirst.mockResolvedValue(null);
      prisma.architecture.aggregate.mockResolvedValue({
        _max: { version: null },
      });
      prisma.architecture.create.mockResolvedValue(buildArchitectureRow());
      planningAIProvider.generateStructuredOutput.mockResolvedValue({
        data: buildArchitectureContent(),
        usage: { inputTokens: 500, outputTokens: 300, totalTokens: 800 },
        metadata: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          operation: PlanningOperation.ARCHITECTURE_GENERATION,
          latencyMs: 1200,
          attempts: 1,
          requestId: 'req-1',
        },
      });

      const architecture = await service.generate('user-1', 'project-1');

      expect(projectsService.transitionStatus).toHaveBeenNthCalledWith(
        1,
        'user-1',
        'project-1',
        ProjectStatus.ANALYSIS_APPROVED,
        ProjectStatus.PLANNING,
      );
      expect(planningAIProvider.generateStructuredOutput).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: PlanningOperation.ARCHITECTURE_GENERATION,
        }),
      );
      const createArgs = prisma.architecture.create.mock.calls[0][0];
      expect(createArgs.data.version).toBe(1);
      expect(createArgs.data.source).toBe(AnalysisSource.AI_GENERATED);
      expect(createArgs.data.projectAnalysisId).toBe('analysis-1');
      expect(createArgs.data.promptName).toBe('architecture-generation');
      expect(createArgs.data.provider).toBe('openai');
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        data: { status: ProjectStatus.ARCHITECTURE_READY },
      });
      expect(architecture.version).toBe(1);
    });

    it('rejects generation when architecture already exists (use regenerate instead)', async () => {
      prisma.architecture.findFirst.mockResolvedValue(buildArchitectureRow());

      await expect(
        service.generate('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(projectsService.transitionStatus).not.toHaveBeenCalled();
    });

    it('rejects generation when no ProjectAnalysis exists', async () => {
      prisma.projectAnalysis.findFirst.mockResolvedValue(null);

      await expect(
        service.generate('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(projectsService.transitionStatus).not.toHaveBeenCalled();
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
    });

    it('rejects generation when the current Project Analysis is not approved', async () => {
      approvalService.isCurrentAnalysisApproved.mockResolvedValue(false);

      await expect(
        service.generate('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(HttpException);
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
      prisma.architecture.findFirst.mockResolvedValue(null);
      projectsService.transitionStatus.mockRejectedValue(
        new ConflictException(
          'Project status is PLANNING, expected ANALYSIS_APPROVED',
        ),
      );

      await expect(
        service.generate('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
      expect(prisma.architecture.create).not.toHaveBeenCalled();
    });

    it('restores ANALYSIS_APPROVED and normalizes the error when the provider fails', async () => {
      prisma.architecture.findFirst.mockResolvedValue(null);
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
        ProjectStatus.ANALYSIS_APPROVED,
      );
      expect(prisma.architecture.create).not.toHaveBeenCalled();
    });

    it('rejects and does not persist when the AI result references an unknown functional requirement id', async () => {
      prisma.architecture.findFirst.mockResolvedValue(null);
      planningAIProvider.generateStructuredOutput.mockResolvedValue({
        data: buildArchitectureContent({
          requirementTraceability: [
            {
              requirementId: 'FR-999',
              architectureAreas: ['backendArchitecture'],
            },
          ],
        }),
        usage: {},
        metadata: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          operation: PlanningOperation.ARCHITECTURE_GENERATION,
          latencyMs: 10,
          attempts: 1,
        },
      });

      await expect(
        service.generate('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.architecture.create).not.toHaveBeenCalled();
      expect(projectsService.transitionStatus).toHaveBeenNthCalledWith(
        2,
        'user-1',
        'project-1',
        ProjectStatus.PLANNING,
        ProjectStatus.ANALYSIS_APPROVED,
      );
    });

    it('restores status even when persistence itself fails after a successful AI call', async () => {
      prisma.architecture.findFirst.mockResolvedValue(null);
      planningAIProvider.generateStructuredOutput.mockResolvedValue({
        data: buildArchitectureContent(),
        usage: {},
        metadata: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          operation: PlanningOperation.ARCHITECTURE_GENERATION,
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
        ProjectStatus.ANALYSIS_APPROVED,
      );
    });
  });

  describe('regenerate', () => {
    it('requires an existing architecture and creates the next version, preserving the old one', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ status: ProjectStatus.ARCHITECTURE_READY }),
      );
      prisma.architecture.findFirst.mockResolvedValue(
        buildArchitectureRow({ version: 1 }),
      );
      prisma.architecture.aggregate.mockResolvedValue({ _max: { version: 1 } });
      prisma.architecture.create.mockResolvedValue(
        buildArchitectureRow({ id: 'architecture-2', version: 2 }),
      );
      planningAIProvider.generateStructuredOutput.mockResolvedValue({
        data: buildArchitectureContent({ summary: 'Updated summary' }),
        usage: {},
        metadata: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          operation: PlanningOperation.ARCHITECTURE_GENERATION,
          latencyMs: 10,
          attempts: 1,
        },
      });

      const architecture = await service.regenerate('user-1', 'project-1');

      expect(projectsService.transitionStatus).toHaveBeenNthCalledWith(
        1,
        'user-1',
        'project-1',
        ProjectStatus.ARCHITECTURE_READY,
        ProjectStatus.PLANNING,
      );
      expect(architecture.version).toBe(2);
      expect(prisma.architecture.create).toHaveBeenCalledTimes(1);
    });

    it('also allows regenerating an already-approved current architecture, creating a new unapproved version', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ status: ProjectStatus.ARCHITECTURE_APPROVED }),
      );
      prisma.architecture.findFirst.mockResolvedValue(
        buildArchitectureRow({ version: 1 }),
      );
      prisma.architecture.aggregate.mockResolvedValue({ _max: { version: 1 } });
      prisma.architecture.create.mockResolvedValue(
        buildArchitectureRow({ id: 'architecture-2', version: 2 }),
      );
      planningAIProvider.generateStructuredOutput.mockResolvedValue({
        data: buildArchitectureContent(),
        usage: {},
        metadata: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          operation: PlanningOperation.ARCHITECTURE_GENERATION,
          latencyMs: 10,
          attempts: 1,
        },
      });

      await service.regenerate('user-1', 'project-1');

      expect(projectsService.transitionStatus).toHaveBeenNthCalledWith(
        1,
        'user-1',
        'project-1',
        ProjectStatus.ARCHITECTURE_APPROVED,
        ProjectStatus.PLANNING,
      );
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        data: { status: ProjectStatus.ARCHITECTURE_READY },
      });
    });

    it('rejects regeneration when no architecture exists yet', async () => {
      prisma.architecture.findFirst.mockResolvedValue(null);

      await expect(
        service.regenerate('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
    });

    it('rejects regeneration when the current Project Analysis is no longer approved', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ status: ProjectStatus.ARCHITECTURE_READY }),
      );
      prisma.architecture.findFirst.mockResolvedValue(buildArchitectureRow());
      approvalService.isCurrentAnalysisApproved.mockResolvedValue(false);

      await expect(
        service.regenerate('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(HttpException);
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
    });

    it('rejects regeneration from a status that is neither ARCHITECTURE_READY nor ARCHITECTURE_APPROVED', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ status: ProjectStatus.ANALYSIS_APPROVED }),
      );
      prisma.architecture.findFirst.mockResolvedValue(buildArchitectureRow());

      await expect(
        service.regenerate('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
    });

    it('restores ARCHITECTURE_READY and preserves the existing architecture when regeneration fails', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ status: ProjectStatus.ARCHITECTURE_READY }),
      );
      prisma.architecture.findFirst.mockResolvedValue(buildArchitectureRow());
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
        ProjectStatus.ARCHITECTURE_READY,
      );
      expect(prisma.architecture.create).not.toHaveBeenCalled();
    });
  });

  describe('edit', () => {
    it('creates a new USER_EDITED version, preserving projectAnalysisId lineage and merging untouched sections', async () => {
      prisma.architecture.findFirst.mockResolvedValue(
        buildArchitectureRow({ version: 1 }),
      );
      prisma.architecture.aggregate.mockResolvedValue({ _max: { version: 1 } });
      prisma.architecture.create.mockResolvedValue(
        buildArchitectureRow({
          id: 'architecture-2',
          version: 2,
          source: AnalysisSource.USER_EDITED,
          basedOnVersion: 1,
          summary: 'Manually edited summary',
        }),
      );

      const architecture = await service.edit('user-1', 'project-1', {
        summary: 'Manually edited summary',
      });

      expect(architecture.version).toBe(2);
      expect(architecture.source).toBe(AnalysisSource.USER_EDITED);
      const createArgs = prisma.architecture.create.mock.calls[0][0];
      expect(createArgs.data.basedOnVersion).toBe(1);
      expect(createArgs.data.projectAnalysisId).toBe('analysis-1');
      expect(createArgs.data.summary).toBe('Manually edited summary');
      expect(createArgs.data.provider).toBeNull();
      expect(createArgs.data.model).toBeNull();
      // Untouched section carries over (schema validation may still fill in
      // its own missing optional-array defaults, e.g. keyLibraries: []).
      expect(createArgs.data.backendArchitecture).toMatchObject(
        buildArchitectureContent().backendArchitecture,
      );
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
    });

    it('rejects an edit when no architecture exists yet', async () => {
      prisma.architecture.findFirst.mockResolvedValue(null);

      await expect(
        service.edit('user-1', 'project-1', { summary: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an edit payload that fails schema validation', async () => {
      prisma.architecture.findFirst.mockResolvedValue(buildArchitectureRow());

      await expect(
        service.edit('user-1', 'project-1', {
          backendArchitecture: { framework: 'NestJS' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.architecture.create).not.toHaveBeenCalled();
    });

    it('rejects an edit that references an unknown functional requirement id', async () => {
      prisma.architecture.findFirst.mockResolvedValue(buildArchitectureRow());

      await expect(
        service.edit('user-1', 'project-1', {
          requirementTraceability: [
            {
              requirementId: 'FR-999',
              architectureAreas: ['backendArchitecture'],
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.architecture.create).not.toHaveBeenCalled();
    });

    it('blocks editing for an archived project', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ archivedAt: new Date() }),
      );

      await expect(
        service.edit('user-1', 'project-1', { summary: 'x' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('getCurrent / listVersions / getVersion', () => {
    it('returns the highest version as current', async () => {
      prisma.architecture.findFirst.mockResolvedValue(
        buildArchitectureRow({ version: 3 }),
      );

      const architecture = await service.getCurrent('user-1', 'project-1');
      expect(architecture.version).toBe(3);
    });

    it('returns 404 when no architecture exists', async () => {
      prisma.architecture.findFirst.mockResolvedValue(null);
      await expect(
        service.getCurrent('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lists version history ordered by version desc', async () => {
      prisma.architecture.findMany.mockResolvedValue([
        { version: 2 },
        { version: 1 },
      ]);
      const versions = await service.listVersions('user-1', 'project-1');
      expect(versions).toEqual([{ version: 2 }, { version: 1 }]);
      expect(prisma.architecture.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { version: 'desc' } }),
      );
    });

    it("rejects access to another user's architecture history", async () => {
      projectsService.findOneForUser.mockRejectedValue(new NotFoundException());
      await expect(
        service.listVersions('user-2', 'project-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.architecture.findMany).not.toHaveBeenCalled();
    });

    it('retrieves a specific version', async () => {
      prisma.architecture.findUnique.mockResolvedValue(
        buildArchitectureRow({ version: 1 }),
      );
      const architecture = await service.getVersion('user-1', 'project-1', 1);
      expect(architecture.version).toBe(1);
      expect(prisma.architecture.findUnique).toHaveBeenCalledWith({
        where: { projectId_version: { projectId: 'project-1', version: 1 } },
      });
    });

    it('returns 404 for a version that does not exist', async () => {
      prisma.architecture.findUnique.mockResolvedValue(null);
      await expect(
        service.getVersion('user-1', 'project-1', 99),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
