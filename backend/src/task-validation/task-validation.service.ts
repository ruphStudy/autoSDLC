import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
  JobType,
  Prisma,
  Project,
  Task,
  TaskExecution,
  ValidationAttempt,
  ValidationAttemptStatus,
  ValidationCheckType,
  ValidationRunStatus,
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
import { ValidationPlanResolver } from './tooling/validation-plan-resolver';
import { ValidationCommandExecutor } from './execution/validation-command-executor';
import {
  TaskValidationExpectation,
  ValidationCheck,
} from './types/validation-plan.types';
import {
  TaskValidationEligibilityResult,
  ValidateTaskResult,
  ValidationAttemptRecord,
  ValidationRunRecord,
} from './types/validation-record.types';
import {
  TaskValidationError,
  TaskValidationErrorCode,
} from './errors/task-validation.error';
import { mapTaskValidationErrorToHttpException } from './errors/task-validation-error.mapper';

const ACTIVE_ATTEMPT_STATUSES: ValidationAttemptStatus[] = [
  ValidationAttemptStatus.QUEUED,
  ValidationAttemptStatus.RUNNING,
];

// lint -> typecheck -> unit -> integration -> build -> e2e (item 29).
// Independent checks all run regardless of an earlier failure (item 30) —
// this only controls presentation/sequencing order, not fail-fast behavior.
const CHECK_ORDER: ValidationCheckType[] = [
  ValidationCheckType.LINT,
  ValidationCheckType.TYPECHECK,
  ValidationCheckType.UNIT_TEST,
  ValidationCheckType.INTEGRATION_TEST,
  ValidationCheckType.BUILD,
  ValidationCheckType.E2E_TEST,
  ValidationCheckType.CUSTOM,
];

interface ChangedFileEntry {
  path: string;
  changeType: string;
}

function toRunRecord(run: {
  id: string;
  type: ValidationCheckType;
  name: string;
  command: string;
  args: unknown;
  workingDirectory: string | null;
  status: ValidationRunStatus;
  required: boolean;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  outputTruncated: boolean;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
}): ValidationRunRecord {
  return {
    id: run.id,
    type: run.type,
    name: run.name,
    command: run.command,
    args: (run.args as string[]) ?? [],
    workingDirectory: run.workingDirectory,
    status: run.status,
    required: run.required,
    exitCode: run.exitCode,
    stdout: run.stdout,
    stderr: run.stderr,
    outputTruncated: run.outputTruncated,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
  };
}

function toAttemptRecord(
  attempt: ValidationAttempt,
  runs: Parameters<typeof toRunRecord>[0][],
): ValidationAttemptRecord {
  return {
    id: attempt.id,
    projectId: attempt.projectId,
    taskId: attempt.taskId,
    taskExecutionId: attempt.taskExecutionId,
    attempt: attempt.attempt,
    status: attempt.status,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    requiredPassed: attempt.requiredPassed,
    requiredFailed: attempt.requiredFailed,
    optionalPassed: attempt.optionalPassed,
    optionalFailed: attempt.optionalFailed,
    commitSha: attempt.commitSha,
    errorCode: attempt.errorCode,
    errorMessage: attempt.errorMessage,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
    runs: runs
      .map(toRunRecord)
      .sort((a, b) => sortIndex(a.type) - sortIndex(b.type)),
  };
}

function sortIndex(type: ValidationCheckType): number {
  const i = CHECK_ORDER.indexOf(type);
  return i === -1 ? CHECK_ORDER.length : i;
}

// Orchestrates the Deterministic Validation Engine: independently verifies
// coding-agent output using real repository commands, never Claude's own
// narrative. A Task reaches PASSED only via: every required ValidationRun
// PASSED, a final Git-consistency recheck, and a successful local commit —
// never from CodingAgentProvider's own SUCCEEDED result alone.
@Injectable()
export class TaskValidationService {
  private readonly logger = new Logger(TaskValidationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly approvalService: ApprovalService,
    private readonly workspaceService: WorkspaceService,
    private readonly git: GitService,
    private readonly jobService: JobService,
    private readonly planResolver: ValidationPlanResolver,
    private readonly executor: ValidationCommandExecutor,
  ) {}

  // ---- eligibility ---------------------------------------------------

  async getEligibility(
    userId: string,
    projectId: string,
    taskId: string,
  ): Promise<TaskValidationEligibilityResult> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    return this.evaluateEligibility(project, taskId);
  }

  private async evaluateEligibility(
    project: Project,
    taskId: string,
  ): Promise<TaskValidationEligibilityResult> {
    // Must run before reading the Task below — an orphaned validation left
    // stuck could otherwise be read as still-active (same ordering lesson
    // as Sprint 12's reconcileOrphanedExecution).
    await this.reconcileOrphanedValidation(taskId);

    const task = await this.prisma.task.findFirst({
      where: { id: taskId, sprintPlan: { projectId: project.id } },
    });
    if (!task) {
      throw mapTaskValidationErrorToHttpException(
        new TaskValidationError({
          code: TaskValidationErrorCode.TASK_NOT_FOUND,
          message: 'Task not found.',
        }),
      );
    }

    const reasons: TaskValidationErrorCode[] = [];

    if (project.archivedAt) {
      reasons.push(TaskValidationErrorCode.PROJECT_ARCHIVED);
    }

    const currentPlan = await this.prisma.sprintPlan.findFirst({
      where: { projectId: project.id },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!currentPlan || currentPlan.id !== task.sprintPlanId) {
      reasons.push(TaskValidationErrorCode.TASK_NOT_IN_CURRENT_PLAN);
    }

    try {
      await this.approvalService.assertDevelopmentApproved(project.id);
    } catch (error) {
      if (error instanceof ApprovalError) {
        reasons.push(TaskValidationErrorCode.DEVELOPMENT_NOT_APPROVED);
      } else {
        throw error;
      }
    }

    if (task.status !== 'REVIEWING') {
      reasons.push(TaskValidationErrorCode.TASK_NOT_REVIEWING);
    }

    const latestExecution = await this.prisma.taskExecution.findFirst({
      where: { taskId },
      orderBy: { attempt: 'desc' },
    });
    if (!latestExecution || latestExecution.status !== 'READY_FOR_VALIDATION') {
      reasons.push(TaskValidationErrorCode.NO_SUCCESSFUL_EXECUTION);
    }

    const active = await this.prisma.validationAttempt.findFirst({
      where: { taskId, status: { in: ACTIVE_ATTEMPT_STATUSES } },
    });
    if (active) {
      reasons.push(TaskValidationErrorCode.ACTIVE_VALIDATION);
    }

    let workspacePath: string | null = null;
    try {
      workspacePath = await this.assertWorkspaceReadyAndOnBranch(project.id);
    } catch (error) {
      if (error instanceof TaskValidationError) {
        reasons.push(error.code);
      } else {
        reasons.push(TaskValidationErrorCode.WORKSPACE_NOT_READY);
      }
    }

    if (workspacePath && latestExecution) {
      const repoReasons = await this.checkRepositoryConsistency(
        workspacePath,
        latestExecution,
      );
      reasons.push(...repoReasons);
    }

    return {
      runnable: reasons.length === 0,
      reasons,
      task: { id: task.id, status: task.status },
    };
  }

  private async checkRepositoryConsistency(
    workspacePath: string,
    execution: TaskExecution,
  ): Promise<TaskValidationErrorCode[]> {
    const reasons: TaskValidationErrorCode[] = [];

    const currentHead = await this.git.getHeadCommitSha(workspacePath);
    const expectedHead =
      execution.repositoryEndSha ?? execution.repositoryStartSha;
    if (expectedHead && currentHead !== expectedHead) {
      reasons.push(TaskValidationErrorCode.REPOSITORY_STATE_CHANGED);
      return reasons;
    }

    const status = await this.git.getStatus(workspacePath);
    const expectedPaths = new Set(
      ((execution.changedFiles as unknown as ChangedFileEntry[]) ?? []).map(
        (f) => f.path,
      ),
    );
    const actualPaths = new Set(status.files.map((f) => f.path));

    if (expectedPaths.size === 0 && actualPaths.size > 0) {
      reasons.push(TaskValidationErrorCode.UNEXPECTED_WORKSPACE_CHANGES);
    } else if (expectedPaths.size > 0 && actualPaths.size === 0) {
      reasons.push(TaskValidationErrorCode.NO_EXPECTED_CHANGES);
    } else {
      const hasUnexpected = [...actualPaths].some((p) => !expectedPaths.has(p));
      if (hasUnexpected)
        reasons.push(TaskValidationErrorCode.UNEXPECTED_WORKSPACE_CHANGES);
    }

    return reasons;
  }

  // ---- validate (HTTP-facing entry point) -----------------------------

  async validate(
    userId: string,
    projectId: string,
    taskId: string,
  ): Promise<ValidateTaskResult> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );

    const eligibility = await this.evaluateEligibility(project, taskId);
    if (!eligibility.runnable) {
      throw mapTaskValidationErrorToHttpException(
        new TaskValidationError({
          code: eligibility.reasons[0],
          message: `This Task cannot be validated right now: ${eligibility.reasons.join(', ')}.`,
        }),
      );
    }

    const latestExecution = await this.prisma.taskExecution.findFirstOrThrow({
      where: { taskId },
      orderBy: { attempt: 'desc' },
    });

    let attempt: ValidationAttempt;
    try {
      attempt = await this.prisma.$transaction(async (tx) => {
        const active = await tx.validationAttempt.findFirst({
          where: { taskId, status: { in: ACTIVE_ATTEMPT_STATUSES } },
        });
        if (active) {
          throw new TaskValidationError({
            code: TaskValidationErrorCode.ACTIVE_VALIDATION,
            message: 'A validation is already in progress for this Task.',
          });
        }
        const aggregate = await tx.validationAttempt.aggregate({
          where: { taskId },
          _max: { attempt: true },
        });
        const nextAttempt = (aggregate._max.attempt ?? 0) + 1;
        return tx.validationAttempt.create({
          data: {
            projectId: project.id,
            taskId,
            taskExecutionId: latestExecution.id,
            attempt: nextAttempt,
            status: ValidationAttemptStatus.QUEUED,
          },
        });
      });
    } catch (error) {
      if (error instanceof TaskValidationError) {
        throw mapTaskValidationErrorToHttpException(error);
      }
      throw error;
    }

    try {
      const job = await this.jobService.enqueue({
        type: JobType.TASK_VALIDATION,
        projectId: project.id,
        userId,
        payload: {
          validationAttemptId: attempt.id,
          taskId,
          projectId: project.id,
        },
        maxAttempts: 1,
      });
      const updated = await this.prisma.validationAttempt.update({
        where: { id: attempt.id },
        data: { backgroundJobId: job.id },
      });
      this.logger.log(
        `Task validation enqueued (validationAttemptId=${attempt.id}, taskId=${taskId}, attempt=${attempt.attempt})`,
      );
      return { validationAttempt: toAttemptRecord(updated, []), job };
    } catch (error) {
      await this.prisma.validationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: ValidationAttemptStatus.FAILED,
          errorCode: TaskValidationErrorCode.ENQUEUE_FAILED,
          errorMessage: 'Failed to enqueue the background validation job.',
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }

  // ---- execute (background-worker-facing) -----------------------------

  async execute(
    validationAttemptId: string,
    context: JobExecutionContext,
  ): Promise<ValidationAttemptRecord> {
    const attempt = await this.prisma.validationAttempt.findUniqueOrThrow({
      where: { id: validationAttemptId },
    });
    const startedAt = new Date();
    await this.prisma.validationAttempt.update({
      where: { id: validationAttemptId },
      data: { status: ValidationAttemptStatus.RUNNING, startedAt },
    });

    try {
      if (await context.isCancellationRequested()) {
        throw new TaskValidationError({
          code: TaskValidationErrorCode.CANCELLED_BEFORE_START,
          message: 'Validation was cancelled before it started.',
        });
      }

      await this.approvalService.assertDevelopmentApproved(attempt.projectId);

      const task = await this.prisma.task.findUniqueOrThrow({
        where: { id: attempt.taskId },
      });
      if (task.status !== 'REVIEWING') {
        throw new TaskValidationError({
          code: TaskValidationErrorCode.TASK_NOT_REVIEWING,
          message: 'This Task is no longer REVIEWING.',
        });
      }

      const execution = await this.prisma.taskExecution.findUniqueOrThrow({
        where: { id: attempt.taskExecutionId },
      });

      // Idempotent finalization (item 102): a previous crashed attempt may
      // have already committed successfully — never commit again.
      if (execution.commitSha) {
        return await this.finalizePreviouslyCommitted(attempt, execution);
      }

      const workspacePath = await this.assertWorkspaceReadyAndOnBranch(
        attempt.projectId,
      );

      const currentHead = await this.git.getHeadCommitSha(workspacePath);
      const expectedHead =
        execution.repositoryEndSha ?? execution.repositoryStartSha;
      if (expectedHead && currentHead !== expectedHead) {
        throw new TaskValidationError({
          code: TaskValidationErrorCode.REPOSITORY_STATE_CHANGED,
          message:
            'The repository HEAD changed unexpectedly before validation could run.',
        });
      }

      const baselineStatus = await this.git.getStatus(workspacePath);
      const expectedPaths = new Set(
        ((execution.changedFiles as unknown as ChangedFileEntry[]) ?? []).map(
          (f) => f.path,
        ),
      );
      const baselinePaths = new Set(baselineStatus.files.map((f) => f.path));

      if (expectedPaths.size > 0 && baselinePaths.size === 0) {
        throw new TaskValidationError({
          code: TaskValidationErrorCode.NO_EXPECTED_CHANGES,
          message:
            'The workspace is clean but changes were expected for this Task.',
        });
      }
      const hasUnexpectedBaseline = [...baselinePaths].some(
        (p) => !expectedPaths.has(p),
      );
      if (hasUnexpectedBaseline) {
        throw new TaskValidationError({
          code: TaskValidationErrorCode.UNEXPECTED_WORKSPACE_CHANGES,
          message:
            'The workspace contains changes unrelated to this Task execution.',
        });
      }
      const noChangesToValidate =
        expectedPaths.size === 0 && baselinePaths.size === 0;

      await context.reportProgress(5, 'Resolving validation plan...');
      const expectations =
        (task.validationExpectations as unknown as TaskValidationExpectation[]) ??
        [];
      const checks = this.orderChecks(
        await this.planResolver.resolve(expectations, workspacePath),
      );

      const runRows = await Promise.all(
        checks.map((check) =>
          this.prisma.validationRun.create({
            data: {
              validationAttemptId,
              projectId: attempt.projectId,
              taskId: attempt.taskId,
              taskExecutionId: execution.id,
              type: check.type,
              name: check.name,
              command: check.command,
              args: check.args as Prisma.InputJsonValue,
              workingDirectory: check.workingDirectory,
              required: check.required,
              status: ValidationRunStatus.PENDING,
            },
          }),
        ),
      );

      let cancelledMidway = false;
      for (let i = 0; i < checks.length; i++) {
        const check = checks[i];
        const row = runRows[i];

        if (cancelledMidway || (await context.isCancellationRequested())) {
          cancelledMidway = true;
          await this.prisma.validationRun.update({
            where: { id: row.id },
            data: {
              status: ValidationRunStatus.CANCELLED,
              completedAt: new Date(),
            },
          });
          continue;
        }

        await context.reportProgress(
          10 + Math.round((70 * (i + 1)) / Math.max(checks.length, 1)),
          `Running ${check.name}...`,
        );
        await this.runOneCheck(row.id, check, workspacePath, context);
      }

      const finalRuns = await this.prisma.validationRun.findMany({
        where: { validationAttemptId },
      });
      const requiredRuns = finalRuns.filter((r) => r.required);
      const optionalRuns = finalRuns.filter((r) => !r.required);
      const requiredPassed = requiredRuns.filter(
        (r) => r.status === ValidationRunStatus.PASSED,
      ).length;
      const requiredFailed = requiredRuns.length - requiredPassed;
      const optionalPassed = optionalRuns.filter(
        (r) => r.status === ValidationRunStatus.PASSED,
      ).length;
      const optionalFailed = optionalRuns.filter(
        (r) =>
          r.status === ValidationRunStatus.FAILED ||
          r.status === ValidationRunStatus.CANCELLED,
      ).length;

      if (cancelledMidway) {
        throw new TaskValidationError({
          code: TaskValidationErrorCode.VALIDATION_CANCELLED,
          message: 'Validation was cancelled.',
        });
      }

      const allRequiredPassed = requiredFailed === 0;

      if (!allRequiredPassed) {
        return await this.finalizeFailedValidation(
          attempt,
          startedAt,
          { requiredPassed, requiredFailed, optionalPassed, optionalFailed },
          {
            code: TaskValidationErrorCode.VALIDATION_FAILED,
            message: `${requiredFailed} required check(s) did not pass.`,
          },
          finalRuns,
        );
      }

      await context.reportProgress(85, 'Verifying Git diff...');
      return await this.commitAndFinalize(
        attempt,
        task,
        execution,
        workspacePath,
        baselinePaths,
        expectedPaths,
        noChangesToValidate,
        currentHead,
        startedAt,
        { requiredPassed, requiredFailed, optionalPassed, optionalFailed },
        finalRuns,
      );
    } catch (error) {
      const runs = await this.prisma.validationRun.findMany({
        where: { validationAttemptId },
      });
      const requiredRuns = runs.filter((r) => r.required);
      const optionalRuns = runs.filter((r) => !r.required);
      const counts = {
        requiredPassed: requiredRuns.filter(
          (r) => r.status === ValidationRunStatus.PASSED,
        ).length,
        requiredFailed: requiredRuns.filter(
          (r) => r.status !== ValidationRunStatus.PASSED,
        ).length,
        optionalPassed: optionalRuns.filter(
          (r) => r.status === ValidationRunStatus.PASSED,
        ).length,
        optionalFailed: optionalRuns.filter(
          (r) =>
            r.status === ValidationRunStatus.FAILED ||
            r.status === ValidationRunStatus.CANCELLED,
        ).length,
      };
      return await this.finalizeFailedValidation(
        attempt,
        startedAt,
        counts,
        this.normalizeError(error),
        runs,
      );
    }
  }

  private async runOneCheck(
    runId: string,
    check: ValidationCheck,
    workspacePath: string,
    context: JobExecutionContext,
  ): Promise<void> {
    if (check.unavailableReason) {
      await this.prisma.validationRun.update({
        where: { id: runId },
        data: {
          status: check.required
            ? ValidationRunStatus.FAILED
            : ValidationRunStatus.SKIPPED,
          stderr: check.unavailableReason,
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });
      return;
    }

    await this.prisma.validationRun.update({
      where: { id: runId },
      data: { status: ValidationRunStatus.RUNNING, startedAt: new Date() },
    });

    const cwd = check.workingDirectory
      ? path.join(workspacePath, check.workingDirectory)
      : workspacePath;

    const abortController = new AbortController();
    const poll = setInterval(() => {
      context.isCancellationRequested().then((cancelled) => {
        if (cancelled) abortController.abort();
      });
    }, 2000);

    try {
      const result = await this.executor.run(check.command, check.args, {
        cwd,
        signal: abortController.signal,
      });
      const status = result.cancelled
        ? ValidationRunStatus.CANCELLED
        : result.exitCode === 0
          ? ValidationRunStatus.PASSED
          : ValidationRunStatus.FAILED;
      await this.prisma.validationRun.update({
        where: { id: runId },
        data: {
          status,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          outputTruncated: result.outputTruncated,
          completedAt: new Date(),
          durationMs: result.durationMs,
        },
      });
    } catch (error) {
      await this.prisma.validationRun.update({
        where: { id: runId },
        data: {
          status: ValidationRunStatus.FAILED,
          stderr:
            error instanceof Error
              ? error.message
              : 'The command could not be executed.',
          completedAt: new Date(),
        },
      });
    } finally {
      clearInterval(poll);
    }
  }

  private async commitAndFinalize(
    attempt: ValidationAttempt,
    task: Task,
    execution: TaskExecution,
    workspacePath: string,
    baselinePaths: Set<string>,
    expectedPaths: Set<string>,
    noChangesToValidate: boolean,
    preCommitHead: string | null,
    startedAt: Date,
    counts: {
      requiredPassed: number;
      requiredFailed: number;
      optionalPassed: number;
      optionalFailed: number;
    },
    runs: Awaited<ReturnType<typeof this.prisma.validationRun.findMany>>,
  ): Promise<ValidationAttemptRecord> {
    if (noChangesToValidate) {
      // Nothing to stage or commit — the Task legitimately required no
      // file changes (item 9). Record the current HEAD for reference only;
      // no new commit is created.
      return await this.finalizePassedValidation(
        attempt,
        task,
        execution,
        startedAt,
        counts,
        preCommitHead,
        null,
        runs,
      );
    }

    // Final race/pollution check (items 54-57, 97): re-read Git status and
    // compare against the baseline captured before any validation command
    // ran. Anything different — whether a concurrent process touched the
    // workspace, or a validation command itself modified tracked source —
    // means the exact change set that was validated can no longer be
    // trusted, and must never be committed.
    const postStatus = await this.git.getStatus(workspacePath);
    const postPaths = new Set(postStatus.files.map((f) => f.path));
    const setsEqual =
      postPaths.size === baselinePaths.size &&
      [...postPaths].every((p) => baselinePaths.has(p));
    if (!setsEqual) {
      return await this.finalizeFailedValidation(
        attempt,
        startedAt,
        counts,
        {
          code: TaskValidationErrorCode.WORKSPACE_CHANGED_AFTER_VALIDATION,
          message:
            'The workspace changed while validation was running. The validated change set can no longer be trusted, so nothing was committed.',
        },
        runs,
      );
    }

    const diffResult = await this.git.getDiff(workspacePath);
    const validatedDiffHash = createHash('sha256')
      .update([...postPaths].sort().join('\n'))
      .update(diffResult.diff)
      .digest('hex');

    try {
      await this.git.stageFiles(workspacePath, [...expectedPaths]);
    } catch {
      return await this.finalizeFailedValidation(
        attempt,
        startedAt,
        counts,
        {
          code: TaskValidationErrorCode.COMMIT_FAILED,
          message: 'Failed to stage the Task changes.',
        },
        runs,
        validatedDiffHash,
      );
    }

    let commitSha: string;
    try {
      commitSha = await this.git.commit(
        workspacePath,
        this.buildCommitMessage(task),
      );
    } catch {
      return await this.finalizeFailedValidation(
        attempt,
        startedAt,
        counts,
        {
          code: TaskValidationErrorCode.COMMIT_FAILED,
          message: 'Failed to commit the validated Task changes.',
        },
        runs,
        validatedDiffHash,
      );
    }

    const afterCommitStatus = await this.git.getStatus(workspacePath);
    if (!afterCommitStatus.clean) {
      // The commit genuinely happened — persist its SHA for audit/
      // reconciliation even though the Task must not be marked PASSED
      // (item 44): something unexpected remained in the workspace.
      return await this.finalizeFailedValidation(
        attempt,
        startedAt,
        counts,
        {
          code: TaskValidationErrorCode.WORKSPACE_NOT_CLEAN_AFTER_COMMIT,
          message:
            'The workspace was not clean after committing. This Task was not marked PASSED.',
        },
        runs,
        validatedDiffHash,
        commitSha,
      );
    }

    return await this.finalizePassedValidation(
      attempt,
      task,
      execution,
      startedAt,
      counts,
      commitSha,
      validatedDiffHash,
      runs,
    );
  }

  private async finalizePassedValidation(
    attempt: ValidationAttempt,
    task: Task,
    execution: TaskExecution,
    startedAt: Date,
    counts: {
      requiredPassed: number;
      requiredFailed: number;
      optionalPassed: number;
      optionalFailed: number;
    },
    commitSha: string | null,
    validatedDiffHash: string | null,
    runs: Awaited<ReturnType<typeof this.prisma.validationRun.findMany>>,
  ): Promise<ValidationAttemptRecord> {
    const [, updatedAttempt] = await this.prisma.$transaction([
      this.prisma.task.update({
        where: { id: task.id },
        data: { status: 'PASSED' },
      }),
      this.prisma.validationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: ValidationAttemptStatus.PASSED,
          commitSha,
          validatedDiffHash,
          ...counts,
          completedAt: new Date(),
        },
      }),
      this.prisma.taskExecution.update({
        where: { id: execution.id },
        data: { commitSha },
      }),
    ]);

    this.logger.log(
      `Task validation PASSED (validationAttemptId=${attempt.id}, taskId=${task.id}, commitSha=${commitSha ?? 'none'})`,
    );
    return toAttemptRecord(updatedAttempt, runs);
  }

  private async finalizeFailedValidation(
    attempt: ValidationAttempt,
    startedAt: Date,
    counts: {
      requiredPassed: number;
      requiredFailed: number;
      optionalPassed: number;
      optionalFailed: number;
    },
    error: { code: TaskValidationErrorCode; message: string },
    runs: Awaited<ReturnType<typeof this.prisma.validationRun.findMany>>,
    validatedDiffHash?: string,
    commitSha?: string,
  ): Promise<ValidationAttemptRecord> {
    const isCancellation =
      error.code === TaskValidationErrorCode.CANCELLED_BEFORE_START ||
      error.code === TaskValidationErrorCode.VALIDATION_CANCELLED;

    // A commit-succeeded-but-not-clean outcome must still fail the Task
    // (item 44) — Task status only ever changes here when it is safe to
    // leave it FAILED; a cancellation before any staging leaves Task
    // untouched (still REVIEWING, per item 51's guidance to prefer that).
    if (!isCancellation) {
      await this.prisma.task.updateMany({
        where: { id: attempt.taskId, status: 'REVIEWING' },
        data: { status: 'FAILED' },
      });
    }

    const updated = await this.prisma.validationAttempt.update({
      where: { id: attempt.id },
      data: {
        status: isCancellation
          ? ValidationAttemptStatus.CANCELLED
          : ValidationAttemptStatus.FAILED,
        errorCode: error.code,
        errorMessage: error.message,
        commitSha: commitSha ?? null,
        validatedDiffHash: validatedDiffHash ?? null,
        ...counts,
        completedAt: new Date(),
      },
    });

    this.logger.warn(
      `Task validation ${updated.status.toLowerCase()} (validationAttemptId=${attempt.id}, taskId=${attempt.taskId}, code=${error.code})`,
    );
    return toAttemptRecord(updated, runs);
  }

  // A previous worker attempt already committed successfully but crashed
  // before its own DB transaction finalized Task/ValidationAttempt state
  // (items 100-102) — finalize using the SHA already on TaskExecution
  // without ever staging/committing again.
  private async finalizePreviouslyCommitted(
    attempt: ValidationAttempt,
    execution: TaskExecution,
  ): Promise<ValidationAttemptRecord> {
    const [, updatedAttempt] = await this.prisma.$transaction([
      this.prisma.task.updateMany({
        where: { id: attempt.taskId, status: 'REVIEWING' },
        data: { status: 'PASSED' },
      }),
      this.prisma.validationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: ValidationAttemptStatus.PASSED,
          commitSha: execution.commitSha,
          completedAt: new Date(),
        },
      }),
    ]);
    this.logger.warn(
      `Finalized an already-committed Task execution without re-running validation (validationAttemptId=${attempt.id}, commitSha=${execution.commitSha})`,
    );
    const runs = await this.prisma.validationRun.findMany({
      where: { validationAttemptId: attempt.id },
    });
    return toAttemptRecord(updatedAttempt, runs);
  }

  private normalizeError(error: unknown): {
    code: TaskValidationErrorCode;
    message: string;
  } {
    if (error instanceof TaskValidationError) {
      return { code: error.code, message: error.message };
    }
    if (error instanceof ApprovalError) {
      return {
        code: TaskValidationErrorCode.DEVELOPMENT_NOT_APPROVED,
        message: 'Development approval is no longer valid for this project.',
      };
    }
    if (error instanceof GitError) {
      return {
        code: TaskValidationErrorCode.WORKSPACE_NOT_READY,
        message: error.message,
      };
    }
    if (error instanceof HttpException) {
      const body = error.getResponse();
      const message =
        typeof body === 'object' && body !== null && 'message' in body
          ? String((body as { message: unknown }).message)
          : error.message;
      return { code: TaskValidationErrorCode.UNKNOWN_ERROR, message };
    }
    return {
      code: TaskValidationErrorCode.UNKNOWN_ERROR,
      message: 'An unexpected error occurred during validation.',
    };
  }

  // ---- reads -----------------------------------------------------------

  async listValidations(
    userId: string,
    projectId: string,
    taskId: string,
  ): Promise<ValidationAttemptRecord[]> {
    await this.projectsService.findOneForUser(userId, projectId);
    await this.assertTaskBelongsToProject(taskId, projectId);
    const attempts = await this.prisma.validationAttempt.findMany({
      where: { taskId },
      orderBy: { attempt: 'desc' },
      include: { runs: true },
    });
    return attempts.map((a) => toAttemptRecord(a, a.runs));
  }

  async getValidation(
    userId: string,
    projectId: string,
    validationAttemptId: string,
  ): Promise<ValidationAttemptRecord> {
    await this.projectsService.findOneForUser(userId, projectId);
    const attempt = await this.prisma.validationAttempt.findFirst({
      where: { id: validationAttemptId, projectId },
      include: { runs: true },
    });
    if (!attempt) {
      throw mapTaskValidationErrorToHttpException(
        new TaskValidationError({
          code: TaskValidationErrorCode.VALIDATION_NOT_FOUND,
          message: 'Validation attempt not found.',
        }),
      );
    }
    return toAttemptRecord(attempt, attempt.runs);
  }

  // ---- internals ---------------------------------------------------------

  private async assertTaskBelongsToProject(
    taskId: string,
    projectId: string,
  ): Promise<void> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, sprintPlan: { projectId } },
      select: { id: true },
    });
    if (!task) {
      throw mapTaskValidationErrorToHttpException(
        new TaskValidationError({
          code: TaskValidationErrorCode.TASK_NOT_FOUND,
          message: 'Task not found.',
        }),
      );
    }
  }

  private buildCommitMessage(task: { key: string; title: string }): string {
    const subject = `task(${task.key}): ${task.title}`;
    return subject.length > 200 ? `${subject.slice(0, 197)}...` : subject;
  }

  private orderChecks(checks: ValidationCheck[]): ValidationCheck[] {
    return [...checks].sort((a, b) => sortIndex(a.type) - sortIndex(b.type));
  }

  // Unlike Sprint 12's identically-named check, validation deliberately
  // does NOT require a clean workspace — Claude just changed files, and
  // that dirty state is exactly what gets validated (item 9).
  private async assertWorkspaceReadyAndOnBranch(
    projectId: string,
  ): Promise<string> {
    const workspacePath =
      await this.workspaceService.getReadyWorkspacePath(projectId);

    const workspace = await this.prisma.projectWorkspace.findUnique({
      where: { projectId },
    });
    const currentBranch = await this.git.getCurrentBranch(workspacePath);
    if (
      workspace?.developmentBranch &&
      currentBranch !== workspace.developmentBranch
    ) {
      throw new TaskValidationError({
        code: TaskValidationErrorCode.WRONG_BRANCH,
        message: `Workspace is on branch "${currentBranch ?? 'unknown'}", expected "${workspace.developmentBranch}".`,
      });
    }

    return workspacePath;
  }

  // Self-heals a ValidationAttempt left stuck QUEUED/RUNNING because its
  // background Job ended without this service's own execute() ever
  // finishing (worker crash/restart, or the Job being cancelled while
  // still QUEUED so the handler never ran at all) — mirrors Sprint 12's
  // reconcileOrphanedExecution. Also handles the more dangerous case
  // (items 100-102): the commit may have actually succeeded before the
  // crash — detected by checking whether the workspace's current HEAD
  // commit message matches this Task's expected commit message — in which
  // case this finalizes that real commit rather than leaving it unrecorded
  // (which would otherwise let a future validation attempt commit a
  // duplicate).
  private async reconcileOrphanedValidation(taskId: string): Promise<void> {
    const active = await this.prisma.validationAttempt.findFirst({
      where: { taskId, status: { in: ACTIVE_ATTEMPT_STATUSES } },
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

    const execution = await this.prisma.taskExecution.findUnique({
      where: { id: active.taskExecutionId },
    });
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });

    if (execution && task && !execution.commitSha) {
      try {
        const workspacePath = await this.workspaceService.getReadyWorkspacePath(
          active.projectId,
        );
        const recent = await this.git.getRecentCommits(workspacePath, 1);
        const expectedMessage = this.buildCommitMessage(task);
        if (recent.length > 0 && recent[0].message === expectedMessage) {
          await this.prisma.$transaction([
            this.prisma.taskExecution.update({
              where: { id: execution.id },
              data: { commitSha: recent[0].sha },
            }),
            this.prisma.validationAttempt.update({
              where: { id: active.id },
              data: {
                status: ValidationAttemptStatus.PASSED,
                commitSha: recent[0].sha,
                completedAt: new Date(),
              },
            }),
            this.prisma.task.updateMany({
              where: { id: taskId, status: 'REVIEWING' },
              data: { status: 'PASSED' },
            }),
          ]);
          this.logger.warn(
            `Reconciled a committed-but-unfinalized validation (validationAttemptId=${active.id}, commitSha=${recent[0].sha})`,
          );
          return;
        }
      } catch {
        // Workspace unavailable or Git read failed — fall through to the
        // generic orphan cleanup below rather than blocking eligibility
        // checks indefinitely.
      }
    }

    await this.prisma.validationAttempt.updateMany({
      where: { id: active.id, status: { in: ACTIVE_ATTEMPT_STATUSES } },
      data: {
        status: ValidationAttemptStatus.FAILED,
        errorCode: TaskValidationErrorCode.ORPHANED_VALIDATION,
        errorMessage:
          'The background job ended without this validation reporting a result (likely a worker restart).',
        completedAt: new Date(),
      },
    });
    this.logger.warn(
      `Reconciled an orphaned validation attempt (validationAttemptId=${active.id})`,
    );
  }
}
