import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  JobType,
  Prisma,
  Project,
  SprintAcceptance,
  SprintAcceptanceStatus,
  SprintStatus,
  TaskExecutionStatus,
  TaskStatus,
  ValidationAttemptStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { GitService } from '../workspace/git/git.service';
import { JobService } from '../jobs/job.service';
import { JobExecutionContext } from '../jobs/types/job.types';
import {
  PLANNING_AI_PROVIDER,
  PlanningOperation,
} from '../ai/planning/planning-ai.constants';
import { PlanningAIProvider } from '../ai/planning/contracts/planning-provider.interface';
import { PlanningAIError } from '../ai/planning/errors/planning-ai.error';
import { SprintAcceptanceEvidenceBuilder } from './evidence/evidence-builder.service';
import { computeEvidenceHash } from './evidence/evidence-hash.util';
import { SprintAcceptanceReviewPrompt } from './prompts/sprint-acceptance-review.prompt';
import { SprintAcceptanceReviewContentSchema } from './schemas/sprint-acceptance-review.schema';
import { validateReviewContent } from './validation/review-validator';
import {
  SprintAcceptanceError,
  SprintAcceptanceErrorCode,
} from './errors/sprint-acceptance.error';
import { mapSprintAcceptanceErrorToHttpException } from './errors/sprint-acceptance-error.mapper';
import {
  DecideAcceptanceInput,
  GenerateAcceptanceResult,
  RejectAcceptanceInput,
  SprintAcceptanceEligibilityResult,
  SprintAcceptanceGateStatus,
  SprintAcceptanceRecord,
} from './types/sprint-acceptance.types';
import { SprintAcceptanceEvidence } from './types/evidence.types';

const SCHEMA_NAME = 'sprint_acceptance_review';

// Every status a record can be actively in progress under — used both for
// the concurrency guard (item 46) and orphan reconciliation.
const IN_FLIGHT_STATUSES: SprintAcceptanceStatus[] = [
  SprintAcceptanceStatus.PENDING,
  SprintAcceptanceStatus.REVIEWING,
];

// Mirrors ACTIVE_EXECUTION_STATUSES/ACTIVE_ATTEMPT_STATUSES/
// ACTIVE_SPRINT_EXECUTION_STATUSES from Sprints 12-14 — kept as small local
// copies rather than cross-module imports of private constants, consistent
// with how Sprint 15's ExecutionMonitorService already does this.
const ACTIVE_TASK_EXECUTION_STATUSES: TaskExecutionStatus[] = [
  TaskExecutionStatus.QUEUED,
  TaskExecutionStatus.RUNNING,
  TaskExecutionStatus.AGENT_COMPLETED,
];
const ACTIVE_VALIDATION_ATTEMPT_STATUSES: ValidationAttemptStatus[] = [
  ValidationAttemptStatus.QUEUED,
  ValidationAttemptStatus.RUNNING,
];
const ACTIVE_SPRINT_EXECUTION_STATUSES = [
  'QUEUED',
  'RUNNING',
  'PAUSED',
  'BLOCKED',
];

function toRecord(
  acceptance: SprintAcceptance,
  liveHeadSha: string | null,
): SprintAcceptanceRecord {
  const stale =
    acceptance.repositoryHeadSha !== null &&
    (liveHeadSha === null || liveHeadSha !== acceptance.repositoryHeadSha);
  return {
    id: acceptance.id,
    projectId: acceptance.projectId,
    sprintId: acceptance.sprintId,
    sprintPlanId: acceptance.sprintPlanId,
    sprintExecutionId: acceptance.sprintExecutionId,
    version: acceptance.version,
    status: acceptance.status,
    deterministicPassed: acceptance.deterministicPassed,
    deterministicSummary: acceptance.deterministicSummary,
    requirementCoverage:
      (acceptance.requirementCoverage as unknown as SprintAcceptanceRecord['requirementCoverage']) ??
      null,
    validationSummary:
      (acceptance.validationSummary as unknown as SprintAcceptanceRecord['validationSummary']) ??
      null,
    commitSummary:
      (acceptance.commitSummary as unknown as SprintAcceptanceRecord['commitSummary']) ??
      null,
    riskSummary:
      (acceptance.riskSummary as unknown as SprintAcceptanceRecord['riskSummary']) ??
      null,
    changedFiles:
      (acceptance.changedFiles as unknown as SprintAcceptanceRecord['changedFiles']) ??
      null,
    repositoryHeadSha: acceptance.repositoryHeadSha,
    evidenceHash: acceptance.evidenceHash,
    stale,
    aiReviewStatus: acceptance.aiReviewStatus,
    aiSummary: acceptance.aiSummary,
    objectiveAssessment:
      (acceptance.objectiveAssessment as SprintAcceptanceRecord['objectiveAssessment']) ??
      null,
    architectureAssessment:
      (acceptance.architectureAssessment as SprintAcceptanceRecord['architectureAssessment']) ??
      null,
    riskAssessment:
      (acceptance.riskAssessment as SprintAcceptanceRecord['riskAssessment']) ??
      null,
    findings:
      (acceptance.findings as unknown as SprintAcceptanceRecord['findings']) ??
      null,
    recommendation: acceptance.recommendation,
    promptName: acceptance.promptName,
    promptVersion: acceptance.promptVersion,
    provider: acceptance.provider,
    model: acceptance.model,
    inputTokens: acceptance.inputTokens,
    outputTokens: acceptance.outputTokens,
    totalTokens: acceptance.totalTokens,
    latencyMs: acceptance.latencyMs,
    attempts: acceptance.attempts,
    providerRequestId: acceptance.providerRequestId,
    errorCode: acceptance.errorCode,
    errorMessage: acceptance.errorMessage,
    reviewedByUserId: acceptance.reviewedByUserId,
    reviewedAt: acceptance.reviewedAt,
    rejectionReason: acceptance.rejectionReason,
    reviewerNotes: acceptance.reviewerNotes,
    backgroundJobId: acceptance.backgroundJobId,
    createdAt: acceptance.createdAt,
    updatedAt: acceptance.updatedAt,
  };
}

// The Sprint delivery-acceptance gate (item 2/32/116). Deliberately never
// invokes CodingAgentProvider, never re-runs Sprint 13's validation, never
// commits/pushes/deploys, and never mutates a Task/TaskExecution/
// ValidationAttempt/SprintExecution row — purely aggregates their existing
// state into evidence, optionally asks PlanningAIProvider for an advisory
// structured review, and records a human Accept/Reject decision. The AI's
// own "recommendation" can NEVER by itself flip `status` to ACCEPTED — only
// an explicit accept()/reject() call from a human does that (item 33/116).
@Injectable()
export class SprintAcceptanceService {
  private readonly logger = new Logger(SprintAcceptanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly workspaceService: WorkspaceService,
    private readonly git: GitService,
    private readonly jobService: JobService,
    private readonly evidenceBuilder: SprintAcceptanceEvidenceBuilder,
    @Inject(PLANNING_AI_PROVIDER)
    private readonly planningAIProvider: PlanningAIProvider,
  ) {}

  // ---- eligibility -------------------------------------------------------

  async getEligibility(
    userId: string,
    projectId: string,
    sprintId: string,
  ): Promise<SprintAcceptanceEligibilityResult> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    return this.evaluateEligibility(project, sprintId);
  }

  private async evaluateEligibility(
    project: Project,
    sprintId: string,
  ): Promise<SprintAcceptanceEligibilityResult> {
    // Must run before reading state below (same ordering lesson as Sprint
    // 12/13/14's own reconcile-before-read).
    await this.reconcileOrphanedAcceptance(sprintId);

    const sprint = await this.prisma.sprint.findFirst({
      where: { id: sprintId, sprintPlan: { projectId: project.id } },
    });
    if (!sprint) {
      throw mapSprintAcceptanceErrorToHttpException(
        new SprintAcceptanceError({
          code: SprintAcceptanceErrorCode.SPRINT_NOT_FOUND,
          message: 'Sprint not found.',
        }),
      );
    }

    const reasons: SprintAcceptanceErrorCode[] = [];

    if (project.archivedAt) {
      reasons.push(SprintAcceptanceErrorCode.PROJECT_ARCHIVED);
    }

    const currentPlan = await this.prisma.sprintPlan.findFirst({
      where: { projectId: project.id },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!currentPlan || currentPlan.id !== sprint.sprintPlanId) {
      reasons.push(SprintAcceptanceErrorCode.PLAN_LINEAGE_MISMATCH);
    }

    if (sprint.status !== SprintStatus.PASSED) {
      reasons.push(SprintAcceptanceErrorCode.SPRINT_NOT_PASSED);
    }

    const activeSprintExecution = await this.prisma.sprintExecution.findFirst({
      where: {
        sprintId,
        status: { in: ACTIVE_SPRINT_EXECUTION_STATUSES as never },
      },
    });
    if (activeSprintExecution) {
      reasons.push(SprintAcceptanceErrorCode.ACTIVE_EXECUTION);
    }

    const sprintExecution = await this.prisma.sprintExecution.findFirst({
      where: { sprintId },
      orderBy: { attempt: 'desc' },
    });
    if (!sprintExecution || sprintExecution.status !== 'COMPLETED') {
      reasons.push(SprintAcceptanceErrorCode.SPRINT_EXECUTION_NOT_COMPLETED);
    }

    if (sprintExecution) {
      const tasks = await this.prisma.task.findMany({
        where: { sprintId, sprintPlanId: sprintExecution.sprintPlanId },
      });
      const notPassed = tasks.filter((t) => t.status !== TaskStatus.PASSED);
      if (notPassed.length > 0) {
        reasons.push(SprintAcceptanceErrorCode.TASK_NOT_PASSED);
      }

      const taskIds = tasks.map((t) => t.id);
      if (taskIds.length > 0) {
        const activeExecutions = await this.prisma.taskExecution.findFirst({
          where: {
            taskId: { in: taskIds },
            status: { in: ACTIVE_TASK_EXECUTION_STATUSES },
          },
        });
        if (activeExecutions) {
          reasons.push(SprintAcceptanceErrorCode.ACTIVE_EXECUTION);
        }
        const activeValidations = await this.prisma.validationAttempt.findFirst(
          {
            where: {
              taskId: { in: taskIds },
              status: { in: ACTIVE_VALIDATION_ATTEMPT_STATUSES },
            },
          },
        );
        if (activeValidations) {
          reasons.push(SprintAcceptanceErrorCode.ACTIVE_EXECUTION);
        }

        // Every Task must have real, successful validation + commit
        // evidence (items 8/19/20) — never inferred purely from
        // Task.status.
        const latestExecutions = await this.prisma.taskExecution.findMany({
          where: { taskId: { in: taskIds } },
          orderBy: { attempt: 'desc' },
        });
        const latestExecutionByTaskId = new Map<
          string,
          (typeof latestExecutions)[number]
        >();
        for (const execution of latestExecutions) {
          if (!latestExecutionByTaskId.has(execution.taskId)) {
            latestExecutionByTaskId.set(execution.taskId, execution);
          }
        }
        const missingCommit = tasks.some(
          (t) =>
            t.status === TaskStatus.PASSED &&
            !latestExecutionByTaskId.get(t.id)?.commitSha,
        );
        if (missingCommit) {
          reasons.push(SprintAcceptanceErrorCode.MISSING_COMMIT_EVIDENCE);
        }

        const latestAttempts = await this.prisma.validationAttempt.findMany({
          where: { taskId: { in: taskIds } },
          orderBy: { attempt: 'desc' },
        });
        const latestAttemptByTaskId = new Map<
          string,
          (typeof latestAttempts)[number]
        >();
        for (const attempt of latestAttempts) {
          if (!latestAttemptByTaskId.has(attempt.taskId)) {
            latestAttemptByTaskId.set(attempt.taskId, attempt);
          }
        }
        const missingValidation = tasks.some(
          (t) =>
            latestAttemptByTaskId.get(t.id)?.status !==
            ValidationAttemptStatus.PASSED,
        );
        if (missingValidation) {
          reasons.push(SprintAcceptanceErrorCode.MISSING_VALIDATION_EVIDENCE);
        }
      }
    }

    try {
      const workspacePath = await this.workspaceService.getReadyWorkspacePath(
        project.id,
      );
      const status = await this.git.getStatus(workspacePath);
      if (!status.clean) {
        reasons.push(SprintAcceptanceErrorCode.WORKSPACE_DIRTY);
      }
      if (sprintExecution) {
        const headSha = await this.git.getHeadCommitSha(workspacePath);
        if (headSha !== sprintExecution.repositoryEndSha) {
          reasons.push(SprintAcceptanceErrorCode.FINAL_SHA_MISMATCH);
        }
      }
    } catch {
      reasons.push(SprintAcceptanceErrorCode.WORKSPACE_NOT_READY);
    }

    const activeAcceptance = await this.prisma.sprintAcceptance.findFirst({
      where: { sprintId, status: { in: IN_FLIGHT_STATUSES } },
    });
    if (activeAcceptance) {
      reasons.push(SprintAcceptanceErrorCode.ACTIVE_ACCEPTANCE_REVIEW);
    }

    return {
      eligible: reasons.length === 0,
      reasons,
      sprint: { id: sprint.id, status: sprint.status },
    };
  }

  // ---- generate (also serves as regenerate — always a fresh version) ----

  async generate(
    userId: string,
    projectId: string,
    sprintId: string,
  ): Promise<GenerateAcceptanceResult> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    const eligibility = await this.evaluateEligibility(project, sprintId);
    if (!eligibility.eligible) {
      throw mapSprintAcceptanceErrorToHttpException(
        new SprintAcceptanceError({
          code: eligibility.reasons[0],
          message: `Sprint acceptance review cannot be generated right now: ${eligibility.reasons.join(', ')}.`,
        }),
      );
    }

    const sprintExecution = await this.prisma.sprintExecution.findFirstOrThrow({
      where: { sprintId },
      orderBy: { attempt: 'desc' },
    });

    let acceptance: SprintAcceptance;
    try {
      acceptance = await this.prisma.$transaction(async (tx) => {
        const active = await tx.sprintAcceptance.findFirst({
          where: { sprintId, status: { in: IN_FLIGHT_STATUSES } },
        });
        if (active) {
          throw new SprintAcceptanceError({
            code: SprintAcceptanceErrorCode.ACTIVE_ACCEPTANCE_REVIEW,
            message:
              'A Sprint acceptance review is already in progress for this Sprint.',
          });
        }
        const aggregate = await tx.sprintAcceptance.aggregate({
          where: { sprintId },
          _max: { version: true },
        });
        const version = (aggregate._max.version ?? 0) + 1;
        return tx.sprintAcceptance.create({
          data: {
            projectId: project.id,
            sprintId,
            sprintPlanId: sprintExecution.sprintPlanId,
            sprintExecutionId: sprintExecution.id,
            version,
            status: SprintAcceptanceStatus.PENDING,
          },
        });
      });
    } catch (error) {
      if (error instanceof SprintAcceptanceError) {
        throw mapSprintAcceptanceErrorToHttpException(error);
      }
      throw error;
    }

    try {
      const job = await this.jobService.enqueue({
        type: JobType.SPRINT_ACCEPTANCE_REVIEW,
        projectId: project.id,
        userId,
        payload: { sprintAcceptanceId: acceptance.id },
        maxAttempts: 1,
      });
      const updated = await this.prisma.sprintAcceptance.update({
        where: { id: acceptance.id },
        data: { backgroundJobId: job.id },
      });
      this.logger.log(
        `Sprint acceptance review enqueued (sprintAcceptanceId=${acceptance.id}, sprintId=${sprintId}, version=${acceptance.version})`,
      );
      return { sprintAcceptance: toRecord(updated, null), job };
    } catch (error) {
      await this.prisma.sprintAcceptance.update({
        where: { id: acceptance.id },
        data: {
          status: SprintAcceptanceStatus.FAILED,
          errorCode: SprintAcceptanceErrorCode.ENQUEUE_FAILED,
          errorMessage: 'Failed to enqueue the background review job.',
        },
      });
      throw error;
    }
  }

  // ---- execute (background-worker-facing) --------------------------------

  async execute(
    sprintAcceptanceId: string,
    context: JobExecutionContext,
  ): Promise<SprintAcceptanceRecord> {
    let acceptance = await this.prisma.sprintAcceptance.findUniqueOrThrow({
      where: { id: sprintAcceptanceId },
    });

    acceptance = await this.prisma.sprintAcceptance.update({
      where: { id: sprintAcceptanceId },
      data: { status: SprintAcceptanceStatus.REVIEWING },
    });
    this.logger.log(
      `Sprint acceptance review started (sprintAcceptanceId=${sprintAcceptanceId})`,
    );

    await context.reportProgress(10, 'Collecting deterministic evidence...');
    const { evidence, liveHeadSha } = await this.evidenceBuilder.build(
      acceptance.sprintExecutionId,
    );
    this.logger.log(
      `Sprint acceptance evidence built (sprintAcceptanceId=${sprintAcceptanceId}, headSha=${liveHeadSha})`,
    );

    const evidenceHash = computeEvidenceHash(evidence);
    const deterministicSummary = this.buildDeterministicSummary(evidence);

    acceptance = await this.prisma.sprintAcceptance.update({
      where: { id: sprintAcceptanceId },
      data: {
        deterministicPassed: true,
        deterministicSummary,
        requirementCoverage:
          evidence.requirementCoverage as unknown as Prisma.InputJsonValue,
        validationSummary:
          evidence.validationSummary as unknown as Prisma.InputJsonValue,
        commitSummary:
          evidence.commitSummary as unknown as Prisma.InputJsonValue,
        riskSummary: evidence.riskSummary as unknown as Prisma.InputJsonValue,
        changedFiles: evidence.changedFiles as unknown as Prisma.InputJsonValue,
        repositoryHeadSha: liveHeadSha,
        evidenceHash,
      },
    });

    await context.reportProgress(40, 'Requesting independent AI review...');
    try {
      await this.runAiReview(acceptance, evidence, liveHeadSha, context);
    } catch (error) {
      if (
        error instanceof SprintAcceptanceError &&
        error.code === SprintAcceptanceErrorCode.REPOSITORY_STATE_CHANGED
      ) {
        const failed = await this.prisma.sprintAcceptance.update({
          where: { id: sprintAcceptanceId },
          data: {
            status: SprintAcceptanceStatus.FAILED,
            errorCode: error.code,
            errorMessage: error.message,
          },
        });
        this.logger.warn(
          `Sprint acceptance review failed: repository changed mid-review (sprintAcceptanceId=${sprintAcceptanceId})`,
        );
        return toRecord(failed, liveHeadSha);
      }
      // Any other AI-side failure is recorded but never discards the
      // deterministic evidence already persisted above (item 35/36) — the
      // review still reaches READY_FOR_DECISION so a human can act on
      // deterministic evidence alone.
      const normalized = this.normalizeAiError(error);
      await this.prisma.sprintAcceptance.update({
        where: { id: sprintAcceptanceId },
        data: {
          aiReviewStatus: 'FAILED',
          errorCode: normalized.code,
          errorMessage: normalized.message,
        },
      });
      this.logger.warn(
        `Sprint acceptance AI review unavailable, deterministic evidence preserved (sprintAcceptanceId=${sprintAcceptanceId}, code=${normalized.code})`,
      );
    }

    const ready = await this.prisma.sprintAcceptance.update({
      where: { id: sprintAcceptanceId },
      data: { status: SprintAcceptanceStatus.READY_FOR_DECISION },
    });
    this.logger.log(
      `Sprint acceptance review ready for decision (sprintAcceptanceId=${sprintAcceptanceId})`,
    );
    return toRecord(ready, liveHeadSha);
  }

  private async runAiReview(
    acceptance: SprintAcceptance,
    evidence: SprintAcceptanceEvidence,
    initialHeadSha: string | null,
    context: JobExecutionContext,
  ): Promise<void> {
    const prompt = SprintAcceptanceReviewPrompt.build(evidence);
    const startedAt = Date.now();
    const result = await this.planningAIProvider.generateStructuredOutput({
      operation: PlanningOperation.SPRINT_REVIEW,
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      schema: SprintAcceptanceReviewContentSchema,
      schemaName: SCHEMA_NAME,
      metadata: {
        projectId: acceptance.projectId,
        sprintId: acceptance.sprintId,
      },
    });

    const failures = validateReviewContent(result.data, evidence);
    if (failures.length > 0) {
      throw new SprintAcceptanceError({
        code: SprintAcceptanceErrorCode.INVALID_REVIEW_RESPONSE,
        message: `AI review failed validation: ${failures.map((f) => f.reason).join('; ')}`,
      });
    }

    // Re-check HEAD immediately before persisting (item 48) — the AI call
    // may have taken a while; nothing prevents the repository from moving
    // on in the meantime.
    let currentHeadSha: string | null = initialHeadSha;
    try {
      const workspacePath = await this.workspaceService.getReadyWorkspacePath(
        acceptance.projectId,
      );
      currentHeadSha = await this.git.getHeadCommitSha(workspacePath);
    } catch {
      currentHeadSha = null;
    }
    if (currentHeadSha !== initialHeadSha) {
      throw new SprintAcceptanceError({
        code: SprintAcceptanceErrorCode.REPOSITORY_STATE_CHANGED,
        message:
          'The repository changed while the acceptance review was being generated. Please regenerate.',
      });
    }

    await context.reportProgress(90, 'Persisting review...');
    const latencyMs = Date.now() - startedAt;
    await this.prisma.sprintAcceptance.update({
      where: { id: acceptance.id },
      data: {
        aiReviewStatus: 'COMPLETED',
        aiSummary: result.data.summary,
        objectiveAssessment: result.data
          .objectiveAssessment as unknown as Prisma.InputJsonValue,
        architectureAssessment: result.data
          .architectureAssessment as unknown as Prisma.InputJsonValue,
        riskAssessment: result.data
          .riskAssessment as unknown as Prisma.InputJsonValue,
        findings: result.data.findings as unknown as Prisma.InputJsonValue,
        recommendation: result.data.recommendation,
        promptName: SprintAcceptanceReviewPrompt.name,
        promptVersion: SprintAcceptanceReviewPrompt.version,
        provider: result.metadata.provider,
        model: result.metadata.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        latencyMs,
        attempts: result.metadata.attempts,
        providerRequestId: result.metadata.requestId,
      },
    });
  }

  private buildDeterministicSummary(
    evidence: SprintAcceptanceEvidence,
  ): string {
    const {
      sprintExecution,
      validationSummary,
      commitSummary,
      requirementCoverage,
      workspace,
    } = evidence;
    const coveredRequirements = requirementCoverage.filter(
      (r) => r.tasksPassed && r.validationPassed,
    ).length;
    return (
      `${sprintExecution.passedTasks}/${sprintExecution.totalTasks} Tasks passed. ` +
      `${validationSummary.requiredPassed}/${validationSummary.requiredRuns} required validation checks passed. ` +
      `${commitSummary.commits.length} local Task commit(s) created. ` +
      `${coveredRequirements}/${requirementCoverage.length} Sprint-scoped functional requirement(s) covered. ` +
      `Workspace ${workspace.clean ? 'clean' : 'dirty'} at ${workspace.headCommitSha?.slice(0, 10) ?? 'unknown'}.`
    );
  }

  private normalizeAiError(error: unknown): { code: string; message: string } {
    if (error instanceof SprintAcceptanceError) {
      return { code: error.code, message: error.message };
    }
    if (error instanceof PlanningAIError) {
      return {
        code: error.code,
        message: 'Independent AI review is temporarily unavailable.',
      };
    }
    return {
      code: SprintAcceptanceErrorCode.UNKNOWN_ERROR,
      message: 'Independent AI review is temporarily unavailable.',
    };
  }

  // ---- reads ---------------------------------------------------------

  async getCurrent(
    userId: string,
    projectId: string,
    sprintId: string,
  ): Promise<SprintAcceptanceRecord> {
    await this.projectsService.findOneForUser(userId, projectId);
    await this.assertSprintBelongsToProject(sprintId, projectId);
    const acceptance = await this.prisma.sprintAcceptance.findFirst({
      where: { sprintId },
      orderBy: { version: 'desc' },
    });
    if (!acceptance) {
      throw mapSprintAcceptanceErrorToHttpException(
        new SprintAcceptanceError({
          code: SprintAcceptanceErrorCode.ACCEPTANCE_NOT_FOUND,
          message:
            'No acceptance review has been generated for this Sprint yet.',
        }),
      );
    }
    const liveHeadSha = await this.tryGetLiveHeadSha(projectId);
    return toRecord(acceptance, liveHeadSha);
  }

  async getHistory(
    userId: string,
    projectId: string,
    sprintId: string,
  ): Promise<SprintAcceptanceRecord[]> {
    await this.projectsService.findOneForUser(userId, projectId);
    await this.assertSprintBelongsToProject(sprintId, projectId);
    const acceptances = await this.prisma.sprintAcceptance.findMany({
      where: { sprintId },
      orderBy: { version: 'desc' },
    });
    const liveHeadSha = await this.tryGetLiveHeadSha(projectId);
    return acceptances.map((a) => toRecord(a, liveHeadSha));
  }

  async getVersion(
    userId: string,
    projectId: string,
    sprintId: string,
    version: number,
  ): Promise<SprintAcceptanceRecord> {
    await this.projectsService.findOneForUser(userId, projectId);
    const acceptance = await this.prisma.sprintAcceptance.findFirst({
      where: { sprintId, version, sprint: { sprintPlan: { projectId } } },
    });
    if (!acceptance) {
      throw mapSprintAcceptanceErrorToHttpException(
        new SprintAcceptanceError({
          code: SprintAcceptanceErrorCode.ACCEPTANCE_NOT_FOUND,
          message: 'Acceptance review version not found.',
        }),
      );
    }
    const liveHeadSha = await this.tryGetLiveHeadSha(projectId);
    return toRecord(acceptance, liveHeadSha);
  }

  // ---- decision --------------------------------------------------------

  async accept(
    userId: string,
    projectId: string,
    sprintId: string,
    input: DecideAcceptanceInput,
  ): Promise<SprintAcceptanceRecord> {
    const { project, acceptance } = await this.loadDecidable(
      userId,
      projectId,
      sprintId,
    );
    const updated = await this.prisma.sprintAcceptance.update({
      where: { id: acceptance.id },
      data: {
        status: SprintAcceptanceStatus.ACCEPTED,
        reviewedByUserId: userId,
        reviewedAt: new Date(),
        reviewerNotes: input.notes?.trim().slice(0, 2000) || null,
      },
    });
    this.logger.log(
      `Sprint accepted (sprintAcceptanceId=${acceptance.id}, sprintId=${sprintId}, projectId=${project.id}, userId=${userId})`,
    );
    return toRecord(updated, acceptance.repositoryHeadSha);
  }

  async reject(
    userId: string,
    projectId: string,
    sprintId: string,
    input: RejectAcceptanceInput,
  ): Promise<SprintAcceptanceRecord> {
    const reason = input.reason?.trim();
    if (!reason) {
      throw mapSprintAcceptanceErrorToHttpException(
        new SprintAcceptanceError({
          code: SprintAcceptanceErrorCode.NOT_READY_FOR_DECISION,
          message: 'A reason is required when rejecting a Sprint.',
        }),
      );
    }
    const { project, acceptance } = await this.loadDecidable(
      userId,
      projectId,
      sprintId,
    );
    const updated = await this.prisma.sprintAcceptance.update({
      where: { id: acceptance.id },
      data: {
        status: SprintAcceptanceStatus.REJECTED,
        reviewedByUserId: userId,
        reviewedAt: new Date(),
        rejectionReason: reason.slice(0, 2000),
      },
    });
    this.logger.warn(
      `Sprint rejected (sprintAcceptanceId=${acceptance.id}, sprintId=${sprintId}, projectId=${project.id}, userId=${userId})`,
    );
    return toRecord(updated, acceptance.repositoryHeadSha);
  }

  private async loadDecidable(
    userId: string,
    projectId: string,
    sprintId: string,
  ): Promise<{ project: Project; acceptance: SprintAcceptance }> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    this.assertNotArchived(project);
    await this.assertSprintBelongsToProject(sprintId, projectId);

    const acceptance = await this.prisma.sprintAcceptance.findFirst({
      where: { sprintId },
      orderBy: { version: 'desc' },
    });
    if (!acceptance) {
      throw mapSprintAcceptanceErrorToHttpException(
        new SprintAcceptanceError({
          code: SprintAcceptanceErrorCode.ACCEPTANCE_NOT_FOUND,
          message:
            'No acceptance review has been generated for this Sprint yet.',
        }),
      );
    }
    if (acceptance.status !== SprintAcceptanceStatus.READY_FOR_DECISION) {
      throw mapSprintAcceptanceErrorToHttpException(
        new SprintAcceptanceError({
          code: SprintAcceptanceErrorCode.NOT_READY_FOR_DECISION,
          message: `This acceptance review is not ready for a decision (status: ${acceptance.status}).`,
        }),
      );
    }

    // Staleness: both the live HEAD and the recomputed evidence hash must
    // still match exactly what this version was generated against (items
    // 50-53) — a decision on stale evidence is refused, forcing a
    // regenerate instead.
    const { evidence, liveHeadSha } = await this.evidenceBuilder.build(
      acceptance.sprintExecutionId,
    );
    const currentHash = computeEvidenceHash(evidence);
    if (
      liveHeadSha !== acceptance.repositoryHeadSha ||
      currentHash !== acceptance.evidenceHash
    ) {
      throw mapSprintAcceptanceErrorToHttpException(
        new SprintAcceptanceError({
          code: SprintAcceptanceErrorCode.REVIEW_STALE,
          message:
            'The Sprint state has changed since this review was generated. Please regenerate the review before deciding.',
        }),
      );
    }

    return { project, acceptance };
  }

  // ---- Sprint 14/17 integration point ------------------------------------

  // The one reusable read Sprint 14's dependency gate and Sprint 17's
  // project-completion readiness both need (items 57/59/112) — never
  // reimplemented at either call site.
  async getGateStatus(sprintId: string): Promise<SprintAcceptanceGateStatus> {
    const latest = await this.prisma.sprintAcceptance.findFirst({
      where: { sprintId },
      orderBy: { version: 'desc' },
      select: { status: true, version: true },
    });
    return {
      accepted: latest?.status === SprintAcceptanceStatus.ACCEPTED,
      status: latest?.status ?? null,
      version: latest?.version ?? null,
    };
  }

  // ---- internals -----------------------------------------------------

  private assertNotArchived(project: Project): void {
    if (project.archivedAt) {
      throw mapSprintAcceptanceErrorToHttpException(
        new SprintAcceptanceError({
          code: SprintAcceptanceErrorCode.PROJECT_ARCHIVED,
          message: 'This project is archived. Restore it first.',
        }),
      );
    }
  }

  private async assertSprintBelongsToProject(
    sprintId: string,
    projectId: string,
  ): Promise<void> {
    const sprint = await this.prisma.sprint.findFirst({
      where: { id: sprintId, sprintPlan: { projectId } },
      select: { id: true },
    });
    if (!sprint) {
      throw mapSprintAcceptanceErrorToHttpException(
        new SprintAcceptanceError({
          code: SprintAcceptanceErrorCode.SPRINT_NOT_FOUND,
          message: 'Sprint not found.',
        }),
      );
    }
  }

  private async tryGetLiveHeadSha(projectId: string): Promise<string | null> {
    try {
      const workspacePath =
        await this.workspaceService.getReadyWorkspacePath(projectId);
      return await this.git.getHeadCommitSha(workspacePath);
    } catch {
      return null;
    }
  }

  // Self-heals a review left stuck PENDING/REVIEWING because its background
  // Job ended without execute()'s own bookkeeping ever running (worker
  // crash, or cancellation while still queued) — mirrors Sprint 12/13/14's
  // own reconcileOrphaned* methods exactly.
  private async reconcileOrphanedAcceptance(sprintId: string): Promise<void> {
    const active = await this.prisma.sprintAcceptance.findFirst({
      where: { sprintId, status: { in: IN_FLIGHT_STATUSES } },
      orderBy: { version: 'desc' },
    });
    if (!active || !active.backgroundJobId) return;

    const job = await this.prisma.job.findUnique({
      where: { id: active.backgroundJobId },
      select: { status: true },
    });
    const jobIsTerminal =
      !job ||
      job.status === 'FAILED' ||
      job.status === 'CANCELLED' ||
      job.status === 'SUCCEEDED';
    if (!jobIsTerminal) return;

    await this.prisma.sprintAcceptance.updateMany({
      where: { id: active.id, status: { in: IN_FLIGHT_STATUSES } },
      data: {
        status:
          job?.status === 'CANCELLED'
            ? SprintAcceptanceStatus.CANCELLED
            : SprintAcceptanceStatus.FAILED,
        errorCode: 'ORPHANED_REVIEW',
        errorMessage:
          'The background job ended without this review reporting a result (likely a worker restart).',
      },
    });
    this.logger.warn(
      `Reconciled an orphaned Sprint acceptance review (sprintAcceptanceId=${active.id}, sprintId=${sprintId})`,
    );
  }
}
