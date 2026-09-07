import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { AnalysisSource, ProjectStatus, RepositoryType } from '@prisma/client';
import { ProjectAnalysisService } from './project-analysis.service';
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
    status: ProjectStatus.DRAFT,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildAnalysisContent(
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    summary: 'A mock interview platform.',
    targetUsers: [{ name: 'Job seekers', description: 'Engineers', needs: [] }],
    goals: [{ title: 'Confidence', description: 'Feel prepared' }],
    features: [
      {
        name: 'Mock interviews',
        description: 'AI-led sessions',
        priority: 'must_have',
      },
    ],
    functionalRequirements: [
      {
        id: 'FR-001',
        title: 'Start interview',
        description: 'Start a session',
        priority: 'must_have',
      },
    ],
    nonFunctionalRequirements: [
      { category: 'performance', requirement: 'Fast responses' },
    ],
    assumptions: [{ assumption: 'Users have a mic.' }],
    risks: [{ risk: 'Audio quality', severity: 'medium' }],
    unresolvedQuestions: [
      { question: 'Record sessions?', importance: 'medium' },
    ],
    integrations: [
      { name: 'STT API', purpose: 'Transcription', required: true },
    ],
    ...overrides,
  };
}

function buildAnalysisRow(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    id: 'analysis-1',
    projectId: 'project-1',
    version: 1,
    source: AnalysisSource.AI_GENERATED,
    basedOnVersion: null,
    ...buildAnalysisContent(),
    promptName: 'project-analysis',
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

describe('ProjectAnalysisService', () => {
  let prisma: {
    projectAnalysis: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      aggregate: jest.Mock;
      create: jest.Mock;
    };
    project: { update: jest.Mock };
    $transaction: jest.Mock;
  };
  let projectsService: {
    findOneForUser: jest.Mock;
    transitionStatus: jest.Mock;
  };
  let planningAIProvider: { generateStructuredOutput: jest.Mock };
  let service: ProjectAnalysisService;

  beforeEach(() => {
    prisma = {
      projectAnalysis: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        aggregate: jest.fn(),
        create: jest.fn(),
      },
      project: { update: jest.fn() },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    projectsService = {
      findOneForUser: jest.fn().mockResolvedValue(buildProject()),
      transitionStatus: jest
        .fn()
        .mockResolvedValue(buildProject({ status: ProjectStatus.ANALYZING })),
    };
    planningAIProvider = { generateStructuredOutput: jest.fn() };

    service = new ProjectAnalysisService(
      prisma as unknown as PrismaService,
      projectsService as unknown as ProjectsService,
      planningAIProvider as unknown as PlanningAIProvider,
    );
  });

  describe('generate', () => {
    it('generates an initial analysis: DRAFT -> ANALYZING -> ANALYSIS_READY, version 1', async () => {
      prisma.projectAnalysis.aggregate.mockResolvedValue({
        _max: { version: null },
      });
      prisma.projectAnalysis.create.mockResolvedValue(buildAnalysisRow());
      planningAIProvider.generateStructuredOutput.mockResolvedValue({
        data: buildAnalysisContent(),
        usage: { inputTokens: 500, outputTokens: 300, totalTokens: 800 },
        metadata: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          operation: PlanningOperation.PROJECT_ANALYSIS,
          latencyMs: 1200,
          attempts: 1,
          requestId: 'req-1',
        },
      });

      const analysis = await service.generate('user-1', 'project-1');

      expect(projectsService.transitionStatus).toHaveBeenCalledWith(
        'user-1',
        'project-1',
        ProjectStatus.DRAFT,
        ProjectStatus.ANALYZING,
      );
      expect(planningAIProvider.generateStructuredOutput).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: PlanningOperation.PROJECT_ANALYSIS,
        }),
      );
      const createArgs = prisma.projectAnalysis.create.mock.calls[0][0];
      expect(createArgs.data.version).toBe(1);
      expect(createArgs.data.source).toBe(AnalysisSource.AI_GENERATED);
      expect(createArgs.data.promptName).toBe('project-analysis');
      expect(createArgs.data.promptVersion).toBe('1');
      expect(createArgs.data.provider).toBe('openai');
      expect(createArgs.data.model).toBe('gpt-4o-mini');
      expect(createArgs.data.inputTokens).toBe(500);
      expect(createArgs.data.outputTokens).toBe(300);
      expect(createArgs.data.totalTokens).toBe(800);
      expect(createArgs.data.latencyMs).toBe(1200);
      expect(createArgs.data.attempts).toBe(1);
      expect(createArgs.data.providerRequestId).toBe('req-1');
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        data: { status: ProjectStatus.ANALYSIS_READY },
      });
      expect(analysis.version).toBe(1);
    });

    it('blocks a non-owned project (ownership enforced via ProjectsService)', async () => {
      projectsService.findOneForUser.mockRejectedValue(
        new NotFoundException('Project not found'),
      );

      await expect(
        service.generate('user-2', 'project-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(projectsService.transitionStatus).not.toHaveBeenCalled();
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
      projectsService.transitionStatus.mockRejectedValue(
        new ConflictException('Project status is ANALYZING, expected DRAFT'),
      );

      await expect(
        service.generate('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
      expect(prisma.projectAnalysis.create).not.toHaveBeenCalled();
    });

    it('restores DRAFT and normalizes the error when the provider fails on first generation', async () => {
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
        ProjectStatus.ANALYZING,
        ProjectStatus.DRAFT,
      );
      expect(prisma.projectAnalysis.create).not.toHaveBeenCalled();
    });

    it('never persists when the provider reports an invalid structured response', async () => {
      planningAIProvider.generateStructuredOutput.mockRejectedValue(
        new PlanningAIError({
          code: PlanningErrorCode.INVALID_STRUCTURED_RESPONSE,
          message: 'schema mismatch',
          provider: 'openai',
          retryable: false,
        }),
      );

      await expect(
        service.generate('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.projectAnalysis.create).not.toHaveBeenCalled();
      expect(projectsService.transitionStatus).toHaveBeenNthCalledWith(
        2,
        'user-1',
        'project-1',
        ProjectStatus.ANALYZING,
        ProjectStatus.DRAFT,
      );
    });

    it('restores status even when persistence itself fails after a successful AI call', async () => {
      planningAIProvider.generateStructuredOutput.mockResolvedValue({
        data: buildAnalysisContent(),
        usage: {},
        metadata: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          operation: PlanningOperation.PROJECT_ANALYSIS,
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
        ProjectStatus.ANALYZING,
        ProjectStatus.DRAFT,
      );
    });
  });

  describe('regenerate', () => {
    it('requires ANALYSIS_READY and creates the next version, preserving the old one', async () => {
      prisma.projectAnalysis.aggregate.mockResolvedValue({
        _max: { version: 1 },
      });
      prisma.projectAnalysis.create.mockResolvedValue(
        buildAnalysisRow({ id: 'analysis-2', version: 2 }),
      );
      planningAIProvider.generateStructuredOutput.mockResolvedValue({
        data: buildAnalysisContent({ summary: 'Updated summary' }),
        usage: {},
        metadata: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          operation: PlanningOperation.PROJECT_ANALYSIS,
          latencyMs: 10,
          attempts: 1,
        },
      });

      const analysis = await service.regenerate('user-1', 'project-1');

      expect(projectsService.transitionStatus).toHaveBeenCalledWith(
        'user-1',
        'project-1',
        ProjectStatus.ANALYSIS_READY,
        ProjectStatus.ANALYZING,
      );
      expect(analysis.version).toBe(2);
      // The old version-1 row is never touched/deleted by regeneration.
      expect(prisma.projectAnalysis.create).toHaveBeenCalledTimes(1);
    });

    it('restores ANALYSIS_READY (not DRAFT) when regeneration fails', async () => {
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
        ProjectStatus.ANALYZING,
        ProjectStatus.ANALYSIS_READY,
      );
    });
  });

  describe('edit', () => {
    it('creates a new USER_EDITED version based on the current one, merging only provided fields', async () => {
      prisma.projectAnalysis.findFirst.mockResolvedValue(
        buildAnalysisRow({ version: 1 }),
      );
      prisma.projectAnalysis.aggregate.mockResolvedValue({
        _max: { version: 1 },
      });
      prisma.projectAnalysis.create.mockResolvedValue(
        buildAnalysisRow({
          id: 'analysis-2',
          version: 2,
          source: AnalysisSource.USER_EDITED,
          basedOnVersion: 1,
          summary: 'Manually edited summary',
        }),
      );

      const analysis = await service.edit('user-1', 'project-1', {
        summary: 'Manually edited summary',
      });

      expect(analysis.version).toBe(2);
      expect(analysis.source).toBe(AnalysisSource.USER_EDITED);
      const createArgs = prisma.projectAnalysis.create.mock.calls[0][0];
      expect(createArgs.data.basedOnVersion).toBe(1);
      expect(createArgs.data.summary).toBe('Manually edited summary');
      // AI metadata is never fabricated for a user-edited version.
      expect(createArgs.data.provider).toBeNull();
      expect(createArgs.data.model).toBeNull();
      expect(createArgs.data.inputTokens).toBeNull();
      // Untouched sections carry over from the current version.
      expect(createArgs.data.features).toEqual(buildAnalysisContent().features);
      // Editing does not call the AI provider at all.
      expect(
        planningAIProvider.generateStructuredOutput,
      ).not.toHaveBeenCalled();
    });

    it('rejects an edit when no analysis exists yet', async () => {
      prisma.projectAnalysis.findFirst.mockResolvedValue(null);

      await expect(
        service.edit('user-1', 'project-1', { summary: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an edit payload that fails schema validation', async () => {
      prisma.projectAnalysis.findFirst.mockResolvedValue(buildAnalysisRow());

      await expect(
        service.edit('user-1', 'project-1', { features: [{ name: 'X' }] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.projectAnalysis.create).not.toHaveBeenCalled();
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
      prisma.projectAnalysis.findFirst.mockResolvedValue(
        buildAnalysisRow({ version: 3 }),
      );

      const analysis = await service.getCurrent('user-1', 'project-1');
      expect(analysis.version).toBe(3);
      expect(prisma.projectAnalysis.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: 'project-1' },
          orderBy: { version: 'desc' },
        }),
      );
    });

    it('returns 404 when no analysis exists', async () => {
      prisma.projectAnalysis.findFirst.mockResolvedValue(null);
      await expect(
        service.getCurrent('user-1', 'project-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lists version history ordered by version desc', async () => {
      prisma.projectAnalysis.findMany.mockResolvedValue([
        { version: 2 },
        { version: 1 },
      ]);
      const versions = await service.listVersions('user-1', 'project-1');
      expect(versions).toEqual([{ version: 2 }, { version: 1 }]);
      expect(prisma.projectAnalysis.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { version: 'desc' } }),
      );
    });

    it("rejects access to another user's analysis history", async () => {
      projectsService.findOneForUser.mockRejectedValue(new NotFoundException());
      await expect(
        service.listVersions('user-2', 'project-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.projectAnalysis.findMany).not.toHaveBeenCalled();
    });

    it('retrieves a specific version', async () => {
      prisma.projectAnalysis.findUnique.mockResolvedValue(
        buildAnalysisRow({ version: 1 }),
      );
      const analysis = await service.getVersion('user-1', 'project-1', 1);
      expect(analysis.version).toBe(1);
      expect(prisma.projectAnalysis.findUnique).toHaveBeenCalledWith({
        where: { projectId_version: { projectId: 'project-1', version: 1 } },
      });
    });

    it('returns 404 for a version that does not exist', async () => {
      prisma.projectAnalysis.findUnique.mockResolvedValue(null);
      await expect(
        service.getVersion('user-1', 'project-1', 99),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
