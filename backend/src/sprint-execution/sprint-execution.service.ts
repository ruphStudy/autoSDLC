import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
  JobType,
  Project,
  ProjectStatus,
  SprintExecution,
  SprintExecutionStatus,
  SprintStatus,
  Task,
  TaskExecutionStatus,
  TaskStatus,
  ValidationAttemptStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ApprovalService } from '../approval/approval.service';
import { ApprovalError } from '../approval/errors/approval.error';
import { WorkspaceService } from '../workspace/workspace.service';
import { GitService } from '../workspace/git/git.service';
import { GitError } from '../workspace/errors/git.error';
import { JobService } from '../jobs/job.service';
import { JobExecutionContext } from '../jobs/types/job.types';
import { TaskExecutionService } from '../task-execution/task-execution.service';
import { TaskValidationService } from '../task-validation/task-validation.service';
import { SprintAcceptanceService } from '../sprint-acceptance/sprint-acceptance.service';
import {
  SprintExecutionError,
  SprintExecutionErrorCode,
} from './errors/sprint-execution.error';
import { mapSprintExecutionErrorToHttpException } from './errors/sprint-execution-error.mapper';
import {
  RunSprintResult,
  SprintExecutionEligibilityResult,
  SprintExecutionRecord,
} from './types/sprint-execution-record.types';

const ACTIVE_SPRINT_EXECUTION_STATUSES: SprintExecutionStatus[] = [
  SprintExecutionStatus.QUEUED,
  SprintExecutionStatus.RUNNING,
  SprintExecutionStatus.PAUSED,
  SprintExecutionStatus.BLOCKED,
];
// Statuses whose backing background Job might still genuinely be live —
// used only to decide whether a row is safe to reconcile as orphaned.
const IN_FLIGHT_STATUSES: SprintExecutionStatus[] = [
  SprintExecutionStatus.QUEUED,
  SprintExecutionStatus.RUNNING,
];

function toRecord(execution: SprintExecution): SprintExecutionRecord {
  return {
    id: execution.id,
    projectId: execution.projectId,
    sprintId: execution.sprintId,
    sprintPlanId: execution.sprintPlanId,
    attempt: execution.attempt,
    status: execution.status,
    currentTaskId: execution.currentTaskId,
    backgroundJobId: execution.backgroundJobId,
    totalTasks: execution.totalTasks,
    passedTasks: execution.passedTasks,
    failedTasks: execution.failedTasks,
    blockedTasks: execution.blockedTasks,
    repositoryStartSha: execution.repositoryStartSha,
    repositoryEndSha: execution.repositoryEndSha,
    errorCode: execution.errorCode,
    errorMessage: execution.errorMessage,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt,
  };
}

type TaskWithDeps = Task & {
  dependencies: { dependsOnTask: { status: TaskStatus } }[];
};

// The Sprint Orchestrator. Deliberately never invokes Claude, runs a
// shell command, or performs a Git commit itself — every Task's
// implementation and validation is delegated entirely to Sprint 12's
// TaskExecutionService and Sprint 13's TaskValidationService via their
// beginForOrchestrator()+execute() integration points, reusing the exact
// same eligibility/execution/validation logic those sprints already built.
// This service only decides WHICH Task runs next (deterministically, from
// persisted status + dependency data — never an AI call) and tracks
// Sprint-wide progress/outcome.
@Injectable()
export class SprintExecutionService {
  private readonly logger = new Logger(SprintExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly approvalService: ApprovalService,
    private readonly workspaceService: WorkspaceService,
    private readonly git: GitService,
    private readonly jobService: JobService,
    private readonly taskExecutionService: TaskExecutionService,
    private readonly taskValidationService: TaskValidationService,
    private readonly sprintAcceptanceService: SprintAcceptanceService,
  ) {}

  // ---- eligibility ---------------------------------------------------

  async getEligibility(
    userId: string,
    projectId: string,
    sprintId: string,
  ): Promise<SprintExecutionEligibilityResult> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    return this.evaluateEligibility(project, sprintId);
  }

  private async evaluateEligibility(
    project: Project,
    sprintId: string,
  ): Promise<SprintExecutionEligibilityResult> {
    // Must run before reading Sprint/active-execution state below — an
    // orphaned SprintExecution left stuck could otherwise be read as still
    // active (same ordering lesson as Sprint 12/13's own reconcile calls).
    await this.reconcileOrphanedSprintExecution(sprintId);

    const sprint = await this.prisma.sprint.findFirst({
      where: { id: sprintId, sprintPlan: { projectId: project.id } },
      include: {
        dependencies: {
          include: { dependsOnSprint: { select: { id: true, status: true } } },
        },
      },
    });
    if (!sprint) {
      throw mapSprintExecutionErrorToHttpException(
        new SprintExecutionError({
          code: SprintExecutionErrorCode.SPRINT_NOT_FOUND,
          message: 'Sprint not found.',
        }),
      );
    }

    const reasons: SprintExecutionErrorCode[] = [];

    if (project.archivedAt) {
      reasons.push(SprintExecutionErrorCode.PROJECT_ARCHIVED);
    }

    if (project.status === ProjectStatus.COMPLETED) {
      reasons.push(SprintExecutionErrorCode.PROJECT_COMPLETED);
    }

    const currentPlan = await this.prisma.sprintPlan.findFirst({
      where: { projectId: project.id },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!currentPlan || currentPlan.id !== sprint.sprintPlanId) {
      reasons.push(SprintExecutionErrorCode.SPRINT_NOT_IN_CURRENT_PLAN);
    }

    try {
      await this.approvalService.assertDevelopmentApproved(project.id);
    } catch (error) {
      if (error instanceof ApprovalError) {
        reasons.push(SprintExecutionErrorCode.DEVELOPMENT_NOT_APPROVED);
      } else {
        throw error;
      }
    }

    if (sprint.status === SprintStatus.PASSED) {
      reasons.push(SprintExecutionErrorCode.SPRINT_ALREADY_PASSED);
    }

    const hasUnmetSprintDependency = sprint.dependencies.some(
      (d) => d.dependsOnSprint.status !== SprintStatus.PASSED,
    );
    if (hasUnmetSprintDependency) {
      reasons.push(SprintExecutionErrorCode.SPRINT_DEPENDENCY_NOT_PASSED);
    }

    // A dependent Sprint may not start until every prerequisite Sprint is
    // both mechanically PASSED (checked above) AND formally ACCEPTED via
    // Sprint 16's own delivery-acceptance gate (item 58/59) — reuses the
    // existing SprintAcceptanceService.getGateStatus() reusable helper
    // rather than re-deriving acceptance rules here (item 59 explicitly
    // warns against duplicating acceptance logic in the orchestrator). A
    // Sprint with no dependencies is unaffected (item 60).
    if (!hasUnmetSprintDependency && sprint.dependencies.length > 0) {
      const gateStatuses = await Promise.all(
        sprint.dependencies.map((d) =>
          this.sprintAcceptanceService.getGateStatus(d.dependsOnSprint.id),
        ),
      );
      if (gateStatuses.some((g) => !g.accepted)) {
        reasons.push(SprintExecutionErrorCode.SPRINT_DEPENDENCY_NOT_ACCEPTED);
      }
    }

    const activeForThisSprint = await this.prisma.sprintExecution.findFirst({
      where: { sprintId, status: { in: ACTIVE_SPRINT_EXECUTION_STATUSES } },
    });
    if (activeForThisSprint) {
      reasons.push(SprintExecutionErrorCode.SPRINT_ALREADY_ACTIVE);
    } else {
      // Only one Sprint may execute per Project at once — the workspace is
      // shared (item 47). Deliberately conservative: a PAUSED/BLOCKED
      // execution on another Sprint still counts as "active" here, since
      // resuming it later would otherwise race a Sprint that started in
      // the meantime.
      const activeOtherSprint = await this.prisma.sprintExecution.findFirst({
        where: {
          projectId: project.id,
          sprintId: { not: sprintId },
          status: { in: ACTIVE_SPRINT_EXECUTION_STATUSES },
        },
      });
      if (activeOtherSprint) {
        reasons.push(SprintExecutionErrorCode.OTHER_SPRINT_ACTIVE);
      }
    }

    try {
      const workspacePath = await this.workspaceService.getReadyWorkspacePath(
        project.id,
      );
      const workspace = await this.prisma.projectWorkspace.findUnique({
        where: { projectId: project.id },
      });
      const branch = await this.git.getCurrentBranch(workspacePath);
      if (
        workspace?.developmentBranch &&
        branch !== workspace.developmentBranch
      ) {
        reasons.push(SprintExecutionErrorCode.WRONG_BRANCH);
      }
      const status = await this.git.getStatus(workspacePath);
      if (!status.clean) {
        reasons.push(SprintExecutionErrorCode.WORKSPACE_DIRTY);
      }
    } catch {
      reasons.push(SprintExecutionErrorCode.WORKSPACE_NOT_READY);
    }

    return {
      runnable: reasons.length === 0,
      reasons,
      sprint: { id: sprint.id, status: sprint.status },
    };
  }

  // ---- run (HTTP-facing entry point) -----------------------------------

  async run(
    userId: string,
    projectId: string,
    sprintId: string,
  ): Promise<RunSprintResult> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    const eligibility = await this.evaluateEligibility(project, sprintId);
    if (!eligibility.runnable) {
      throw mapSprintExecutionErrorToHttpException(
        new SprintExecutionError({
          code: eligibility.reasons[0],
          message: `This Sprint cannot be run right now: ${eligibility.reasons.join(', ')}.`,
        }),
      );
    }

    const sprint = await this.prisma.sprint.findUniqueOrThrow({
      where: { id: sprintId },
    });
    const totalTasks = await this.prisma.task.count({
      where: { sprintId, sprintPlanId: sprint.sprintPlanId },
    });
    const workspacePath = await this.workspaceService.getReadyWorkspacePath(
      project.id,
    );
    const startSha = await this.git.getHeadCommitSha(workspacePath);

    let execution: SprintExecution;
    try {
      execution = await this.prisma.$transaction(async (tx) => {
        const active = await tx.sprintExecution.findFirst({
          where: {
            projectId: project.id,
            status: { in: ACTIVE_SPRINT_EXECUTION_STATUSES },
          },
        });
        if (active) {
          throw new SprintExecutionError({
            code:
              active.sprintId === sprintId
                ? SprintExecutionErrorCode.SPRINT_ALREADY_ACTIVE
                : SprintExecutionErrorCode.OTHER_SPRINT_ACTIVE,
            message:
              'A Sprint execution is already active for this project — a concurrent request may have started it first.',
          });
        }

        const aggregate = await tx.sprintExecution.aggregate({
          where: { sprintId },
          _max: { attempt: true },
        });
        const attempt = (aggregate._max.attempt ?? 0) + 1;

        return tx.sprintExecution.create({
          data: {
            projectId: project.id,
            sprintId,
            sprintPlanId: sprint.sprintPlanId,
            attempt,
            status: SprintExecutionStatus.QUEUED,
            totalTasks,
            repositoryStartSha: startSha,
          },
        });
      });
    } catch (error) {
      if (error instanceof SprintExecutionError) {
        throw mapSprintExecutionErrorToHttpException(error);
      }
      throw error;
    }

    return this.enqueue(project.id, userId, execution);
  }

  // ---- pause / resume / cancel -----------------------------------------

  // Pause takes effect at the next Task-boundary (item 90) — it never
  // interrupts an in-flight Task execution/validation. Cancellation (a
  // stronger, immediate stop) reuses Sprint 8's existing job-cancel
  // endpoint instead — no new plumbing needed here.
  async pause(
    userId: string,
    projectId: string,
    sprintId: string,
  ): Promise<SprintExecutionRecord> {
    await this.projectsService.findOneForUser(userId, projectId);
    const execution = await this.prisma.sprintExecution.findFirst({
      where: { sprintId, status: SprintExecutionStatus.RUNNING },
      orderBy: { attempt: 'desc' },
    });
    if (!execution) {
      throw mapSprintExecutionErrorToHttpException(
        new SprintExecutionError({
          code: SprintExecutionErrorCode.NOT_PAUSABLE,
          message: 'This Sprint has no active running execution to pause.',
        }),
      );
    }
    const updated = await this.prisma.sprintExecution.update({
      where: { id: execution.id },
      data: { pauseRequested: true },
    });
    return toRecord(updated);
  }

  // Resume is for PAUSED (or BLOCKED, if the blocker was externally
  // resolved — item 94) executions only — never FAILED/CANCELLED/
  // COMPLETED. Re-validates every gate live rather than trusting
  // pre-pause assumptions (item 36), then enqueues a fresh background Job
  // continuing the SAME SprintExecution row (not a new attempt).
  async resume(
    userId: string,
    projectId: string,
    sprintId: string,
  ): Promise<RunSprintResult> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    await this.reconcileOrphanedSprintExecution(sprintId);

    const execution = await this.prisma.sprintExecution.findFirst({
      where: {
        sprintId,
        status: {
          in: [SprintExecutionStatus.PAUSED, SprintExecutionStatus.BLOCKED],
        },
      },
      orderBy: { attempt: 'desc' },
    });
    if (!execution) {
      throw mapSprintExecutionErrorToHttpException(
        new SprintExecutionError({
          code: SprintExecutionErrorCode.NOT_RESUMABLE,
          message: 'This Sprint has no paused or blocked execution to resume.',
        }),
      );
    }

    if (project.archivedAt) {
      throw mapSprintExecutionErrorToHttpException(
        new SprintExecutionError({
          code: SprintExecutionErrorCode.PROJECT_ARCHIVED,
          message: 'Cannot resume a Sprint execution for an archived project.',
        }),
      );
    }
    try {
      await this.approvalService.assertDevelopmentApproved(project.id);
    } catch (error) {
      if (error instanceof ApprovalError) {
        throw mapSprintExecutionErrorToHttpException(
          new SprintExecutionError({
            code: SprintExecutionErrorCode.DEVELOPMENT_NOT_APPROVED,
            message:
              'Development approval is no longer valid for this project.',
          }),
        );
      }
      throw error;
    }
    // Live workspace re-check (branch + ready) — never re-checks "clean"
    // here since a BLOCKED (no-runnable-task) Sprint is expected to have a
    // clean workspace already; execute() re-verifies everything again
    // regardless once it actually runs.
    await this.workspaceService.getReadyWorkspacePath(project.id);

    const updated = await this.prisma.sprintExecution.update({
      where: { id: execution.id },
      data: {
        status: SprintExecutionStatus.QUEUED,
        pauseRequested: false,
        errorCode: null,
        errorMessage: null,
      },
    });
    await this.prisma.sprint.updateMany({
      where: { id: sprintId, status: SprintStatus.BLOCKED },
      data: { status: SprintStatus.RUNNING },
    });

    return this.enqueue(project.id, userId, updated);
  }

  private async enqueue(
    projectId: string,
    userId: string,
    execution: SprintExecution,
  ): Promise<RunSprintResult> {
    try {
      const job = await this.jobService.enqueue({
        type: JobType.SPRINT_EXECUTION,
        projectId,
        userId,
        // IDs only — the client never supplies a Task, instruction,
        // provider, or command (item 139).
        payload: { sprintExecutionId: execution.id },
        maxAttempts: 1,
      });
      const updated = await this.prisma.sprintExecution.update({
        where: { id: execution.id },
        data: { backgroundJobId: job.id },
      });
      this.logger.log(
        `Sprint execution enqueued (sprintExecutionId=${execution.id}, sprintId=${execution.sprintId}, attempt=${execution.attempt})`,
      );
      return { sprintExecution: toRecord(updated), job };
    } catch (error) {
      await this.prisma.sprintExecution.update({
        where: { id: execution.id },
        data: {
          status: SprintExecutionStatus.FAILED,
          errorCode: SprintExecutionErrorCode.ENQUEUE_FAILED,
          errorMessage:
            'Failed to enqueue the background Sprint execution job.',
          completedAt: new Date(),
        },
      });
      await this.prisma.sprint.updateMany({
        where: { id: execution.sprintId, status: SprintStatus.RUNNING },
        data: { status: SprintStatus.PENDING },
      });
      throw error;
    }
  }

  // ---- execute (background-worker-facing: the orchestration loop) ------

  // Never throws: every outcome is persisted and returned. A crash-safe,
  // DB-driven loop (item 97) — each iteration re-reads control flags
  // (cancellation/pause) and Task state fresh from the database rather
  // than holding long-lived in-memory state.
  async execute(
    sprintExecutionId: string,
    context: JobExecutionContext,
  ): Promise<SprintExecutionRecord> {
    let execution = await this.prisma.sprintExecution.findUniqueOrThrow({
      where: { id: sprintExecutionId },
    });
    if (!execution.startedAt) {
      await this.prisma.sprintExecution.update({
        where: { id: sprintExecutionId },
        data: { status: SprintExecutionStatus.RUNNING, startedAt: new Date() },
      });
    } else {
      await this.prisma.sprintExecution.update({
        where: { id: sprintExecutionId },
        data: { status: SprintExecutionStatus.RUNNING },
      });
    }

    let workspacePath: string;
    try {
      workspacePath = await this.workspaceService.getReadyWorkspacePath(
        execution.projectId,
      );
    } catch {
      return this.finalize(sprintExecutionId, {
        status: SprintExecutionStatus.FAILED,
        code: SprintExecutionErrorCode.WORKSPACE_NOT_READY,
        message: 'The workspace is not ready.',
      });
    }

    // A generous but bounded iteration cap (item 98) — every genuine
    // iteration causes a real Task-status state transition, so this is
    // never reached in practice; it exists purely to guarantee the loop
    // cannot spin forever on an unforeseen bug.
    const maxIterations = Math.max(execution.totalTasks * 4, 20);

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (await context.isCancellationRequested()) {
        return this.finalizeCancelled(sprintExecutionId, execution.sprintId);
      }

      execution = await this.prisma.sprintExecution.findUniqueOrThrow({
        where: { id: sprintExecutionId },
      });
      if (execution.pauseRequested) {
        return this.finalize(sprintExecutionId, {
          status: SprintExecutionStatus.PAUSED,
          pauseRequested: false,
        });
      }

      try {
        await this.approvalService.assertDevelopmentApproved(
          execution.projectId,
        );
      } catch {
        return this.finalizeSprintStopped(
          sprintExecutionId,
          execution.sprintId,
          {
            status: SprintExecutionStatus.FAILED,
            code: SprintExecutionErrorCode.DEVELOPMENT_NOT_APPROVED,
            message:
              'Development approval is no longer valid for this project.',
          },
        );
      }

      const nextTask = await this.findNextRunnableTask(
        execution.sprintId,
        execution.sprintPlanId,
      );

      if (!nextTask) {
        const allTasks = await this.prisma.task.findMany({
          where: {
            sprintId: execution.sprintId,
            sprintPlanId: execution.sprintPlanId,
          },
        });
        const allPassed =
          allTasks.length > 0 &&
          allTasks.every((t) => t.status === TaskStatus.PASSED);
        if (allPassed) {
          return this.finalizeCompleted(
            sprintExecutionId,
            execution,
            workspacePath,
          );
        }
        const passedCount = allTasks.filter(
          (t) => t.status === TaskStatus.PASSED,
        ).length;
        return this.finalizeSprintStopped(
          sprintExecutionId,
          execution.sprintId,
          {
            status: SprintExecutionStatus.BLOCKED,
            code: SprintExecutionErrorCode.NO_RUNNABLE_TASKS,
            message: `No Task is currently runnable, but not every Task has passed (${passedCount}/${allTasks.length}). Blocking Tasks: ${allTasks
              .filter((t) => t.status !== TaskStatus.PASSED)
              .map((t) => `${t.key} (${t.status})`)
              .join(', ')}.`,
            passedTasks: passedCount,
          },
        );
      }

      await this.prisma.sprintExecution.update({
        where: { id: sprintExecutionId },
        data: { currentTaskId: nextTask.id },
      });

      // ---- Task execution: entirely delegated to Sprint 12 -------------
      await context.reportProgress(
        this.computeProgress(execution),
        `Executing ${nextTask.key}...`,
      );
      let execRecordId: string;
      try {
        const execRecord = await this.taskExecutionService.beginForOrchestrator(
          execution.projectId,
          nextTask.id,
        );
        execRecordId = execRecord.id;
      } catch (error) {
        return this.finalizeSprintStopped(
          sprintExecutionId,
          execution.sprintId,
          {
            status: SprintExecutionStatus.FAILED,
            ...this.normalizeError(error),
          },
        );
      }
      const execResult = await this.taskExecutionService.execute(
        execRecordId,
        context,
      );
      if (execResult.status !== TaskExecutionStatus.READY_FOR_VALIDATION) {
        return this.finalizeTaskDidNotPass(
          sprintExecutionId,
          execution.sprintId,
          nextTask,
          `Task execution ended as ${execResult.status}.`,
        );
      }

      // ---- Task validation: entirely delegated to Sprint 13 ------------
      await context.reportProgress(
        this.computeProgress(execution),
        `Validating ${nextTask.key}...`,
      );
      let attemptId: string;
      try {
        const attemptRecord =
          await this.taskValidationService.beginForOrchestrator(
            execution.projectId,
            nextTask.id,
          );
        attemptId = attemptRecord.id;
      } catch (error) {
        return this.finalizeSprintStopped(
          sprintExecutionId,
          execution.sprintId,
          {
            status: SprintExecutionStatus.FAILED,
            ...this.normalizeError(error),
          },
        );
      }
      const validationResult = await this.taskValidationService.execute(
        attemptId,
        context,
      );
      if (validationResult.status !== ValidationAttemptStatus.PASSED) {
        return this.finalizeTaskDidNotPass(
          sprintExecutionId,
          execution.sprintId,
          nextTask,
          `Task validation ended as ${validationResult.status}.`,
        );
      }

      // ---- Task PASSED: verify workspace clean, bump counters, loop ----
      const status = await this.git.getStatus(workspacePath);
      if (!status.clean) {
        return this.finalizeSprintStopped(
          sprintExecutionId,
          execution.sprintId,
          {
            status: SprintExecutionStatus.FAILED,
            code: SprintExecutionErrorCode.WORKSPACE_NOT_CLEAN_AFTER_TASK,
            message: `Workspace was not clean after ${nextTask.key} passed validation.`,
          },
        );
      }
      await this.prisma.sprintExecution.update({
        where: { id: sprintExecutionId },
        data: { passedTasks: { increment: 1 } },
      });
    }

    // Loop bound exhausted without reaching a terminal state — treat as an
    // infrastructure failure rather than spinning again (item 98).
    return this.finalizeSprintStopped(sprintExecutionId, execution.sprintId, {
      status: SprintExecutionStatus.FAILED,
      code: SprintExecutionErrorCode.UNKNOWN_ERROR,
      message:
        'Sprint execution exceeded its maximum iteration bound without completing.',
    });
  }

  private computeProgress(execution: SprintExecution): number {
    if (execution.totalTasks === 0) return 0;
    return Math.round((execution.passedTasks / execution.totalTasks) * 100);
  }

  private async finalize(
    sprintExecutionId: string,
    data: {
      status: SprintExecutionStatus;
      code?: string;
      message?: string;
      pauseRequested?: boolean;
    },
  ): Promise<SprintExecutionRecord> {
    const updated = await this.prisma.sprintExecution.update({
      where: { id: sprintExecutionId },
      data: {
        status: data.status,
        errorCode: data.code ?? null,
        errorMessage: data.message ?? null,
        ...(data.pauseRequested !== undefined
          ? { pauseRequested: data.pauseRequested }
          : {}),
      },
    });
    return toRecord(updated);
  }

  private async finalizeCancelled(
    sprintExecutionId: string,
    sprintId: string,
  ): Promise<SprintExecutionRecord> {
    const updated = await this.prisma.sprintExecution.update({
      where: { id: sprintExecutionId },
      data: {
        status: SprintExecutionStatus.CANCELLED,
        completedAt: new Date(),
      },
    });
    // Sprint domain status has no CANCELLED value (deliberately not added —
    // item 34) — mapped to FAILED, documented explicitly in the report.
    await this.prisma.sprint.updateMany({
      where: { id: sprintId, status: SprintStatus.RUNNING },
      data: { status: SprintStatus.FAILED },
    });
    this.logger.warn(
      `Sprint execution cancelled (sprintExecutionId=${sprintExecutionId})`,
    );
    return toRecord(updated);
  }

  private async finalizeSprintStopped(
    sprintExecutionId: string,
    sprintId: string,
    data: {
      status: SprintExecutionStatus;
      code: string;
      message: string;
      passedTasks?: number;
    },
  ): Promise<SprintExecutionRecord> {
    const updated = await this.prisma.sprintExecution.update({
      where: { id: sprintExecutionId },
      data: {
        status: data.status,
        errorCode: data.code,
        errorMessage: data.message,
        completedAt: new Date(),
        ...(data.passedTasks !== undefined
          ? { passedTasks: data.passedTasks }
          : {}),
      },
    });
    await this.prisma.sprint.updateMany({
      where: { id: sprintId, status: SprintStatus.RUNNING },
      data: {
        status:
          data.status === SprintExecutionStatus.BLOCKED
            ? SprintStatus.BLOCKED
            : SprintStatus.FAILED,
      },
    });
    this.logger.warn(
      `Sprint execution ${data.status.toLowerCase()} (sprintExecutionId=${sprintExecutionId}, code=${data.code})`,
    );
    return toRecord(updated);
  }

  private async finalizeTaskDidNotPass(
    sprintExecutionId: string,
    sprintId: string,
    task: Task,
    message: string,
  ): Promise<SprintExecutionRecord> {
    const updated = await this.prisma.sprintExecution.update({
      where: { id: sprintExecutionId },
      data: {
        status: SprintExecutionStatus.FAILED,
        errorCode: SprintExecutionErrorCode.TASK_NOT_PASSED,
        errorMessage: `${task.key}: ${message}`,
        failedTasks: { increment: 1 },
        completedAt: new Date(),
      },
    });
    await this.prisma.sprint.updateMany({
      where: { id: sprintId, status: SprintStatus.RUNNING },
      data: { status: SprintStatus.FAILED },
    });
    this.logger.warn(
      `Sprint execution stopped: ${task.key} did not pass (sprintExecutionId=${sprintExecutionId})`,
    );
    return toRecord(updated);
  }

  private async finalizeCompleted(
    sprintExecutionId: string,
    execution: SprintExecution,
    workspacePath: string,
  ): Promise<SprintExecutionRecord> {
    const endSha = await this.git.getHeadCommitSha(workspacePath);
    const [, updated] = await this.prisma.$transaction([
      this.prisma.sprint.update({
        where: { id: execution.sprintId },
        data: { status: SprintStatus.PASSED },
      }),
      this.prisma.sprintExecution.update({
        where: { id: sprintExecutionId },
        data: {
          status: SprintExecutionStatus.COMPLETED,
          repositoryEndSha: endSha,
          currentTaskId: null,
          passedTasks: execution.totalTasks,
          completedAt: new Date(),
        },
      }),
    ]);
    this.logger.log(
      `Sprint execution COMPLETED (sprintExecutionId=${sprintExecutionId}, sprintId=${execution.sprintId}, finalSha=${endSha})`,
    );
    return toRecord(updated);
  }

  private normalizeError(error: unknown): { code: string; message: string } {
    if (error instanceof SprintExecutionError) {
      return { code: error.code, message: error.message };
    }
    if (error instanceof ApprovalError) {
      return {
        code: SprintExecutionErrorCode.DEVELOPMENT_NOT_APPROVED,
        message: 'Development approval is no longer valid for this project.',
      };
    }
    if (error instanceof GitError) {
      return {
        code: SprintExecutionErrorCode.WORKSPACE_NOT_READY,
        message: error.message,
      };
    }
    if (error instanceof HttpException) {
      const body = error.getResponse();
      const message =
        typeof body === 'object' && body !== null && 'message' in body
          ? String((body as { message: unknown }).message)
          : error.message;
      const code =
        typeof body === 'object' && body !== null && 'code' in body
          ? String((body as { code: unknown }).code)
          : SprintExecutionErrorCode.UNKNOWN_ERROR;
      return { code, message };
    }
    return {
      code: SprintExecutionErrorCode.UNKNOWN_ERROR,
      message: 'An unexpected error occurred while selecting the next Task.',
    };
  }

  // ---- reads -------------------------------------------------------------

  async listExecutions(
    userId: string,
    projectId: string,
    sprintId: string,
  ): Promise<SprintExecutionRecord[]> {
    await this.projectsService.findOneForUser(userId, projectId);
    await this.assertSprintBelongsToProject(sprintId, projectId);
    const executions = await this.prisma.sprintExecution.findMany({
      where: { sprintId },
      orderBy: { attempt: 'desc' },
    });
    return executions.map(toRecord);
  }

  async getCurrentExecution(
    userId: string,
    projectId: string,
    sprintId: string,
  ): Promise<SprintExecutionRecord> {
    await this.projectsService.findOneForUser(userId, projectId);
    await this.assertSprintBelongsToProject(sprintId, projectId);
    const execution = await this.prisma.sprintExecution.findFirst({
      where: { sprintId },
      orderBy: { attempt: 'desc' },
    });
    if (!execution) {
      throw mapSprintExecutionErrorToHttpException(
        new SprintExecutionError({
          code: SprintExecutionErrorCode.EXECUTION_NOT_FOUND,
          message: 'This Sprint has never been run.',
        }),
      );
    }
    return toRecord(execution);
  }

  async getExecution(
    userId: string,
    projectId: string,
    executionId: string,
  ): Promise<SprintExecutionRecord> {
    await this.projectsService.findOneForUser(userId, projectId);
    const execution = await this.prisma.sprintExecution.findFirst({
      where: { id: executionId, projectId },
    });
    if (!execution) {
      throw mapSprintExecutionErrorToHttpException(
        new SprintExecutionError({
          code: SprintExecutionErrorCode.EXECUTION_NOT_FOUND,
          message: 'Sprint execution not found.',
        }),
      );
    }
    return toRecord(execution);
  }

  // ---- internals -----------------------------------------------------

  private async assertSprintBelongsToProject(
    sprintId: string,
    projectId: string,
  ): Promise<void> {
    const sprint = await this.prisma.sprint.findFirst({
      where: { id: sprintId, sprintPlan: { projectId } },
      select: { id: true },
    });
    if (!sprint) {
      throw mapSprintExecutionErrorToHttpException(
        new SprintExecutionError({
          code: SprintExecutionErrorCode.SPRINT_NOT_FOUND,
          message: 'Sprint not found.',
        }),
      );
    }
  }

  // Deterministic, dependency-aware, lowest-order-first selection (items
  // 15/17/81) — never asks an AI which Task to run next. Scoped to the
  // exact SprintPlan version pinned at Sprint-execution start (item 84),
  // so a later plan regeneration can never redirect an in-flight
  // orchestration onto a different Task graph.
  private async findNextRunnableTask(
    sprintId: string,
    sprintPlanId: string,
  ): Promise<Task | null> {
    const tasks = (await this.prisma.task.findMany({
      where: { sprintId, sprintPlanId },
      include: {
        dependencies: {
          include: { dependsOnTask: { select: { status: true } } },
        },
      },
      orderBy: { order: 'asc' },
    })) as TaskWithDeps[];

    for (const task of tasks) {
      if (
        task.status !== TaskStatus.PENDING &&
        task.status !== TaskStatus.READY
      ) {
        continue;
      }
      const allDependenciesPassed = task.dependencies.every(
        (d) => d.dependsOnTask.status === TaskStatus.PASSED,
      );
      if (!allDependenciesPassed) continue;
      return task;
    }
    return null;
  }

  // Self-heals a SprintExecution left stuck QUEUED/RUNNING because its
  // background Job ended (worker crash/restart, or the Job being cancelled
  // while still QUEUED so the handler never ran at all) without this
  // service's own execute() loop ever reporting a terminal outcome —
  // mirrors Sprint 12/13's reconcileOrphanedExecution/
  // reconcileOrphanedValidation. Also rolls back the one Task left RUNNING
  // by the crash (item 41/44) — a Task left REVIEWING needs no rollback at
  // all, since resuming the loop simply validates it rather than recoding.
  private async reconcileOrphanedSprintExecution(
    sprintId: string,
  ): Promise<void> {
    const active = await this.prisma.sprintExecution.findFirst({
      where: { sprintId, status: { in: IN_FLIGHT_STATUSES } },
      orderBy: { attempt: 'desc' },
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

    if (active.currentTaskId) {
      const task = await this.prisma.task.findUnique({
        where: { id: active.currentTaskId },
      });
      if (task?.status === TaskStatus.RUNNING) {
        const latestExecution = await this.prisma.taskExecution.findFirst({
          where: { taskId: task.id },
          orderBy: { attempt: 'desc' },
        });
        if (latestExecution?.status === 'RUNNING') {
          await this.prisma.taskExecution.update({
            where: { id: latestExecution.id },
            data: {
              status: 'FAILED',
              errorCode: 'ORPHANED_EXECUTION',
              errorMessage:
                'The Sprint execution ended without this Task execution reporting a result (likely a worker restart).',
              completedAt: new Date(),
            },
          });
        }
        await this.prisma.task.updateMany({
          where: { id: task.id, status: TaskStatus.RUNNING },
          data: {
            status: latestExecution?.priorTaskStatus ?? TaskStatus.READY,
          },
        });
      }
      // A Task left REVIEWING needs no rollback — resuming (a fresh Start
      // Sprint / Resume call) will simply validate it, never re-run Claude
      // (item 42).
    }

    await this.prisma.sprintExecution.updateMany({
      where: { id: active.id, status: { in: IN_FLIGHT_STATUSES } },
      data: {
        status: SprintExecutionStatus.FAILED,
        errorCode: SprintExecutionErrorCode.ORPHANED_SPRINT_EXECUTION,
        errorMessage:
          'The background job ended without this Sprint execution reporting a result (likely a worker restart).',
        completedAt: new Date(),
      },
    });
    this.logger.warn(
      `Reconciled an orphaned Sprint execution (sprintExecutionId=${active.id})`,
    );
  }
}
