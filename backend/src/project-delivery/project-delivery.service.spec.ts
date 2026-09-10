import { ProjectDeliveryService } from './project-delivery.service';
import { ProjectDeliveryErrorCode } from './errors/project-delivery.error';
import {
  ApprovalError,
  ApprovalErrorCode,
} from '../approval/errors/approval.error';

function buildProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'project-1',
    userId: 'user-1',
    archivedAt: null,
    status: 'DEVELOPING',
    completedAt: null,
    ...overrides,
  };
}

function buildEvidence(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    project: { id: 'project-1', name: 'My Project' },
    sprintPlan: { id: 'plan-1', version: 1 },
    projectAnalysis: { id: 'analysis-1', version: 1 },
    requiredSprints: [
      {
        sprintId: 'sprint-1',
        number: 1,
        title: 'Foundations',
        status: 'PASSED',
        sprintExecutionId: 'exec-1',
        sprintExecutionAttempt: 1,
        repositoryEndSha: 'final-sha',
        completedAt: '2026-01-01T01:00:00.000Z',
        acceptanceVersion: 1,
        acceptanceStatus: 'ACCEPTED',
      },
    ],
    requirementCoverage: [
      {
        requirementId: 'FR-001',
        title: 'Do the thing',
        covered: true,
        taskKeys: ['S1-T1'],
      },
    ],
    taskSummary: { totalTasks: 1, passedTasks: 1, nonPassedTaskKeys: [] },
    validationSummary: {
      totalChecks: 1,
      requiredPassed: 1,
      requiredFailed: 0,
      optionalPassed: 0,
      optionalFailed: 0,
    },
    commitSummary: {
      totalCommits: 1,
      firstCommitSha: 'sha-1',
      lastCommitSha: 'sha-1',
    },
    usageSummary: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      byCategory: [],
    },
    warnings: [],
    workspace: { clean: true, headCommitSha: 'final-sha', branch: 'main' },
    resolvedFinalSha: 'final-sha',
    ...overrides,
  };
}

describe('ProjectDeliveryService', () => {
  let prisma: any;
  let projectsService: any;
  let approvalService: any;
  let sprintAcceptanceService: any;
  let evidenceBuilder: any;
  let service: ProjectDeliveryService;

  beforeEach(() => {
    prisma = {
      sprintPlan: { findFirst: jest.fn().mockResolvedValue({ id: 'plan-1' }) },
      sprintExecution: { findFirst: jest.fn().mockResolvedValue(null) },
      sprint: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'sprint-1', status: 'PASSED' }]),
      },
      task: { findMany: jest.fn().mockResolvedValue([{ status: 'PASSED' }]) },
      project: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(buildProject()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      projectDelivery: {
        findFirst: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _max: { version: null } }),
        create: jest.fn().mockImplementation((args: any) =>
          Promise.resolve({
            id: 'delivery-1',
            projectId: args.data.projectId,
            version: args.data.version,
            repositoryFinalSha: args.data.repositoryFinalSha,
            repositoryBranch: args.data.repositoryBranch,
            requiredSprints: args.data.requiredSprints,
            requirementCoverage: args.data.requirementCoverage,
            taskSummary: args.data.taskSummary,
            validationSummary: args.data.validationSummary,
            commitSummary: args.data.commitSummary,
            usageSummary: args.data.usageSummary,
            warnings: args.data.warnings,
            deliverySummary: args.data.deliverySummary,
            deliveryEvidenceHash: args.data.deliveryEvidenceHash,
            finalizedByUserId: args.data.finalizedByUserId,
            finalizedAt: new Date('2026-01-02T00:00:00.000Z'),
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          }),
        ),
      },
      $transaction: jest.fn((fn: unknown) =>
        typeof fn === 'function'
          ? (fn as (tx: unknown) => unknown)(prisma)
          : fn,
      ),
    };
    projectsService = {
      findOneForUser: jest.fn().mockResolvedValue(buildProject()),
    };
    approvalService = {
      assertDevelopmentApproved: jest.fn().mockResolvedValue(undefined),
    };
    sprintAcceptanceService = {
      getGateStatus: jest
        .fn()
        .mockResolvedValue({ accepted: true, status: 'ACCEPTED', version: 1 }),
    };
    evidenceBuilder = {
      build: jest.fn().mockResolvedValue({
        evidence: buildEvidence(),
        liveHeadSha: 'final-sha',
      }),
    };

    service = new ProjectDeliveryService(
      prisma,
      projectsService,
      approvalService,
      sprintAcceptanceService,
      evidenceBuilder,
    );
  });

  describe('getEligibility', () => {
    it('is eligible when every gate passes', async () => {
      const result = await service.getEligibility('user-1', 'project-1');
      expect(result.eligible).toBe(true);
      expect(result.reasons).toEqual([]);
    });

    it('reports PROJECT_ALREADY_COMPLETED instead of a checklist once completed', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ status: 'COMPLETED' }),
      );
      const result = await service.getEligibility('user-1', 'project-1');
      expect(result.eligible).toBe(false);
      expect(result.reasons).toEqual([
        ProjectDeliveryErrorCode.PROJECT_ALREADY_COMPLETED,
      ]);
    });

    it('flags an archived project', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ archivedAt: new Date() }),
      );
      const result = await service.getEligibility('user-1', 'project-1');
      expect(result.reasons).toContain(
        ProjectDeliveryErrorCode.PROJECT_ARCHIVED,
      );
    });

    it('flags a project whose development was never approved', async () => {
      approvalService.assertDevelopmentApproved.mockRejectedValue(
        new ApprovalError({
          code: ApprovalErrorCode.DEVELOPMENT_PREREQUISITES_MISSING,
          message: 'not approved',
        }),
      );
      const result = await service.getEligibility('user-1', 'project-1');
      expect(result.reasons).toContain(
        ProjectDeliveryErrorCode.DEVELOPMENT_NOT_APPROVED,
      );
    });

    it('rethrows a non-ApprovalError from the approval check', async () => {
      approvalService.assertDevelopmentApproved.mockRejectedValue(
        new Error('boom'),
      );
      await expect(
        service.getEligibility('user-1', 'project-1'),
      ).rejects.toThrow('boom');
    });

    it('flags a project with no SprintPlan yet', async () => {
      prisma.sprintPlan.findFirst.mockResolvedValue(null);
      const result = await service.getEligibility('user-1', 'project-1');
      expect(result.reasons).toEqual([ProjectDeliveryErrorCode.NO_SPRINT_PLAN]);
    });

    it('flags an active Sprint execution anywhere in the Project', async () => {
      prisma.sprintExecution.findFirst.mockResolvedValue({ id: 'exec-x' });
      const result = await service.getEligibility('user-1', 'project-1');
      expect(result.reasons).toContain(
        ProjectDeliveryErrorCode.ACTIVE_SPRINT_EXECUTION,
      );
    });

    it('flags a Project where not every Sprint has PASSED', async () => {
      prisma.sprint.findMany.mockResolvedValue([
        { id: 'sprint-1', status: 'RUNNING' },
      ]);
      const result = await service.getEligibility('user-1', 'project-1');
      expect(result.reasons).toContain(
        ProjectDeliveryErrorCode.SPRINT_NOT_PASSED,
      );
    });

    it('flags a Project where a Sprint PASSED but was never formally accepted', async () => {
      sprintAcceptanceService.getGateStatus.mockResolvedValue({
        accepted: false,
        status: 'READY_FOR_DECISION',
        version: 1,
      });
      const result = await service.getEligibility('user-1', 'project-1');
      expect(result.reasons).toContain(
        ProjectDeliveryErrorCode.SPRINT_NOT_ACCEPTED,
      );
    });

    it('flags a Project where a Task never reached PASSED', async () => {
      prisma.task.findMany.mockResolvedValue([{ status: 'FAILED' }]);
      const result = await service.getEligibility('user-1', 'project-1');
      expect(result.reasons).toContain(
        ProjectDeliveryErrorCode.TASK_NOT_PASSED,
      );
    });

    it('flags a Project with an uncovered requirement', async () => {
      evidenceBuilder.build.mockResolvedValue({
        evidence: buildEvidence({
          requirementCoverage: [
            {
              requirementId: 'FR-002',
              title: 'Never built',
              covered: false,
              taskKeys: [],
            },
          ],
        }),
        liveHeadSha: 'final-sha',
      });
      const result = await service.getEligibility('user-1', 'project-1');
      expect(result.reasons).toContain(
        ProjectDeliveryErrorCode.REQUIREMENT_NOT_COVERED,
      );
    });

    it('flags a workspace that could not be read', async () => {
      evidenceBuilder.build.mockResolvedValue({
        evidence: buildEvidence({
          workspace: { clean: null, headCommitSha: null, branch: null },
        }),
        liveHeadSha: null,
      });
      const result = await service.getEligibility('user-1', 'project-1');
      expect(result.reasons).toContain(
        ProjectDeliveryErrorCode.WORKSPACE_NOT_READY,
      );
    });

    it('flags a dirty workspace', async () => {
      evidenceBuilder.build.mockResolvedValue({
        evidence: buildEvidence({
          workspace: {
            clean: false,
            headCommitSha: 'final-sha',
            branch: 'main',
          },
        }),
        liveHeadSha: 'final-sha',
      });
      const result = await service.getEligibility('user-1', 'project-1');
      expect(result.reasons).toContain(
        ProjectDeliveryErrorCode.WORKSPACE_DIRTY,
      );
    });

    it('flags a resolved final SHA that does not match the live workspace HEAD', async () => {
      evidenceBuilder.build.mockResolvedValue({
        evidence: buildEvidence({ resolvedFinalSha: 'final-sha' }),
        liveHeadSha: 'different-sha',
      });
      const result = await service.getEligibility('user-1', 'project-1');
      expect(result.reasons).toContain(
        ProjectDeliveryErrorCode.FINAL_SHA_MISMATCH,
      );
    });
  });

  describe('complete', () => {
    it('finalizes the Project: atomically flips status and persists a ProjectDelivery', async () => {
      const result = await service.complete('user-1', 'project-1');

      expect(result.alreadyCompleted).toBe(false);
      expect(result.project.status).toBe('COMPLETED');
      expect(result.delivery.repositoryFinalSha).toBe('final-sha');
      expect(result.delivery.version).toBe(1);
      expect(prisma.project.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'project-1',
          status: { in: ['DEVELOPING', 'TESTING'] },
          archivedAt: null,
        },
        data: { status: 'COMPLETED', completedAt: expect.any(Date) },
      });
      expect(prisma.projectDelivery.create).toHaveBeenCalledTimes(1);
    });

    it('returns the existing delivery idempotently once already COMPLETED, without rebuilding evidence', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({
          status: 'COMPLETED',
          completedAt: new Date('2026-01-02T00:00:00.000Z'),
        }),
      );
      prisma.projectDelivery.findFirst.mockResolvedValue({
        id: 'delivery-1',
        projectId: 'project-1',
        version: 1,
        repositoryFinalSha: 'final-sha',
        repositoryBranch: 'main',
        requiredSprints: [],
        requirementCoverage: [],
        taskSummary: {},
        validationSummary: {},
        commitSummary: {},
        usageSummary: {},
        warnings: [],
        deliverySummary: 'done',
        deliveryEvidenceHash: 'hash',
        finalizedByUserId: 'user-1',
        finalizedAt: new Date('2026-01-02T00:00:00.000Z'),
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      });

      const result = await service.complete('user-1', 'project-1');

      expect(result.alreadyCompleted).toBe(true);
      expect(result.delivery.id).toBe('delivery-1');
      expect(evidenceBuilder.build).not.toHaveBeenCalled();
      expect(prisma.projectDelivery.create).not.toHaveBeenCalled();
    });

    it('throws UNKNOWN_ERROR if the Project is COMPLETED but somehow has no delivery record', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ status: 'COMPLETED' }),
      );
      prisma.projectDelivery.findFirst.mockResolvedValue(null);
      await expect(service.complete('user-1', 'project-1')).rejects.toThrow();
    });

    it('rejects completion for a Project outside any pre-completion status', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ status: 'DRAFT' }),
      );
      await expect(service.complete('user-1', 'project-1')).rejects.toThrow();
      expect(prisma.projectDelivery.create).not.toHaveBeenCalled();
    });

    it('rejects completion when eligibility fails', async () => {
      prisma.sprint.findMany.mockResolvedValue([
        { id: 'sprint-1', status: 'RUNNING' },
      ]);
      await expect(service.complete('user-1', 'project-1')).rejects.toThrow();
      expect(prisma.projectDelivery.create).not.toHaveBeenCalled();
    });

    it('rejects completion when live state changed since the last eligibility check', async () => {
      // First (pre-transaction) evaluateEligibility call passes; the
      // re-check immediately before finalizing must independently fail.
      evidenceBuilder.build
        .mockResolvedValueOnce({
          evidence: buildEvidence(),
          liveHeadSha: 'final-sha',
        })
        .mockResolvedValueOnce({
          evidence: buildEvidence({
            workspace: {
              clean: false,
              headCommitSha: 'final-sha',
              branch: 'main',
            },
          }),
          liveHeadSha: 'final-sha',
        });

      await expect(service.complete('user-1', 'project-1')).rejects.toThrow();
      expect(prisma.projectDelivery.create).not.toHaveBeenCalled();
    });

    it('aborts if the atomic Project-status claim loses a concurrent race', async () => {
      prisma.project.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.complete('user-1', 'project-1')).rejects.toThrow();
      expect(prisma.projectDelivery.create).not.toHaveBeenCalled();
    });

    it('assigns the next version via aggregate max, never hardcoding 1', async () => {
      prisma.projectDelivery.aggregate.mockResolvedValue({
        _max: { version: 3 },
      });
      const result = await service.complete('user-1', 'project-1');
      expect(result.delivery.version).toBe(4);
    });
  });

  describe('getCurrent', () => {
    it('returns the latest delivery record', async () => {
      prisma.projectDelivery.findFirst.mockResolvedValue({
        id: 'delivery-1',
        projectId: 'project-1',
        version: 1,
        repositoryFinalSha: 'final-sha',
        repositoryBranch: 'main',
        requiredSprints: [],
        requirementCoverage: [],
        taskSummary: {},
        validationSummary: {},
        commitSummary: {},
        usageSummary: {},
        warnings: [],
        deliverySummary: 'done',
        deliveryEvidenceHash: 'hash',
        finalizedByUserId: 'user-1',
        finalizedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const result = await service.getCurrent('user-1', 'project-1');
      expect(result.id).toBe('delivery-1');
    });

    it('throws when the Project has no delivery yet', async () => {
      prisma.projectDelivery.findFirst.mockResolvedValue(null);
      await expect(service.getCurrent('user-1', 'project-1')).rejects.toThrow();
    });
  });
});
