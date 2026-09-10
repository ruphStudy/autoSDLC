import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  Project,
  ProjectDelivery,
  ProjectStatus,
  SprintAcceptanceStatus,
  SprintExecutionStatus,
  SprintStatus,
  TaskStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ApprovalService } from '../approval/approval.service';
import { ApprovalError } from '../approval/errors/approval.error';
import { SprintAcceptanceService } from '../sprint-acceptance/sprint-acceptance.service';
import {
  ProjectDeliveryEvidenceBuilder,
  DeliveryEvidenceBundle,
} from './evidence/evidence-builder.service';
import { computeDeliveryEvidenceHash } from './evidence/evidence-hash.util';
import {
  ProjectDeliveryError,
  ProjectDeliveryErrorCode,
} from './errors/project-delivery.error';
import { mapProjectDeliveryErrorToHttpException } from './errors/project-delivery-error.mapper';
import {
  CompleteProjectResult,
  ProjectCompletionEligibilityResult,
  ProjectDeliveryRecord,
} from './types/project-delivery.types';
import { ProjectDeliveryEvidence } from './types/evidence.types';

// A Sprint execution in any of these statuses is still "in flight" —
// mirrors ACTIVE_SPRINT_EXECUTION_STATUSES from Sprint 14/16, kept as a
// small local copy rather than a cross-module import of a private constant
// (same precedent as Sprint 16's own copy of Sprint 12-14's active-status
// lists).
const ACTIVE_SPRINT_EXECUTION_STATUSES: SprintExecutionStatus[] = [
  SprintExecutionStatus.QUEUED,
  SprintExecutionStatus.RUNNING,
  SprintExecutionStatus.PAUSED,
  SprintExecutionStatus.BLOCKED,
];

// The only Project.status values a real Project is ever actually in while
// Sprints are executing (see TaskExecutionService's own DEVELOPMENT_APPROVED
// -> DEVELOPING atomic transition). TESTING is reserved by Sprint 6's own
// enum and referenced by SprintPlanningService's blocked-statuses list, but
// nothing currently transitions a Project into it — included here anyway so
// completion is not silently blocked if a future sprint starts using it.
const PRE_COMPLETION_STATUSES: ProjectStatus[] = [
  ProjectStatus.DEVELOPING,
  ProjectStatus.TESTING,
];

function toRecord(delivery: ProjectDelivery): ProjectDeliveryRecord {
  return {
    id: delivery.id,
    projectId: delivery.projectId,
    version: delivery.version,
    repositoryFinalSha: delivery.repositoryFinalSha,
    repositoryBranch: delivery.repositoryBranch,
    requiredSprints:
      delivery.requiredSprints as unknown as ProjectDeliveryRecord['requiredSprints'],
    requirementCoverage:
      delivery.requirementCoverage as unknown as ProjectDeliveryRecord['requirementCoverage'],
    taskSummary:
      delivery.taskSummary as unknown as ProjectDeliveryRecord['taskSummary'],
    validationSummary:
      delivery.validationSummary as unknown as ProjectDeliveryRecord['validationSummary'],
    commitSummary:
      delivery.commitSummary as unknown as ProjectDeliveryRecord['commitSummary'],
    usageSummary:
      delivery.usageSummary as unknown as ProjectDeliveryRecord['usageSummary'],
    warnings: delivery.warnings as unknown as string[],
    deliverySummary: delivery.deliverySummary,
    deliveryEvidenceHash: delivery.deliveryEvidenceHash,
    finalizedByUserId: delivery.finalizedByUserId,
    finalizedAt: delivery.finalizedAt,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
  };
}

interface EligibilityEvaluation {
  reasons: ProjectDeliveryErrorCode[];
  sprintPlanId: string | null;
  bundle: DeliveryEvidenceBundle | null;
}

// The Project-completion gate (Sprint 17) — the delivery-level counterpart
// to Sprint 16's SprintAcceptanceService. Deliberately never invokes any AI
// provider, never mutates Sprint/Task/TaskExecution/ValidationAttempt/
// SprintAcceptance rows, never touches Git beyond read-only status/HEAD
// checks, and never commits/pushes/deploys/packages anything (item 158-160).
// Reads SprintAcceptanceService.getGateStatus() one-directionally (same
// integration point Sprint 14 already uses) and every other cross-domain
// table (Sprint/SprintPlan/SprintExecution/Task/TaskExecution/
// ValidationAttempt/Architecture/ProjectAnalysis/AgentJob) directly via
// Prisma, to avoid a module-dependency cycle.
@Injectable()
export class ProjectDeliveryService {
  private readonly logger = new Logger(ProjectDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly approvalService: ApprovalService,
    private readonly sprintAcceptanceService: SprintAcceptanceService,
    private readonly evidenceBuilder: ProjectDeliveryEvidenceBuilder,
  ) {}

  // ---- eligibility -----------------------------------------------------

  async getEligibility(
    userId: string,
    projectId: string,
  ): Promise<ProjectCompletionEligibilityResult> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    const { reasons } = await this.evaluateEligibility(project);
    return {
      eligible: reasons.length === 0,
      reasons,
      project: { id: project.id, status: project.status },
    };
  }

  private async evaluateEligibility(
    project: Project,
  ): Promise<EligibilityEvaluation> {
    const reasons: ProjectDeliveryErrorCode[] = [];

    // Not a blocking failure in the ordinary sense — reported on its own so
    // a client can show "view your delivery" instead of a stale readiness
    // checklist (item 45).
    if (project.status === ProjectStatus.COMPLETED) {
      reasons.push(ProjectDeliveryErrorCode.PROJECT_ALREADY_COMPLETED);
      return { reasons, sprintPlanId: null, bundle: null };
    }

    if (project.archivedAt) {
      reasons.push(ProjectDeliveryErrorCode.PROJECT_ARCHIVED);
    }

    try {
      await this.approvalService.assertDevelopmentApproved(project.id);
    } catch (error) {
      if (error instanceof ApprovalError) {
        reasons.push(ProjectDeliveryErrorCode.DEVELOPMENT_NOT_APPROVED);
      } else {
        throw error;
      }
    }

    const sprintPlan = await this.prisma.sprintPlan.findFirst({
      where: { projectId: project.id },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!sprintPlan) {
      reasons.push(ProjectDeliveryErrorCode.NO_SPRINT_PLAN);
      return { reasons, sprintPlanId: null, bundle: null };
    }

    const activeExecution = await this.prisma.sprintExecution.findFirst({
      where: {
        projectId: project.id,
        status: { in: ACTIVE_SPRINT_EXECUTION_STATUSES },
      },
    });
    if (activeExecution) {
      reasons.push(ProjectDeliveryErrorCode.ACTIVE_SPRINT_EXECUTION);
    }

    const sprints = await this.prisma.sprint.findMany({
      where: { sprintPlanId: sprintPlan.id },
      select: { id: true, status: true },
    });
    if (
      sprints.length === 0 ||
      sprints.some((s) => s.status !== SprintStatus.PASSED)
    ) {
      reasons.push(ProjectDeliveryErrorCode.SPRINT_NOT_PASSED);
    }

    // Every required Sprint must also be formally ACCEPTED (Sprint 16's own
    // gate) — reuses getGateStatus() rather than re-deriving acceptance
    // rules here, same reasoning as Sprint 14's own dependency gate.
    const gateStatuses = await Promise.all(
      sprints.map((s) => this.sprintAcceptanceService.getGateStatus(s.id)),
    );
    if (gateStatuses.some((g) => !g.accepted)) {
      reasons.push(ProjectDeliveryErrorCode.SPRINT_NOT_ACCEPTED);
    }

    const tasks = await this.prisma.task.findMany({
      where: { sprintPlanId: sprintPlan.id },
      select: { status: true },
    });
    if (tasks.some((t) => t.status !== TaskStatus.PASSED)) {
      reasons.push(ProjectDeliveryErrorCode.TASK_NOT_PASSED);
    }

    const bundle = await this.evidenceBuilder.build(project.id, sprintPlan.id);

    if (bundle.evidence.requirementCoverage.some((r) => !r.covered)) {
      reasons.push(ProjectDeliveryErrorCode.REQUIREMENT_NOT_COVERED);
    }

    if (bundle.evidence.workspace.clean === null) {
      reasons.push(ProjectDeliveryErrorCode.WORKSPACE_NOT_READY);
    } else if (bundle.evidence.workspace.clean === false) {
      reasons.push(ProjectDeliveryErrorCode.WORKSPACE_DIRTY);
    }

    if (
      bundle.evidence.resolvedFinalSha !== null &&
      bundle.liveHeadSha !== null &&
      bundle.evidence.resolvedFinalSha !== bundle.liveHeadSha
    ) {
      reasons.push(ProjectDeliveryErrorCode.FINAL_SHA_MISMATCH);
    }

    return { reasons, sprintPlanId: sprintPlan.id, bundle };
  }

  // ---- completion --------------------------------------------------------

  async complete(
    userId: string,
    projectId: string,
  ): Promise<CompleteProjectResult> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );

    // Idempotent: re-calling complete() on an already-completed Project
    // returns the existing delivery rather than generating a duplicate
    // (item 45) — never re-runs the eligibility/evidence pipeline once
    // there is nothing left to finalize.
    if (project.status === ProjectStatus.COMPLETED) {
      const existing = await this.prisma.projectDelivery.findFirst({
        where: { projectId: project.id },
        orderBy: { version: 'desc' },
      });
      if (!existing) {
        throw mapProjectDeliveryErrorToHttpException(
          new ProjectDeliveryError({
            code: ProjectDeliveryErrorCode.UNKNOWN_ERROR,
            message: 'Project is marked COMPLETED but has no delivery record.',
          }),
        );
      }
      return {
        project: {
          id: project.id,
          status: project.status,
          completedAt: project.completedAt?.toISOString() ?? null,
        },
        delivery: toRecord(existing),
        alreadyCompleted: true,
      };
    }

    if (!PRE_COMPLETION_STATUSES.includes(project.status)) {
      throw mapProjectDeliveryErrorToHttpException(
        new ProjectDeliveryError({
          code: ProjectDeliveryErrorCode.DEVELOPMENT_NOT_APPROVED,
          message: `Project status is ${project.status}; development must be underway before completion.`,
        }),
      );
    }

    const { reasons, sprintPlanId, bundle } =
      await this.evaluateEligibility(project);
    if (reasons.length > 0 || !sprintPlanId || !bundle) {
      throw mapProjectDeliveryErrorToHttpException(
        new ProjectDeliveryError({
          code: reasons[0] ?? ProjectDeliveryErrorCode.UNKNOWN_ERROR,
          message: `Project is not eligible for completion: ${reasons.join(', ') || 'unknown reason'}`,
        }),
      );
    }

    // Re-check live state immediately before finalizing (item 40) — never
    // finalize against a snapshot that may have gone stale between the
    // client's last eligibility check and this call, same "double-check
    // right before the point of no return" discipline as Sprint 11/16's own
    // re-checks.
    const freshProject = await this.prisma.project.findUniqueOrThrow({
      where: { id: project.id },
    });
    const fresh = await this.evaluateEligibility(freshProject);
    if (fresh.reasons.length > 0 || !fresh.bundle) {
      throw mapProjectDeliveryErrorToHttpException(
        new ProjectDeliveryError({
          code: ProjectDeliveryErrorCode.PROJECT_DELIVERY_STATE_CHANGED,
          message:
            'Project state changed since eligibility was last confirmed. Re-check eligibility and try again.',
        }),
      );
    }

    const evidence = fresh.bundle.evidence;
    const evidenceHash = computeDeliveryEvidenceHash(evidence);
    const deliverySummary = this.buildDeliverySummary(evidence);

    const delivery = await this.prisma
      .$transaction(async (tx) => {
        // Atomic claim: only flip to COMPLETED if the Project is still in a
        // pre-completion status and not archived — guards the same race
        // TaskExecutionService's own DEVELOPMENT_APPROVED -> DEVELOPING claim
        // guards against, just at the opposite end of the lifecycle.
        const claim = await tx.project.updateMany({
          where: {
            id: project.id,
            status: { in: PRE_COMPLETION_STATUSES },
            archivedAt: null,
          },
          data: { status: ProjectStatus.COMPLETED, completedAt: new Date() },
        });
        if (claim.count === 0) {
          throw new ProjectDeliveryError({
            code: ProjectDeliveryErrorCode.PROJECT_DELIVERY_STATE_CHANGED,
            message: 'Project status changed concurrently. Try again.',
          });
        }

        const aggregate = await tx.projectDelivery.aggregate({
          where: { projectId: project.id },
          _max: { version: true },
        });
        const nextVersion = (aggregate._max.version ?? 0) + 1;

        return tx.projectDelivery.create({
          data: {
            projectId: project.id,
            version: nextVersion,
            repositoryFinalSha: evidence.resolvedFinalSha as string,
            repositoryBranch: evidence.workspace.branch,
            requiredSprints:
              evidence.requiredSprints as unknown as Prisma.InputJsonValue,
            requirementCoverage:
              evidence.requirementCoverage as unknown as Prisma.InputJsonValue,
            taskSummary:
              evidence.taskSummary as unknown as Prisma.InputJsonValue,
            validationSummary:
              evidence.validationSummary as unknown as Prisma.InputJsonValue,
            commitSummary:
              evidence.commitSummary as unknown as Prisma.InputJsonValue,
            usageSummary:
              evidence.usageSummary as unknown as Prisma.InputJsonValue,
            warnings: evidence.warnings as unknown as Prisma.InputJsonValue,
            deliverySummary,
            deliveryEvidenceHash: evidenceHash,
            finalizedByUserId: userId,
          },
        });
      })
      .catch((error) => {
        if (error instanceof ProjectDeliveryError) {
          throw mapProjectDeliveryErrorToHttpException(error);
        }
        throw error;
      });

    this.logger.log(
      `Project completed (id=${project.id}, userId=${userId}, deliveryId=${delivery.id})`,
    );

    return {
      project: {
        id: project.id,
        status: ProjectStatus.COMPLETED,
        completedAt: delivery.finalizedAt.toISOString(),
      },
      delivery: toRecord(delivery),
      alreadyCompleted: false,
    };
  }

  // ---- read ---------------------------------------------------------

  async getCurrent(
    userId: string,
    projectId: string,
  ): Promise<ProjectDeliveryRecord> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    const delivery = await this.prisma.projectDelivery.findFirst({
      where: { projectId: project.id },
      orderBy: { version: 'desc' },
    });
    if (!delivery) {
      throw mapProjectDeliveryErrorToHttpException(
        new ProjectDeliveryError({
          code: ProjectDeliveryErrorCode.UNKNOWN_ERROR,
          message: 'This project has no delivery record yet.',
        }),
      );
    }
    return toRecord(delivery);
  }

  private buildDeliverySummary(evidence: ProjectDeliveryEvidence): string {
    const acceptedSprints = evidence.requiredSprints.filter(
      (s) => s.acceptanceStatus === SprintAcceptanceStatus.ACCEPTED,
    ).length;
    const coveredRequirements = evidence.requirementCoverage.filter(
      (r) => r.covered,
    ).length;
    const shaPreview = evidence.resolvedFinalSha?.slice(0, 7) ?? 'unknown';
    return (
      `${acceptedSprints}/${evidence.requiredSprints.length} Sprints accepted, ` +
      `${evidence.taskSummary.passedTasks}/${evidence.taskSummary.totalTasks} Tasks passed, ` +
      `${coveredRequirements}/${evidence.requirementCoverage.length} requirements covered, ` +
      `final commit ${shaPreview}${evidence.workspace.branch ? ` on branch ${evidence.workspace.branch}` : ''}.`
    );
  }
}
