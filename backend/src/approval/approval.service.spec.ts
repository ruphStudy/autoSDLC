import {
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalArtifactType,
  ApprovalDecision,
  ApprovalStage,
  ProjectStatus,
  RepositoryType,
} from '@prisma/client';
import { ApprovalService } from './approval.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ApprovalError, ApprovalErrorCode } from './errors/approval.error';

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

function buildApprovalRow(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    id: 'approval-1',
    projectId: 'project-1',
    stage: ApprovalStage.ANALYSIS,
    decision: ApprovalDecision.APPROVED,
    artifactType: ApprovalArtifactType.PROJECT_ANALYSIS,
    projectAnalysisId: 'analysis-1',
    architectureId: null,
    sprintPlanId: null,
    comment: null,
    decidedByUserId: 'user-1',
    decidedAt: now,
    createdAt: now,
    updatedAt: now,
    projectAnalysis: { version: 1 },
    architecture: null,
    sprintPlan: null,
    ...overrides,
  };
}

describe('ApprovalService', () => {
  let prisma: {
    projectAnalysis: { findFirst: jest.Mock; findUnique: jest.Mock };
    architecture: { findFirst: jest.Mock; findUnique: jest.Mock };
    sprintPlan: { findFirst: jest.Mock; findUnique: jest.Mock };
    approval: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
    };
    project: { update: jest.Mock };
    $transaction: jest.Mock;
  };
  let projectsService: { findOneForUser: jest.Mock };
  let service: ApprovalService;

  beforeEach(() => {
    prisma = {
      projectAnalysis: {
        findFirst: jest.fn().mockResolvedValue({ id: 'analysis-1' }),
        findUnique: jest.fn().mockResolvedValue({ projectId: 'project-1' }),
      },
      architecture: {
        findFirst: jest.fn().mockResolvedValue({ id: 'architecture-1' }),
        findUnique: jest.fn().mockResolvedValue({ projectId: 'project-1' }),
      },
      sprintPlan: {
        findFirst: jest.fn().mockResolvedValue({ id: 'sprint-plan-1' }),
        findUnique: jest.fn().mockResolvedValue({ projectId: 'project-1' }),
      },
      approval: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      project: { update: jest.fn() },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    projectsService = {
      findOneForUser: jest.fn().mockResolvedValue(buildProject()),
    };

    service = new ApprovalService(
      prisma as unknown as PrismaService,
      projectsService as unknown as ProjectsService,
    );
  });

  describe('isCurrentXApproved helpers', () => {
    it('isCurrentAnalysisApproved is false when no analysis exists', async () => {
      prisma.projectAnalysis.findFirst.mockResolvedValue(null);
      expect(await service.isCurrentAnalysisApproved('project-1')).toBe(false);
    });

    it('isCurrentAnalysisApproved is false when no decision exists for the current version', async () => {
      prisma.approval.findFirst.mockResolvedValue(null);
      expect(await service.isCurrentAnalysisApproved('project-1')).toBe(false);
    });

    it('isCurrentAnalysisApproved is true only when the latest decision for the exact current version is APPROVED', async () => {
      prisma.approval.findFirst.mockResolvedValue({
        decision: ApprovalDecision.APPROVED,
      });
      expect(await service.isCurrentAnalysisApproved('project-1')).toBe(true);
      expect(prisma.approval.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            stage: ApprovalStage.ANALYSIS,
            projectAnalysisId: 'analysis-1',
          },
          orderBy: { decidedAt: 'desc' },
        }),
      );
    });

    it('isCurrentAnalysisApproved is false when the latest decision for the current version is CHANGES_REQUESTED', async () => {
      prisma.approval.findFirst.mockResolvedValue({
        decision: ApprovalDecision.CHANGES_REQUESTED,
      });
      expect(await service.isCurrentAnalysisApproved('project-1')).toBe(false);
    });

    it('does not consider an approval tied to an older, superseded version as approving the current one', async () => {
      // The approved decision the mock would return is scoped by
      // projectAnalysisId in the where-clause, so a stale-version approval
      // (a different id) simply never matches this query — modelled here by
      // returning null, exactly as Prisma would for a non-matching filter.
      prisma.approval.findFirst.mockResolvedValue(null);
      expect(await service.isCurrentAnalysisApproved('project-1')).toBe(false);
    });

    it('isCurrentArchitectureApproved checks the ARCHITECTURE stage against the current architecture id', async () => {
      prisma.approval.findFirst.mockResolvedValue({
        decision: ApprovalDecision.APPROVED,
      });
      expect(await service.isCurrentArchitectureApproved('project-1')).toBe(
        true,
      );
      expect(prisma.approval.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            stage: ApprovalStage.ARCHITECTURE,
            architectureId: 'architecture-1',
          },
        }),
      );
    });

    it('isCurrentSprintPlanApproved checks the SPRINT_PLAN stage against the current sprint plan id', async () => {
      prisma.approval.findFirst.mockResolvedValue({
        decision: ApprovalDecision.APPROVED,
      });
      expect(await service.isCurrentSprintPlanApproved('project-1')).toBe(true);
      expect(prisma.approval.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            stage: ApprovalStage.SPRINT_PLAN,
            sprintPlanId: 'sprint-plan-1',
          },
        }),
      );
    });
  });

  describe('assertDevelopmentApproved', () => {
    it('throws when any of the three current artifacts is not approved', async () => {
      prisma.approval.findFirst.mockResolvedValue(null);
      await expect(
        service.assertDevelopmentApproved('project-1'),
      ).rejects.toBeInstanceOf(ApprovalError);
    });

    it('throws when all three artifacts are approved but Start Development itself was never approved', async () => {
      prisma.approval.findFirst.mockImplementation(({ where }) => {
        if (where.stage === ApprovalStage.START_DEVELOPMENT)
          return Promise.resolve(null);
        return Promise.resolve({ decision: ApprovalDecision.APPROVED });
      });
      await expect(
        service.assertDevelopmentApproved('project-1'),
      ).rejects.toBeInstanceOf(ApprovalError);
    });

    it('succeeds when all three artifacts and Start Development are all approved', async () => {
      prisma.approval.findFirst.mockResolvedValue({
        decision: ApprovalDecision.APPROVED,
      });
      await expect(
        service.assertDevelopmentApproved('project-1'),
      ).resolves.toBeUndefined();
    });

    it('fails live if an upstream artifact was edited after Start Development was approved (no stale snapshot trusted)', async () => {
      // Analysis version changed after Start Development approval: the
      // ANALYSIS-stage lookup (scoped to the *new* current analysis id) now
      // finds nothing, even though START_DEVELOPMENT itself is APPROVED.
      prisma.approval.findFirst.mockImplementation(({ where }) => {
        if (where.stage === ApprovalStage.ANALYSIS)
          return Promise.resolve(null);
        return Promise.resolve({ decision: ApprovalDecision.APPROVED });
      });
      await expect(
        service.assertDevelopmentApproved('project-1'),
      ).rejects.toMatchObject({
        code: ApprovalErrorCode.DEVELOPMENT_PREREQUISITES_MISSING,
      });
    });
  });

  describe('decide - ANALYSIS stage', () => {
    it('approves the current analysis and moves ANALYSIS_READY -> ANALYSIS_APPROVED', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ status: ProjectStatus.ANALYSIS_READY }),
      );
      prisma.approval.create.mockResolvedValue(buildApprovalRow());

      const result = await service.decide(
        'user-1',
        'project-1',
        ApprovalStage.ANALYSIS,
        {
          decision: ApprovalDecision.APPROVED,
        },
      );

      expect(result.decision).toBe(ApprovalDecision.APPROVED);
      expect(prisma.approval.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: 'project-1',
            stage: ApprovalStage.ANALYSIS,
            decision: ApprovalDecision.APPROVED,
            artifactType: ApprovalArtifactType.PROJECT_ANALYSIS,
            projectAnalysisId: 'analysis-1',
            decidedByUserId: 'user-1',
          }),
        }),
      );
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        data: { status: ProjectStatus.ANALYSIS_APPROVED },
      });
    });

    it('does not move ProjectStatus when the project has already moved past ANALYSIS_READY', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ status: ProjectStatus.ARCHITECTURE_READY }),
      );
      prisma.approval.create.mockResolvedValue(buildApprovalRow());

      await service.decide('user-1', 'project-1', ApprovalStage.ANALYSIS, {
        decision: ApprovalDecision.APPROVED,
      });

      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it('records CHANGES_REQUESTED with a comment and never touches ProjectStatus', async () => {
      prisma.approval.create.mockResolvedValue(
        buildApprovalRow({
          decision: ApprovalDecision.CHANGES_REQUESTED,
          comment: 'Needs stronger acceptance criteria.',
        }),
      );

      const result = await service.decide(
        'user-1',
        'project-1',
        ApprovalStage.ANALYSIS,
        {
          decision: ApprovalDecision.CHANGES_REQUESTED,
          comment: 'Needs stronger acceptance criteria.',
        },
      );

      expect(result.decision).toBe(ApprovalDecision.CHANGES_REQUESTED);
      expect(result.comment).toBe('Needs stronger acceptance criteria.');
      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it('rejects CHANGES_REQUESTED without a comment', async () => {
      await expect(
        service.decide('user-1', 'project-1', ApprovalStage.ANALYSIS, {
          decision: ApprovalDecision.CHANGES_REQUESTED,
        }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.approval.create).not.toHaveBeenCalled();
    });

    it('rejects CHANGES_REQUESTED with a blank/whitespace-only comment', async () => {
      await expect(
        service.decide('user-1', 'project-1', ApprovalStage.ANALYSIS, {
          decision: ApprovalDecision.CHANGES_REQUESTED,
          comment: '   ',
        }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.approval.create).not.toHaveBeenCalled();
    });

    it('rejects approving Analysis when no current analysis exists', async () => {
      prisma.projectAnalysis.findFirst.mockResolvedValue(null);

      await expect(
        service.decide('user-1', 'project-1', ApprovalStage.ANALYSIS, {
          decision: ApprovalDecision.APPROVED,
        }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.approval.create).not.toHaveBeenCalled();
    });

    it('rejects approvals for an archived project', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ archivedAt: new Date() }),
      );

      await expect(
        service.decide('user-1', 'project-1', ApprovalStage.ANALYSIS, {
          decision: ApprovalDecision.APPROVED,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("rejects access to another user's project", async () => {
      projectsService.findOneForUser.mockRejectedValue(new NotFoundException());

      await expect(
        service.decide('user-2', 'project-1', ApprovalStage.ANALYSIS, {
          decision: ApprovalDecision.APPROVED,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('decide - ARCHITECTURE stage (approval dependency chain)', () => {
    it('rejects approving Architecture when the current Analysis is not approved', async () => {
      prisma.approval.findFirst.mockResolvedValue(null);

      await expect(
        service.decide('user-1', 'project-1', ApprovalStage.ARCHITECTURE, {
          decision: ApprovalDecision.APPROVED,
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: ApprovalErrorCode.PREREQUISITE_MISSING,
        }),
      });
      expect(prisma.approval.create).not.toHaveBeenCalled();
    });

    it('approves Architecture once the current Analysis is approved, moving ARCHITECTURE_READY -> ARCHITECTURE_APPROVED', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ status: ProjectStatus.ARCHITECTURE_READY }),
      );
      prisma.approval.findFirst.mockImplementation(({ where }) => {
        if (where.stage === ApprovalStage.ANALYSIS) {
          return Promise.resolve({ decision: ApprovalDecision.APPROVED });
        }
        return Promise.resolve(null);
      });
      prisma.approval.create.mockResolvedValue(
        buildApprovalRow({
          stage: ApprovalStage.ARCHITECTURE,
          artifactType: ApprovalArtifactType.ARCHITECTURE,
          projectAnalysisId: null,
          architectureId: 'architecture-1',
          projectAnalysis: null,
          architecture: { version: 1 },
        }),
      );

      const result = await service.decide(
        'user-1',
        'project-1',
        ApprovalStage.ARCHITECTURE,
        {
          decision: ApprovalDecision.APPROVED,
        },
      );

      expect(result.artifactVersion).toBe(1);
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        data: { status: ProjectStatus.ARCHITECTURE_APPROVED },
      });
    });

    it('allows requesting changes on Architecture even when Analysis is not approved (no upstream gate on rejection)', async () => {
      prisma.approval.findFirst.mockResolvedValue(null);
      prisma.approval.create.mockResolvedValue(
        buildApprovalRow({
          stage: ApprovalStage.ARCHITECTURE,
          decision: ApprovalDecision.CHANGES_REQUESTED,
          comment: 'Needs work.',
          architectureId: 'architecture-1',
          projectAnalysisId: null,
          projectAnalysis: null,
          architecture: { version: 1 },
        }),
      );

      const result = await service.decide(
        'user-1',
        'project-1',
        ApprovalStage.ARCHITECTURE,
        {
          decision: ApprovalDecision.CHANGES_REQUESTED,
          comment: 'Needs work.',
        },
      );

      expect(result.decision).toBe(ApprovalDecision.CHANGES_REQUESTED);
    });

    it('rejects approving Architecture when no current architecture exists', async () => {
      prisma.architecture.findFirst.mockResolvedValue(null);

      await expect(
        service.decide('user-1', 'project-1', ApprovalStage.ARCHITECTURE, {
          decision: ApprovalDecision.APPROVED,
        }),
      ).rejects.toBeInstanceOf(HttpException);
    });
  });

  describe('decide - SPRINT_PLAN stage (approval dependency chain)', () => {
    it('rejects approving Sprint Plan unless both Analysis and Architecture are approved', async () => {
      prisma.approval.findFirst.mockImplementation(({ where }) => {
        if (where.stage === ApprovalStage.ANALYSIS) {
          return Promise.resolve({ decision: ApprovalDecision.APPROVED });
        }
        return Promise.resolve(null); // ARCHITECTURE not approved
      });

      await expect(
        service.decide('user-1', 'project-1', ApprovalStage.SPRINT_PLAN, {
          decision: ApprovalDecision.APPROVED,
        }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.approval.create).not.toHaveBeenCalled();
    });

    it('approves Sprint Plan once both Analysis and Architecture are approved, moving PLAN_READY -> PLAN_APPROVED', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ status: ProjectStatus.PLAN_READY }),
      );
      prisma.approval.findFirst.mockImplementation(({ where }) => {
        if (where.stage === ApprovalStage.SPRINT_PLAN)
          return Promise.resolve(null);
        return Promise.resolve({ decision: ApprovalDecision.APPROVED });
      });
      prisma.approval.create.mockResolvedValue(
        buildApprovalRow({
          stage: ApprovalStage.SPRINT_PLAN,
          artifactType: ApprovalArtifactType.SPRINT_PLAN,
          projectAnalysisId: null,
          sprintPlanId: 'sprint-plan-1',
          projectAnalysis: null,
          sprintPlan: { version: 1 },
        }),
      );

      await service.decide('user-1', 'project-1', ApprovalStage.SPRINT_PLAN, {
        decision: ApprovalDecision.APPROVED,
      });

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        data: { status: ProjectStatus.PLAN_APPROVED },
      });
    });
  });

  describe('decide - START_DEVELOPMENT stage', () => {
    it('rejects CHANGES_REQUESTED for Start Development entirely', async () => {
      await expect(
        service.decide('user-1', 'project-1', ApprovalStage.START_DEVELOPMENT, {
          decision: ApprovalDecision.CHANGES_REQUESTED,
          comment: 'x',
        }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.approval.create).not.toHaveBeenCalled();
    });

    it('rejects approval until current Analysis, Architecture, and Sprint Plan are all approved', async () => {
      prisma.approval.findFirst.mockResolvedValue(null);

      await expect(
        service.decide('user-1', 'project-1', ApprovalStage.START_DEVELOPMENT, {
          decision: ApprovalDecision.APPROVED,
        }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(prisma.approval.create).not.toHaveBeenCalled();
    });

    it('approves Start Development once all three are approved, moving PLAN_APPROVED -> DEVELOPMENT_APPROVED', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ status: ProjectStatus.PLAN_APPROVED }),
      );
      prisma.approval.findFirst.mockImplementation(({ where }) => {
        if (where.stage === ApprovalStage.START_DEVELOPMENT)
          return Promise.resolve(null);
        return Promise.resolve({ decision: ApprovalDecision.APPROVED });
      });
      prisma.approval.create.mockResolvedValue(
        buildApprovalRow({
          stage: ApprovalStage.START_DEVELOPMENT,
          artifactType: ApprovalArtifactType.PROJECT,
          projectAnalysisId: null,
          projectAnalysis: null,
        }),
      );

      await service.decide(
        'user-1',
        'project-1',
        ApprovalStage.START_DEVELOPMENT,
        {
          decision: ApprovalDecision.APPROVED,
        },
      );

      expect(prisma.approval.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stage: ApprovalStage.START_DEVELOPMENT,
            projectAnalysisId: null,
            architectureId: null,
            sprintPlanId: null,
          }),
        }),
      );
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        data: { status: ProjectStatus.DEVELOPMENT_APPROVED },
      });
    });
  });

  describe('idempotency and staleness', () => {
    it('returns the existing row instead of creating a duplicate on an exact repeated decision', async () => {
      const existing = buildApprovalRow();
      prisma.approval.findFirst.mockResolvedValue(existing);

      const result = await service.decide(
        'user-1',
        'project-1',
        ApprovalStage.ANALYSIS,
        {
          decision: ApprovalDecision.APPROVED,
        },
      );

      expect(result.id).toBe('approval-1');
      expect(prisma.approval.create).not.toHaveBeenCalled();
    });

    it('creates a new row when the comment differs from the latest identical-decision row', async () => {
      prisma.approval.findFirst.mockResolvedValue(
        buildApprovalRow({
          decision: ApprovalDecision.CHANGES_REQUESTED,
          comment: 'First round of feedback.',
        }),
      );
      prisma.approval.create.mockResolvedValue(
        buildApprovalRow({
          id: 'approval-2',
          decision: ApprovalDecision.CHANGES_REQUESTED,
          comment: 'Second round of feedback.',
        }),
      );

      const result = await service.decide(
        'user-1',
        'project-1',
        ApprovalStage.ANALYSIS,
        {
          decision: ApprovalDecision.CHANGES_REQUESTED,
          comment: 'Second round of feedback.',
        },
      );

      expect(result.id).toBe('approval-2');
      expect(prisma.approval.create).toHaveBeenCalledTimes(1);
    });

    it('rejects the decision as stale when the artifact stopped being current inside the transaction', async () => {
      // The version resolved just before persistence (analysis-1) no longer
      // matches the freshest row read inside the same transaction.
      prisma.projectAnalysis.findUnique.mockResolvedValue({
        projectId: 'project-1',
      });
      prisma.projectAnalysis.findFirst
        .mockResolvedValueOnce({ id: 'analysis-1' }) // outer resolve for decideAnalysis
        .mockResolvedValueOnce({ id: 'analysis-2' }); // inside tx: a newer version now exists

      await expect(
        service.decide('user-1', 'project-1', ApprovalStage.ANALYSIS, {
          decision: ApprovalDecision.APPROVED,
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: ApprovalErrorCode.VERSION_STALE,
        }),
      });
      expect(prisma.approval.create).not.toHaveBeenCalled();
    });
  });

  describe('reads', () => {
    it('getCurrentStatus returns null decision fields when no artifact exists yet', async () => {
      prisma.projectAnalysis.findFirst.mockResolvedValue(null);

      const status = await service.getCurrentStatus(
        'user-1',
        'project-1',
        ApprovalStage.ANALYSIS,
      );
      expect(status).toEqual({
        stage: ApprovalStage.ANALYSIS,
        currentVersion: null,
        decision: null,
        comment: null,
        decidedAt: null,
        decidedByUserId: null,
      });
    });

    it('getCurrentStatus reflects the latest decision tied to the exact current version', async () => {
      prisma.projectAnalysis.findFirst.mockResolvedValue({
        id: 'analysis-1',
        version: 2,
      });
      const decidedAt = new Date();
      prisma.approval.findFirst.mockResolvedValue({
        decision: ApprovalDecision.APPROVED,
        comment: null,
        decidedAt,
        decidedByUserId: 'user-1',
      });

      const status = await service.getCurrentStatus(
        'user-1',
        'project-1',
        ApprovalStage.ANALYSIS,
      );
      expect(status.currentVersion).toBe(2);
      expect(status.decision).toBe(ApprovalDecision.APPROVED);
      expect(status.decidedAt).toBe(decidedAt);
    });

    it('getHistory returns every past decision ordered newest first, including stage filtering', async () => {
      const rows = [
        buildApprovalRow({ id: 'a-2', decision: ApprovalDecision.APPROVED }),
        buildApprovalRow({
          id: 'a-1',
          decision: ApprovalDecision.CHANGES_REQUESTED,
        }),
      ];
      prisma.approval.findMany.mockResolvedValue(rows);

      const history = await service.getHistory(
        'user-1',
        'project-1',
        ApprovalStage.ANALYSIS,
      );
      expect(history.map((r) => r.id)).toEqual(['a-2', 'a-1']);
      expect(prisma.approval.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: 'project-1', stage: ApprovalStage.ANALYSIS },
          orderBy: { decidedAt: 'desc' },
        }),
      );
    });

    it("rejects history access for another user's project", async () => {
      projectsService.findOneForUser.mockRejectedValue(new NotFoundException());
      await expect(
        service.getHistory('user-2', 'project-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.approval.findMany).not.toHaveBeenCalled();
    });

    it('getSummary returns one compact entry per stage without N+1 explosion', async () => {
      prisma.approval.findFirst.mockResolvedValue({
        decision: ApprovalDecision.APPROVED,
        comment: null,
        decidedAt: new Date(),
        decidedByUserId: 'user-1',
      });

      const summary = await service.getSummary('user-1', 'project-1');
      expect(summary.analysis.decision).toBe(ApprovalDecision.APPROVED);
      expect(summary.architecture.decision).toBe(ApprovalDecision.APPROVED);
      expect(summary.sprintPlan.decision).toBe(ApprovalDecision.APPROVED);
      expect(summary.startDevelopment.decision).toBe(ApprovalDecision.APPROVED);
    });
  });
});
