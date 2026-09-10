import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  Project,
  ProjectStatus,
  SprintStatus,
  Task,
  TaskExecution,
  TaskExecutionStatus,
  TaskStatus,
  JobType,
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
import { TaskInstructionService } from '../task-instruction/task-instruction.service';
import { TaskInstructionError } from '../task-instruction/errors/task-instruction.error';
import { PlanningAIError } from '../ai/planning/errors/planning-ai.error';
import { CodingAgentService } from '../coding-agent/coding-agent.service';
import { CodingAgentError } from '../coding-agent/errors/coding-agent.error';
import { AgentJobRecord } from '../coding-agent/types/agent-job.types';
import { TaskExecutionConfigService } from './task-execution.config';
import {
  TaskExecutionError,
  TaskExecutionErrorCode,
} from './errors/task-execution.error';
import { mapTaskExecutionErrorToHttpException } from './errors/task-execution-error.mapper';
import {
  RunTaskResult,
  TaskEligibilityResult,
  TaskExecutionRecord,
} from './types/task-execution.types';

const ACTIVE_EXECUTION_STATUSES: TaskExecutionStatus[] = [
  TaskExecutionStatus.QUEUED,
  TaskExecutionStatus.RUNNING,
  TaskExecutionStatus.AGENT_COMPLETED,
];

function toRecord(execution: TaskExecution): TaskExecutionRecord {
  return {
    id: execution.id,
    projectId: execution.projectId,
    taskId: execution.taskId,
    attempt: execution.attempt,
    status: execution.status,
    taskInstructionId: execution.taskInstructionId,
    agentJobId: execution.agentJobId,
    repositoryStartSha: execution.repositoryStartSha,
    repositoryEndSha: execution.repositoryEndSha,
    changedFiles:
      (execution.changedFiles as unknown as TaskExecutionRecord['changedFiles']) ??
      [],
    gitDiff: execution.gitDiff,
    gitDiffTruncated: execution.gitDiffTruncated,
    errorCode: execution.errorCode,
    errorMessage: execution.errorMessage,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    durationMs: execution.durationMs,
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt,
  };
}

type TaskWithDependencies = Task & {
  sprint: { id: string; status: SprintStatus };
  dependencies: { dependsOnTask: { status: TaskStatus } }[];
};

// Orchestrates exactly one Task's execution end to end: eligibility ->
// atomic lock -> fresh instruction -> coding agent invocation -> Git result
// capture -> Task state transition. Never loops across a Sprint (Sprint
// 14) and never runs deterministic validation (Sprint 13) — a successful
// coding-agent run only ever reaches Task REVIEWING, never PASSED.
@Injectable()
export class TaskExecutionService {
  private readonly logger = new Logger(TaskExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly approvalService: ApprovalService,
    private readonly workspaceService: WorkspaceService,
    private readonly git: GitService,
    private readonly jobService: JobService,
    private readonly taskInstructionService: TaskInstructionService,
    private readonly codingAgentService: CodingAgentService,
    private readonly config: TaskExecutionConfigService,
  ) {}

  // ---- eligibility ---------------------------------------------------

  async getEligibility(
    userId: string,
    projectId: string,
    taskId: string,
  ): Promise<TaskEligibilityResult> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    return this.evaluateEligibility(project, taskId);
  }

  private async evaluateEligibility(
    project: Project,
    taskId: string,
  ): Promise<TaskEligibilityResult> {
    // Must run before loading the Task below — otherwise a Task left
    // RUNNING by an orphaned execution would be read (and reported as
    // TASK_RUNNING) before this call has a chance to roll it back.
    await this.reconcileOrphanedExecution(taskId);

    const task = await this.loadTaskWithDependencies(taskId, project.id);
    const reasons: TaskExecutionErrorCode[] = [];

    if (project.archivedAt) {
      reasons.push(TaskExecutionErrorCode.PROJECT_ARCHIVED);
    }

    if (project.status === ProjectStatus.COMPLETED) {
      reasons.push(TaskExecutionErrorCode.PROJECT_COMPLETED);
    }

    const currentPlan = await this.prisma.sprintPlan.findFirst({
      where: { projectId: project.id },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!currentPlan || currentPlan.id !== task.sprintPlanId) {
      reasons.push(TaskExecutionErrorCode.TASK_NOT_IN_CURRENT_PLAN);
    }

    try {
      await this.approvalService.assertDevelopmentApproved(project.id);
    } catch (error) {
      if (error instanceof ApprovalError) {
        reasons.push(TaskExecutionErrorCode.DEVELOPMENT_NOT_APPROVED);
      } else {
        throw error;
      }
    }

    switch (task.status) {
      case TaskStatus.PASSED:
        reasons.push(TaskExecutionErrorCode.TASK_ALREADY_PASSED);
        break;
      case TaskStatus.RUNNING:
        reasons.push(TaskExecutionErrorCode.TASK_RUNNING);
        break;
      case TaskStatus.REVIEWING:
        reasons.push(TaskExecutionErrorCode.TASK_REVIEWING);
        break;
      case TaskStatus.FAILED:
        reasons.push(TaskExecutionErrorCode.TASK_FAILED_PREVIOUSLY);
        break;
      case TaskStatus.BLOCKED:
        reasons.push(TaskExecutionErrorCode.TASK_BLOCKED);
        break;
      case TaskStatus.PENDING:
      case TaskStatus.READY:
        break;
    }

    if (task.sprint.status === SprintStatus.BLOCKED) {
      reasons.push(TaskExecutionErrorCode.SPRINT_BLOCKED);
    }

    const hasUnmetDependency = task.dependencies.some(
      (d) => d.dependsOnTask.status !== TaskStatus.PASSED,
    );
    if (hasUnmetDependency) {
      reasons.push(TaskExecutionErrorCode.DEPENDENCY_NOT_PASSED);
    }

    const active = await this.prisma.taskExecution.findFirst({
      where: { taskId, status: { in: ACTIVE_EXECUTION_STATUSES } },
    });
    if (active) {
      reasons.push(TaskExecutionErrorCode.ACTIVE_EXECUTION);
    }

    try {
      await this.assertWorkspaceReadyCleanAndOnBranch(project.id);
    } catch (error) {
      if (error instanceof TaskExecutionError) {
        reasons.push(error.code);
      } else {
        reasons.push(TaskExecutionErrorCode.WORKSPACE_NOT_READY);
      }
    }

    return {
      runnable: reasons.length === 0,
      reasons,
      task: { id: task.id, status: task.status },
    };
  }

  // ---- run (HTTP-facing entry point) ---------------------------------

  // Accepts only {projectId, taskId} — never an instruction, workspace
  // path, provider, model, or agent constraint from the client (item 40).
  async run(
    userId: string,
    projectId: string,
    taskId: string,
  ): Promise<RunTaskResult> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    const execution = await this.claimTaskExecution(project, taskId);

    try {
      const job = await this.jobService.enqueue({
        type: JobType.TASK_EXECUTION,
        projectId: project.id,
        userId,
        // IDs only — never the instruction text, source code, or
        // workspace path (item 87).
        payload: {
          taskExecutionId: execution.id,
          taskId,
          projectId: project.id,
        },
        maxAttempts: 1,
      });
      const updated = await this.prisma.taskExecution.update({
        where: { id: execution.id },
        data: { backgroundJobId: job.id },
      });
      this.logger.log(
        `Task execution enqueued (taskExecutionId=${execution.id}, taskId=${taskId}, attempt=${execution.attempt})`,
      );
      const refreshedTask = await this.prisma.task.findUniqueOrThrow({
        where: { id: taskId },
        select: { id: true, status: true },
      });
      return { taskExecution: toRecord(updated), job, task: refreshedTask };
    } catch (error) {
      // Never strand a TaskExecution/Task in RUNNING if enqueueing itself
      // failed — no execution has actually started yet.
      await this.prisma.$transaction([
        this.prisma.taskExecution.update({
          where: { id: execution.id },
          data: {
            status: TaskExecutionStatus.FAILED,
            errorCode: TaskExecutionErrorCode.ENQUEUE_FAILED,
            errorMessage: 'Failed to enqueue the background execution job.',
            completedAt: new Date(),
          },
        }),
        this.prisma.task.updateMany({
          where: { id: taskId, status: TaskStatus.RUNNING },
          data: { status: execution.priorTaskStatus ?? TaskStatus.READY },
        }),
      ]);
      throw error;
    }
  }

  // Sprint 14 integration point: same eligibility + atomic-lock + Task/
  // Sprint/Project status transitions as run(), but never enqueues a
  // TASK_EXECUTION background Job — the caller (SprintExecutionService) is
  // expected to invoke execute() directly with its own JobExecutionContext,
  // exactly mirroring how execute() itself already reuses
  // CodingAgentService.execute() in-process rather than through a nested
  // queue. No ownership/userId check by design — trusted internal
  // orchestration code only (same reasoning as
  // TaskInstructionService.getOrGenerateFreshInstruction).
  async beginForOrchestrator(
    projectId: string,
    taskId: string,
  ): Promise<TaskExecutionRecord> {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    const execution = await this.claimTaskExecution(project, taskId);
    return toRecord(execution);
  }

  private async claimTaskExecution(
    project: Project,
    taskId: string,
  ): Promise<TaskExecution> {
    const eligibility = await this.evaluateEligibility(project, taskId);
    if (!eligibility.runnable) {
      throw mapTaskExecutionErrorToHttpException(
        new TaskExecutionError({
          code: eligibility.reasons[0],
          message: `This Task cannot be run right now: ${eligibility.reasons.join(', ')}.`,
        }),
      );
    }

    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Atomic claim: only one concurrent claim for this Task can ever
        // see count === 1 here.
        const claim = await tx.task.updateMany({
          where: {
            id: taskId,
            status: { in: [TaskStatus.PENDING, TaskStatus.READY] },
          },
          data: { status: TaskStatus.RUNNING },
        });
        if (claim.count === 0) {
          throw new TaskExecutionError({
            code: TaskExecutionErrorCode.ACTIVE_EXECUTION,
            message:
              'This Task is no longer in a runnable state — a concurrent request may have started it first.',
          });
        }

        const aggregate = await tx.taskExecution.aggregate({
          where: { taskId },
          _max: { attempt: true },
        });
        const attempt = (aggregate._max.attempt ?? 0) + 1;

        const created = await tx.taskExecution.create({
          data: {
            projectId: project.id,
            taskId,
            attempt,
            status: TaskExecutionStatus.QUEUED,
            priorTaskStatus: task.status,
          },
        });

        // First Task start -> Project DEVELOPING (only from the pre-
        // execution DEVELOPMENT_APPROVED status — never overrides a status
        // Sprint 13/14 has already moved beyond, and never repeats once
        // already DEVELOPING).
        await tx.project.updateMany({
          where: { id: project.id, status: ProjectStatus.DEVELOPMENT_APPROVED },
          data: { status: ProjectStatus.DEVELOPING },
        });

        // First Task start of this Sprint -> Sprint RUNNING. Sprint PASSED
        // is Sprint 14's job — never set here.
        await tx.sprint.updateMany({
          where: { id: task.sprintId, status: SprintStatus.PENDING },
          data: { status: SprintStatus.RUNNING },
        });

        return created;
      });
    } catch (error) {
      if (error instanceof TaskExecutionError) {
        throw mapTaskExecutionErrorToHttpException(error);
      }
      throw error;
    }
  }

  // ---- execute (background-worker-facing) -----------------------------

  // Called by TaskExecutionJobHandler with the TASK_EXECUTION job's own
  // JobExecutionContext. Never throws: every outcome (including a
  // pre-agent failure) is persisted and returned as a TaskExecutionRecord,
  // mirroring CodingAgentService.execute's "never silently retry" contract
  // — the outer background Job always completes from the queue's point of
  // view; the meaningful outcome lives on TaskExecution/Task, not on Job.
  async execute(
    taskExecutionId: string,
    context: JobExecutionContext,
  ): Promise<TaskExecutionRecord> {
    const execution = await this.prisma.taskExecution.findUniqueOrThrow({
      where: { id: taskExecutionId },
    });
    const startedAt = new Date();

    await this.prisma.taskExecution.update({
      where: { id: taskExecutionId },
      data: { status: TaskExecutionStatus.RUNNING, startedAt },
    });

    let agentJobRecord: AgentJobRecord;
    try {
      agentJobRecord = await this.runPreAgentPhase(execution, context);
    } catch (error) {
      // Per the CodingAgentProvider contract, executeTask only ever
      // rejects (and therefore CodingAgentService.execute only ever
      // throws) for outcomes where no session could ever start — nothing
      // in the workspace could possibly have been touched. Every error
      // caught here — whether from a pre-flight check or from a thrown
      // CodingAgentError — therefore means the coding agent never ran.
      return await this.handlePreAgentFailure(execution, startedAt, error);
    }

    // Deliberately outside the try/catch above: the coding agent has
    // definitely run by this point (agentJobRecord resolved), so a bug or
    // transient DB error while recording that outcome must never be
    // mistaken for a pre-agent failure and silently roll the Task back —
    // that would mislabel a real (possibly file-modifying) attempt as
    // "never started". Let it fail the background Job loudly instead.
    await context.reportProgress(85, 'Inspecting repository changes...');
    return this.finalizeExecution(execution, agentJobRecord, startedAt);
  }

  // Everything that must happen before the coding agent can be invoked —
  // any failure here is, by construction, a pre-agent failure. Split out
  // from execute() purely so that boundary is a hard function edge, not
  // just a comment.
  private async runPreAgentPhase(
    execution: TaskExecution,
    context: JobExecutionContext,
  ): Promise<AgentJobRecord> {
    const { id: taskExecutionId, projectId, taskId } = execution;

    if (await context.isCancellationRequested()) {
      throw new TaskExecutionError({
        code: TaskExecutionErrorCode.CANCELLED_BEFORE_START,
        message: 'Execution was cancelled before it started.',
      });
    }

    // Defense in depth: re-verify everything request-time already
    // checked, since a TASK_EXECUTION job can sit queued for a while.
    await this.approvalService.assertDevelopmentApproved(projectId);

    const task = await this.loadTaskWithDependencies(taskId, projectId);
    const hasUnmetDependency = task.dependencies.some(
      (d) => d.dependsOnTask.status !== TaskStatus.PASSED,
    );
    if (hasUnmetDependency) {
      throw new TaskExecutionError({
        code: TaskExecutionErrorCode.DEPENDENCY_NOT_PASSED,
        message: 'A dependency of this Task is no longer PASSED.',
      });
    }
    if (task.sprint.status === SprintStatus.BLOCKED) {
      throw new TaskExecutionError({
        code: TaskExecutionErrorCode.SPRINT_BLOCKED,
        message: "This Task's Sprint is now BLOCKED.",
      });
    }

    const workspacePath =
      await this.assertWorkspaceReadyCleanAndOnBranch(projectId);

    const repositoryStartSha = await this.git.getHeadCommitSha(workspacePath);
    await this.prisma.taskExecution.update({
      where: { id: taskExecutionId },
      data: { repositoryStartSha },
    });

    await context.reportProgress(10, 'Preparing execution instruction...');
    const instruction = await this.getFreshInstructionOrThrow(
      taskId,
      workspacePath,
    );
    await this.prisma.taskExecution.update({
      where: { id: taskExecutionId },
      data: { taskInstructionId: instruction.id },
    });

    await context.reportProgress(20, 'Running coding agent...');
    const agentJob = await this.prisma.agentJob.create({
      data: {
        projectId,
        taskId,
        provider: 'claude',
        status: 'QUEUED',
        instruction: instruction.finalInstruction,
        maxAttempts: 1,
      },
    });
    await this.prisma.taskExecution.update({
      where: { id: taskExecutionId },
      data: { agentJobId: agentJob.id },
    });

    return this.codingAgentService.execute(agentJob.id, context);
  }

  private async finalizeExecution(
    execution: TaskExecution,
    agentJobRecord: AgentJobRecord,
    startedAt: Date,
  ): Promise<TaskExecutionRecord> {
    let repositoryEndSha: string | null = null;
    let clean = true;
    let changedFiles: TaskExecutionRecord['changedFiles'] = [];
    let gitDiff: string | null = null;
    let gitDiffTruncated = false;

    try {
      const workspacePath = await this.workspaceService.getReadyWorkspacePath(
        execution.projectId,
      );
      repositoryEndSha = await this.git.getHeadCommitSha(workspacePath);
      const status = await this.git.getStatus(workspacePath);
      clean = status.clean;
      changedFiles = status.files.map((f) => ({
        path: f.path,
        changeType: f.status,
      }));
      if (!status.clean) {
        const diffResult = await this.git.getDiff(workspacePath);
        gitDiffTruncated =
          diffResult.truncated ||
          diffResult.diff.length > this.config.maxDiffChars;
        gitDiff = diffResult.diff.slice(0, this.config.maxDiffChars);
      }
    } catch (error) {
      // The workspace itself may have become unavailable between the
      // agent finishing and this inspection — never let that mask the
      // agent's own outcome; just record no repository evidence.
      this.logger.warn(
        `Could not inspect repository state after execution (taskExecutionId=${execution.id}): ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    let taskStatus: TaskStatus;
    let executionStatus: TaskExecutionStatus;
    if (agentJobRecord.status === 'SUCCEEDED') {
      taskStatus = TaskStatus.REVIEWING;
      executionStatus = TaskExecutionStatus.READY_FOR_VALIDATION;
    } else if (agentJobRecord.status === 'FAILED') {
      taskStatus = TaskStatus.FAILED;
      executionStatus = TaskExecutionStatus.FAILED;
    } else {
      // CANCELLED — always inspect Git status rather than assuming
      // untouched (item 47). Any file modification means the Task must
      // not silently look re-runnable; no modification means it can
      // safely return to its prior status.
      executionStatus = TaskExecutionStatus.CANCELLED;
      taskStatus = clean
        ? (execution.priorTaskStatus ?? TaskStatus.READY)
        : TaskStatus.FAILED;
    }

    await this.prisma.taskExecution.update({
      where: { id: execution.id },
      data: { status: TaskExecutionStatus.AGENT_COMPLETED },
    });

    const [, updated] = await this.prisma.$transaction([
      this.prisma.task.update({
        where: { id: execution.taskId },
        data: { status: taskStatus },
      }),
      this.prisma.taskExecution.update({
        where: { id: execution.id },
        data: {
          status: executionStatus,
          repositoryEndSha,
          changedFiles: changedFiles as unknown as Prisma.InputJsonValue,
          gitDiff,
          gitDiffTruncated,
          errorCode: agentJobRecord.errorCode ?? null,
          errorMessage: agentJobRecord.errorMessage ?? null,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
        },
      }),
    ]);

    this.logger.log(
      `Task execution ${executionStatus.toLowerCase()} (taskExecutionId=${execution.id}, taskId=${execution.taskId}, agentJobStatus=${agentJobRecord.status}, changedFiles=${changedFiles.length}, taskStatus=${taskStatus})`,
    );
    return toRecord(updated);
  }

  private async handlePreAgentFailure(
    execution: TaskExecution,
    startedAt: Date,
    error: unknown,
  ): Promise<TaskExecutionRecord> {
    const normalized = this.normalizeError(error);
    const isCancellation =
      normalized.code === TaskExecutionErrorCode.CANCELLED_BEFORE_START;

    await this.prisma.$transaction([
      this.prisma.taskExecution.update({
        where: { id: execution.id },
        data: {
          status: isCancellation
            ? TaskExecutionStatus.CANCELLED
            : TaskExecutionStatus.FAILED,
          errorCode: normalized.code,
          errorMessage: normalized.message,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
        },
      }),
      // Never leave the Task stuck RUNNING for a failure that happened
      // before the coding agent ever touched the workspace (item 46/76).
      this.prisma.task.updateMany({
        where: { id: execution.taskId, status: TaskStatus.RUNNING },
        data: { status: execution.priorTaskStatus ?? TaskStatus.READY },
      }),
    ]);

    this.logger.warn(
      `Task execution ended before the coding agent started (taskExecutionId=${execution.id}, code=${normalized.code})`,
      error instanceof Error ? error.stack : undefined,
    );

    const refreshed = await this.prisma.taskExecution.findUniqueOrThrow({
      where: { id: execution.id },
    });
    return toRecord(refreshed);
  }

  private normalizeError(error: unknown): {
    code: TaskExecutionErrorCode;
    message: string;
  } {
    if (error instanceof TaskExecutionError) {
      return { code: error.code, message: error.message };
    }
    if (error instanceof ApprovalError) {
      return {
        code: TaskExecutionErrorCode.DEVELOPMENT_NOT_APPROVED,
        message: 'Development approval is no longer valid for this project.',
      };
    }
    if (error instanceof GitError) {
      return {
        code: TaskExecutionErrorCode.WORKSPACE_NOT_READY,
        message: error.message,
      };
    }
    if (error instanceof TaskInstructionError) {
      return {
        code: TaskExecutionErrorCode.INSTRUCTION_GENERATION_FAILED,
        message: error.message,
      };
    }
    if (error instanceof PlanningAIError) {
      return {
        code: TaskExecutionErrorCode.INSTRUCTION_GENERATION_FAILED,
        message: 'Failed to generate a fresh Task instruction.',
      };
    }
    if (error instanceof CodingAgentError) {
      return {
        code: TaskExecutionErrorCode.PROVIDER_ERROR,
        message: error.message,
      };
    }
    // TaskInstructionService.generate() (reached indirectly via
    // getOrGenerateFreshInstruction when regeneration is needed) is itself
    // an HTTP-facing method and throws already-mapped HttpExceptions
    // (ConflictException/UnprocessableEntityException/etc.), not the raw
    // domain error — this is the only call in this flow that can produce
    // one, so treat it as an instruction-generation failure.
    if (error instanceof HttpException) {
      const body = error.getResponse();
      const message =
        typeof body === 'object' && body !== null && 'message' in body
          ? String((body as { message: unknown }).message)
          : error.message;
      return {
        code: TaskExecutionErrorCode.INSTRUCTION_GENERATION_FAILED,
        message,
      };
    }
    // Never leak a raw/unknown error's own message — it was never
    // constructed to be a safe, user-facing string.
    return {
      code: TaskExecutionErrorCode.UNKNOWN_ERROR,
      message: 'An unexpected error occurred before the coding agent started.',
    };
  }

  // ---- reads -----------------------------------------------------------

  async listExecutions(
    userId: string,
    projectId: string,
    taskId: string,
  ): Promise<TaskExecutionRecord[]> {
    await this.projectsService.findOneForUser(userId, projectId);
    await this.assertTaskBelongsToProject(taskId, projectId);
    const executions = await this.prisma.taskExecution.findMany({
      where: { taskId },
      orderBy: { attempt: 'desc' },
    });
    return executions.map(toRecord);
  }

  async getCurrentExecution(
    userId: string,
    projectId: string,
    taskId: string,
  ): Promise<TaskExecutionRecord> {
    await this.projectsService.findOneForUser(userId, projectId);
    await this.assertTaskBelongsToProject(taskId, projectId);
    const execution = await this.prisma.taskExecution.findFirst({
      where: { taskId },
      orderBy: { attempt: 'desc' },
    });
    if (!execution) {
      throw mapTaskExecutionErrorToHttpException(
        new TaskExecutionError({
          code: TaskExecutionErrorCode.EXECUTION_NOT_FOUND,
          message: 'This Task has never been run.',
        }),
      );
    }
    return toRecord(execution);
  }

  async getExecution(
    userId: string,
    projectId: string,
    executionId: string,
  ): Promise<TaskExecutionRecord> {
    await this.projectsService.findOneForUser(userId, projectId);
    const execution = await this.prisma.taskExecution.findFirst({
      where: { id: executionId, projectId },
    });
    if (!execution) {
      throw mapTaskExecutionErrorToHttpException(
        new TaskExecutionError({
          code: TaskExecutionErrorCode.EXECUTION_NOT_FOUND,
          message: 'Task execution not found.',
        }),
      );
    }
    return toRecord(execution);
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
      throw mapTaskExecutionErrorToHttpException(
        new TaskExecutionError({
          code: TaskExecutionErrorCode.TASK_NOT_FOUND,
          message: 'Task not found.',
        }),
      );
    }
  }

  private async loadTaskWithDependencies(
    taskId: string,
    projectId: string,
  ): Promise<TaskWithDependencies> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, sprintPlan: { projectId } },
      include: {
        sprint: { select: { id: true, status: true } },
        dependencies: {
          include: { dependsOnTask: { select: { status: true } } },
        },
      },
    });
    if (!task) {
      throw mapTaskExecutionErrorToHttpException(
        new TaskExecutionError({
          code: TaskExecutionErrorCode.TASK_NOT_FOUND,
          message: 'Task not found.',
        }),
      );
    }
    return task;
  }

  // Immediately before invoking the coding agent, re-verify the fetched
  // instruction still matches live HEAD (item 108) — regenerate once if it
  // drifted, then fail safely rather than ever executing a stale
  // instruction.
  private async getFreshInstructionOrThrow(
    taskId: string,
    workspacePath: string,
  ) {
    let instruction =
      await this.taskInstructionService.getOrGenerateFreshInstruction(taskId);
    let currentHeadSha = await this.git.getHeadCommitSha(workspacePath);

    if (instruction.repositoryHeadSha !== currentHeadSha) {
      instruction =
        await this.taskInstructionService.getOrGenerateFreshInstruction(taskId);
      currentHeadSha = await this.git.getHeadCommitSha(workspacePath);
      if (instruction.repositoryHeadSha !== currentHeadSha) {
        throw new TaskExecutionError({
          code: TaskExecutionErrorCode.REPOSITORY_STATE_CHANGED,
          message:
            'The repository kept changing while preparing the Task instruction. Please retry execution.',
        });
      }
    }

    return instruction;
  }

  // Mirrors CodingAgentService's/TaskInstructionService's identically-named
  // check — kept as its own small local copy rather than a cross-module
  // import, consistent with those sibling modules.
  private async assertWorkspaceReadyCleanAndOnBranch(
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
      throw new TaskExecutionError({
        code: TaskExecutionErrorCode.WRONG_BRANCH,
        message: `Workspace is on branch "${currentBranch ?? 'unknown'}", expected "${workspace.developmentBranch}".`,
      });
    }

    const status = await this.git.getStatus(workspacePath);
    if (!status.clean) {
      throw new TaskExecutionError({
        code: TaskExecutionErrorCode.WORKSPACE_DIRTY,
        message:
          'The workspace has uncommitted changes. Task execution requires a clean workspace so changes can be reliably attributed.',
      });
    }

    return workspacePath;
  }

  // Self-heals a Task left stuck RUNNING because its TaskExecution's
  // background Job ended (crashed, or was recovered by the job worker's
  // stale-lock cleanup) without TaskExecutionService.execute's own
  // catch/finally ever running to roll the Task status back. Without this,
  // such a Task could never be run again (item 129's "crashed Job leaving
  // Task forever RUNNING" self-review flag).
  private async reconcileOrphanedExecution(taskId: string): Promise<void> {
    const active = await this.prisma.taskExecution.findFirst({
      where: { taskId, status: { in: ACTIVE_EXECUTION_STATUSES } },
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

    await this.prisma.$transaction([
      this.prisma.taskExecution.updateMany({
        where: { id: active.id, status: { in: ACTIVE_EXECUTION_STATUSES } },
        data: {
          status: TaskExecutionStatus.FAILED,
          errorCode: TaskExecutionErrorCode.ORPHANED_EXECUTION,
          errorMessage:
            'The background job ended without this execution reporting a result (likely a worker restart).',
          completedAt: new Date(),
        },
      }),
      this.prisma.task.updateMany({
        where: { id: taskId, status: TaskStatus.RUNNING },
        data: { status: active.priorTaskStatus ?? TaskStatus.READY },
      }),
    ]);
    this.logger.warn(
      `Reconciled an orphaned Task execution (taskExecutionId=${active.id}, taskId=${taskId})`,
    );
  }
}
