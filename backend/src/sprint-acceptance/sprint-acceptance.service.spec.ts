import { SprintAcceptanceService } from './sprint-acceptance.service';
import { SprintAcceptanceErrorCode } from './errors/sprint-acceptance.error';
import {
  PlanningAIError,
  PlanningErrorCode,
} from '../ai/planning/errors/planning-ai.error';

function buildProject(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 'project-1', userId: 'user-1', archivedAt: null, ...overrides };
}

function buildSprint(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sprint-1',
    sprintPlanId: 'plan-1',
    status: 'PASSED',
    ...overrides,
  };
}

function buildExecution(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'exec-1',
    sprintId: 'sprint-1',
    sprintPlanId: 'plan-1',
    projectId: 'project-1',
    attempt: 1,
    status: 'COMPLETED',
    repositoryEndSha: 'end-sha',
    ...overrides,
  };
}

function buildTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'task-1',
    key: 'S1-T1',
    status: 'PASSED',
    requirementIds: [],
    ...overrides,
  };
}

function buildEvidence(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sprint: {
      id: 'sprint-1',
      number: 1,
      title: 'Foundations',
      objective: 'Ship it.',
      status: 'PASSED',
    },
    sprintExecution: {
      id: 'exec-1',
      attempt: 1,
      status: 'COMPLETED',
      passedTasks: 1,
      totalTasks: 1,
    },
    tasks: [{ key: 'S1-T1' }],
    requirementCoverage: [],
    architectureContext: { relevantAreas: [], relevantAdrs: [], allAdrIds: [] },
    validationSummary: {
      totalRuns: 1,
      requiredRuns: 1,
      requiredPassed: 1,
      optionalPassed: 0,
      optionalFailed: 0,
      failedRequiredChecks: [],
    },
    commitSummary: {
      startSha: 'start-sha',
      endSha: 'end-sha',
      commits: [],
      chainComplete: true,
    },
    riskSummary: {
      projectRisks: [],
      unresolvedArchitectureQuestions: [],
      optionalValidationFailures: [],
    },
    changedFiles: [],
    workspace: {
      clean: true,
      headCommitSha: 'end-sha',
      branch: 'autodev/development',
    },
    ...overrides,
  };
}

function buildAiResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    data: {
      summary: 'Looks good.',
      objectiveAssessment: { satisfied: true, rationale: 'x' },
      requirementAssessment: { satisfied: true, gaps: [] },
      architectureAssessment: { aligned: true, concerns: [] },
      validationAssessment: { sufficient: true, concerns: [] },
      riskAssessment: { acceptable: true, concerns: [] },
      findings: [],
      recommendation: 'ACCEPT',
      ...(overrides.data as Record<string, unknown> | undefined),
    },
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    metadata: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      operation: 'SPRINT_REVIEW',
      latencyMs: 5,
      attempts: 1,
      requestId: 'req-1',
    },
  };
}

describe('SprintAcceptanceService', () => {
  let prisma: any;
  let projectsService: any;
  let workspaceService: any;
  let git: any;
  let jobService: any;
  let evidenceBuilder: any;
  let planningAIProvider: any;
  let context: any;
  let service: SprintAcceptanceService;

  beforeEach(() => {
    prisma = {
      sprint: { findFirst: jest.fn().mockResolvedValue(buildSprint()) },
      sprintPlan: { findFirst: jest.fn().mockResolvedValue({ id: 'plan-1' }) },
      sprintExecution: {
        // Discriminates by the `where.status` filter (item text: two very
        // different queries share this method — "is there an ACTIVE one"
        // vs "give me the latest one regardless of status") since a plain
        // mockResolvedValue can't tell those calls apart.
        findFirst: jest.fn().mockImplementation((args: any) => {
          if (args?.where?.status?.in) return Promise.resolve(null);
          return Promise.resolve(buildExecution());
        }),
        findFirstOrThrow: jest.fn().mockResolvedValue(buildExecution()),
      },
      task: { findMany: jest.fn().mockResolvedValue([buildTask()]) },
      taskExecution: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest
          .fn()
          .mockResolvedValue([
            { taskId: 'task-1', attempt: 1, commitSha: 'sha-1' },
          ]),
      },
      validationAttempt: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest
          .fn()
          .mockResolvedValue([
            { taskId: 'task-1', attempt: 1, status: 'PASSED' },
          ]),
      },
      sprintAcceptance: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _max: { version: null } }),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
      },
      job: { findUnique: jest.fn() },
      $transaction: jest.fn((fn: unknown) =>
        typeof fn === 'function'
          ? (fn as (tx: unknown) => unknown)(prisma)
          : Promise.all(fn as unknown[]),
      ),
    };

    let created: any = null;
    prisma.sprintAcceptance.create.mockImplementation((args: any) => {
      created = {
        id: 'acceptance-1',
        projectId: args.data.projectId,
        sprintId: args.data.sprintId,
        sprintPlanId: args.data.sprintPlanId,
        sprintExecutionId: args.data.sprintExecutionId,
        version: args.data.version,
        status: args.data.status,
        deterministicPassed: true,
        deterministicSummary: null,
        requirementCoverage: null,
        validationSummary: null,
        commitSummary: null,
        riskSummary: null,
        changedFiles: null,
        repositoryHeadSha: null,
        evidenceHash: null,
        aiReviewStatus: null,
        aiSummary: null,
        objectiveAssessment: null,
        architectureAssessment: null,
        riskAssessment: null,
        findings: null,
        recommendation: null,
        promptName: null,
        promptVersion: null,
        provider: null,
        model: null,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        latencyMs: null,
        attempts: null,
        providerRequestId: null,
        errorCode: null,
        errorMessage: null,
        reviewedByUserId: null,
        reviewedAt: null,
        rejectionReason: null,
        reviewerNotes: null,
        backgroundJobId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return Promise.resolve(created);
    });
    prisma.sprintAcceptance.update.mockImplementation((args: any) => {
      created = { ...created, ...args.data };
      return Promise.resolve(created);
    });
    prisma.sprintAcceptance.findUniqueOrThrow.mockImplementation(() =>
      Promise.resolve(created),
    );

    projectsService = {
      findOneForUser: jest.fn().mockResolvedValue(buildProject()),
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
    jobService = { enqueue: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    evidenceBuilder = {
      build: jest.fn().mockResolvedValue({
        evidence: buildEvidence(),
        liveHeadSha: 'end-sha',
      }),
    };
    planningAIProvider = {
      generateStructuredOutput: jest.fn().mockResolvedValue(buildAiResult()),
    };
    context = {
      reportProgress: jest.fn().mockResolvedValue(undefined),
      isCancellationRequested: jest.fn().mockResolvedValue(false),
      heartbeat: jest.fn().mockResolvedValue(undefined),
    };

    service = new SprintAcceptanceService(
      prisma,
      projectsService,
      workspaceService,
      git,
      jobService,
      evidenceBuilder,
      planningAIProvider,
    );
  });

  describe('getEligibility', () => {
    it('is eligible when every deterministic gate passes', async () => {
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.eligible).toBe(true);
      expect(result.reasons).toEqual([]);
    });

    it('flags a Sprint that has not PASSED', async () => {
      prisma.sprint.findFirst.mockResolvedValue(
        buildSprint({ status: 'RUNNING' }),
      );
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.reasons).toContain(
        SprintAcceptanceErrorCode.SPRINT_NOT_PASSED,
      );
    });

    it('flags a SprintExecution that has not COMPLETED', async () => {
      prisma.sprintExecution.findFirst.mockResolvedValue(
        buildExecution({ status: 'FAILED' }),
      );
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.reasons).toContain(
        SprintAcceptanceErrorCode.SPRINT_EXECUTION_NOT_COMPLETED,
      );
    });

    it('flags an incomplete Task', async () => {
      prisma.task.findMany.mockResolvedValue([
        buildTask({ status: 'RUNNING' }),
      ]);
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.reasons).toContain(
        SprintAcceptanceErrorCode.TASK_NOT_PASSED,
      );
    });

    it('flags missing validation evidence', async () => {
      prisma.validationAttempt.findMany.mockResolvedValue([
        { taskId: 'task-1', attempt: 1, status: 'FAILED' },
      ]);
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.reasons).toContain(
        SprintAcceptanceErrorCode.MISSING_VALIDATION_EVIDENCE,
      );
    });

    it('flags missing commit evidence for a PASSED Task', async () => {
      prisma.taskExecution.findMany.mockResolvedValue([
        { taskId: 'task-1', attempt: 1, commitSha: null },
      ]);
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.reasons).toContain(
        SprintAcceptanceErrorCode.MISSING_COMMIT_EVIDENCE,
      );
    });

    it('flags a dirty workspace', async () => {
      git.getStatus.mockResolvedValue({ clean: false, files: [{ path: 'x' }] });
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.reasons).toContain(
        SprintAcceptanceErrorCode.WORKSPACE_DIRTY,
      );
    });

    it('flags a final-SHA mismatch against the live HEAD', async () => {
      git.getHeadCommitSha.mockResolvedValue('some-other-sha');
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.reasons).toContain(
        SprintAcceptanceErrorCode.FINAL_SHA_MISMATCH,
      );
    });

    it('flags an active TaskExecution', async () => {
      prisma.taskExecution.findFirst.mockResolvedValue({
        id: 'te-1',
        status: 'RUNNING',
      });
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.reasons).toContain(
        SprintAcceptanceErrorCode.ACTIVE_EXECUTION,
      );
    });

    it('flags a Sprint belonging to a superseded plan', async () => {
      prisma.sprintPlan.findFirst.mockResolvedValue({ id: 'plan-2' });
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.reasons).toContain(
        SprintAcceptanceErrorCode.PLAN_LINEAGE_MISMATCH,
      );
    });

    it('flags an already-active acceptance review', async () => {
      prisma.sprintAcceptance.findFirst.mockResolvedValue({
        id: 'a1',
        status: 'REVIEWING',
      });
      const result = await service.getEligibility(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(result.reasons).toContain(
        SprintAcceptanceErrorCode.ACTIVE_ACCEPTANCE_REVIEW,
      );
    });
  });

  describe('generate', () => {
    it('generates v1 pinned to the exact SprintExecution/SprintPlan and enqueues a background job', async () => {
      const result = await service.generate('user-1', 'project-1', 'sprint-1');
      expect(result.sprintAcceptance.version).toBe(1);
      expect(prisma.sprintAcceptance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sprintExecutionId: 'exec-1',
            sprintPlanId: 'plan-1',
            status: 'PENDING',
          }),
        }),
      );
      expect(jobService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SPRINT_ACCEPTANCE_REVIEW' }),
      );
      expect(result.job.id).toBe('job-1');
    });

    it('blocks generation when eligibility fails', async () => {
      prisma.sprint.findFirst.mockResolvedValue(
        buildSprint({ status: 'RUNNING' }),
      );
      await expect(
        service.generate('user-1', 'project-1', 'sprint-1'),
      ).rejects.toThrow();
      expect(prisma.sprintAcceptance.create).not.toHaveBeenCalled();
    });

    it('blocks a second generate() while one is already active for this Sprint', async () => {
      prisma.sprintAcceptance.findFirst.mockResolvedValue({
        id: 'a1',
        status: 'REVIEWING',
      });
      await expect(
        service.generate('user-1', 'project-1', 'sprint-1'),
      ).rejects.toThrow();
    });

    it('blocks generation for an archived project via eligibility', async () => {
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ archivedAt: new Date() }),
      );
      await expect(
        service.generate('user-1', 'project-1', 'sprint-1'),
      ).rejects.toThrow();
    });

    it('creates v2 on a second generate() once the first review is no longer active, preserving v1', async () => {
      await service.generate('user-1', 'project-1', 'sprint-1');
      // First review reached a terminal-ish state (no longer PENDING/REVIEWING).
      prisma.sprintAcceptance.findFirst.mockResolvedValue(null);
      prisma.sprintAcceptance.aggregate.mockResolvedValue({
        _max: { version: 1 },
      });

      const second = await service.generate('user-1', 'project-1', 'sprint-1');
      expect(second.sprintAcceptance.version).toBe(2);
    });

    it('rejects a foreign user (ownership enforced upstream)', async () => {
      projectsService.findOneForUser.mockRejectedValue(new Error('not found'));
      await expect(
        service.generate('user-2', 'project-1', 'sprint-1'),
      ).rejects.toThrow('not found');
    });
  });

  describe('execute', () => {
    it('persists deterministic evidence, evidence hash, and repository HEAD even before AI review runs', async () => {
      const created = await service.generate('user-1', 'project-1', 'sprint-1');
      const record = await service.execute(
        created.sprintAcceptance.id,
        context,
      );
      expect(evidenceBuilder.build).toHaveBeenCalledWith('exec-1');
      expect(record.repositoryHeadSha).toBe('end-sha');
      expect(record.evidenceHash).toEqual(expect.any(String));
      expect(record.deterministicPassed).toBe(true);
      expect(record.status).toBe('READY_FOR_DECISION');
    });

    it('persists AI review metadata (provider/model/tokens/prompt) on success', async () => {
      const created = await service.generate('user-1', 'project-1', 'sprint-1');
      const record = await service.execute(
        created.sprintAcceptance.id,
        context,
      );
      expect(record.aiReviewStatus).toBe('COMPLETED');
      expect(record.recommendation).toBe('ACCEPT');
      expect(record.provider).toBe('openai');
      expect(record.model).toBe('gpt-4o-mini');
      expect(record.totalTokens).toBe(30);
      expect(record.promptName).toBe('sprint-acceptance-review');
    });

    it('rejects a review whose findings reference an invented Task key, but still reaches READY_FOR_DECISION on deterministic evidence', async () => {
      planningAIProvider.generateStructuredOutput.mockResolvedValue(
        buildAiResult({
          data: {
            findings: [
              {
                id: 'f1',
                severity: 'LOW',
                category: 'OTHER',
                title: 'x',
                description: 'x',
                evidence: [],
                relatedTaskKeys: ['S9-T9'],
                relatedRequirementIds: [],
                relatedAdrIds: [],
                blocking: false,
              },
            ],
          },
        }),
      );
      const created = await service.generate('user-1', 'project-1', 'sprint-1');
      const record = await service.execute(
        created.sprintAcceptance.id,
        context,
      );
      expect(record.status).toBe('READY_FOR_DECISION');
      expect(record.aiReviewStatus).toBe('FAILED');
      expect(record.recommendation).toBeNull();
      // Deterministic evidence must survive an AI-side rejection.
      expect(record.repositoryHeadSha).toBe('end-sha');
    });

    it('keeps deterministic evidence and reaches READY_FOR_DECISION when the AI provider itself fails', async () => {
      planningAIProvider.generateStructuredOutput.mockRejectedValue(
        new PlanningAIError({
          code: PlanningErrorCode.AUTHENTICATION_ERROR,
          message: 'bad key',
          provider: 'openai',
          retryable: false,
        }),
      );
      const created = await service.generate('user-1', 'project-1', 'sprint-1');
      const record = await service.execute(
        created.sprintAcceptance.id,
        context,
      );
      expect(record.status).toBe('READY_FOR_DECISION');
      expect(record.aiReviewStatus).toBe('FAILED');
      expect(record.deterministicPassed).toBe(true);
      expect(record.evidenceHash).toEqual(expect.any(String));
    });

    it('fails the whole review if the repository changed while the AI call was in flight', async () => {
      git.getHeadCommitSha
        .mockResolvedValueOnce('end-sha') // evidence-build-time snapshot check inside runAiReview setup
        .mockResolvedValue('a-different-sha'); // re-check right before persisting
      evidenceBuilder.build.mockResolvedValue({
        evidence: buildEvidence(),
        liveHeadSha: 'end-sha',
      });
      const created = await service.generate('user-1', 'project-1', 'sprint-1');
      const record = await service.execute(
        created.sprintAcceptance.id,
        context,
      );
      expect(record.status).toBe('FAILED');
      expect(record.errorCode).toBe(
        SprintAcceptanceErrorCode.REPOSITORY_STATE_CHANGED,
      );
    });
  });

  describe('accept / reject', () => {
    async function generateAndComplete() {
      const created = await service.generate('user-1', 'project-1', 'sprint-1');
      await service.execute(created.sprintAcceptance.id, context);
      prisma.sprintAcceptance.findFirst.mockImplementation(() =>
        prisma.sprintAcceptance.findUniqueOrThrow(),
      );
      return created;
    }

    it('accepts a READY_FOR_DECISION review, persisting the reviewer and timestamp', async () => {
      await generateAndComplete();
      const record = await service.accept('user-1', 'project-1', 'sprint-1', {
        notes: 'Looks solid.',
      });
      expect(record.status).toBe('ACCEPTED');
      expect(record.reviewedByUserId).toBe('user-1');
      expect(record.reviewedAt).toBeInstanceOf(Date);
      expect(record.reviewerNotes).toBe('Looks solid.');
    });

    it('rejects with a persisted reason', async () => {
      await generateAndComplete();
      const record = await service.reject('user-1', 'project-1', 'sprint-1', {
        reason: 'Missing auth coverage.',
      });
      expect(record.status).toBe('REJECTED');
      expect(record.rejectionReason).toBe('Missing auth coverage.');
    });

    it('requires a non-empty reason to reject', async () => {
      await generateAndComplete();
      await expect(
        service.reject('user-1', 'project-1', 'sprint-1', { reason: '   ' }),
      ).rejects.toThrow();
    });

    it('blocks Accept when the evidence has gone stale (HEAD changed since generation)', async () => {
      await generateAndComplete();
      evidenceBuilder.build.mockResolvedValue({
        evidence: buildEvidence(),
        liveHeadSha: 'a-changed-sha',
      });
      await expect(
        service.accept('user-1', 'project-1', 'sprint-1', {}),
      ).rejects.toThrow();
    });

    it('blocks a decision when the review is not yet READY_FOR_DECISION', async () => {
      const created = await service.generate('user-1', 'project-1', 'sprint-1');
      prisma.sprintAcceptance.findFirst.mockResolvedValue({
        ...created.sprintAcceptance,
        status: 'REVIEWING',
      });
      await expect(
        service.accept('user-1', 'project-1', 'sprint-1', {}),
      ).rejects.toThrow();
    });

    it('blocks mutation on an archived project', async () => {
      await generateAndComplete();
      projectsService.findOneForUser.mockResolvedValue(
        buildProject({ archivedAt: new Date() }),
      );
      await expect(
        service.accept('user-1', 'project-1', 'sprint-1', {}),
      ).rejects.toThrow();
    });
  });

  describe('history', () => {
    it('returns versions newest-first', async () => {
      prisma.sprintAcceptance.findMany.mockResolvedValue([
        { id: 'a2', version: 2, sprintId: 'sprint-1' },
        { id: 'a1', version: 1, sprintId: 'sprint-1' },
      ]);
      const history = await service.getHistory(
        'user-1',
        'project-1',
        'sprint-1',
      );
      expect(history.map((h) => h.version)).toEqual([2, 1]);
    });
  });

  describe('getGateStatus (Sprint 14/17 integration point)', () => {
    it('reports accepted=true only when the latest version is ACCEPTED', async () => {
      prisma.sprintAcceptance.findFirst.mockResolvedValue({
        status: 'ACCEPTED',
        version: 3,
      });
      const status = await service.getGateStatus('sprint-1');
      expect(status).toEqual({
        accepted: true,
        status: 'ACCEPTED',
        version: 3,
      });
    });

    it('reports accepted=false when the latest version is only READY_FOR_DECISION', async () => {
      prisma.sprintAcceptance.findFirst.mockResolvedValue({
        status: 'READY_FOR_DECISION',
        version: 1,
      });
      const status = await service.getGateStatus('sprint-1');
      expect(status.accepted).toBe(false);
    });

    it('reports accepted=false with null status when no review exists at all', async () => {
      prisma.sprintAcceptance.findFirst.mockResolvedValue(null);
      const status = await service.getGateStatus('sprint-1');
      expect(status).toEqual({ accepted: false, status: null, version: null });
    });
  });
});
