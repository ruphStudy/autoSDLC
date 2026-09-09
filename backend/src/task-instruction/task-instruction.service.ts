import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, TaskInstruction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ApprovalService } from '../approval/approval.service';
import { ApprovalError } from '../approval/errors/approval.error';
import { mapApprovalErrorToHttpException } from '../approval/errors/approval-error.mapper';
import { WorkspaceService } from '../workspace/workspace.service';
import { GitService } from '../workspace/git/git.service';
import { GitError } from '../workspace/errors/git.error';
import { mapGitErrorToHttpException } from '../workspace/errors/workspace-error.mapper';
import {
  PLANNING_AI_PROVIDER,
  PlanningOperation,
} from '../ai/planning/planning-ai.constants';
import { PlanningAIProvider } from '../ai/planning/contracts/planning-provider.interface';
import { PlanningAIError } from '../ai/planning/errors/planning-ai.error';
import { TaskContextBuilder } from './context/task-context-builder.service';
import { TaskInstructionPrompt } from './prompts/task-instruction.prompt';
import { TaskInstructionContentSchema } from './schemas/task-instruction-content.schema';
import { validateInstructionContent } from './validation/instruction-validator';
import { TaskInstructionConfigService } from './task-instruction.config';
import {
  TaskInstructionError,
  TaskInstructionErrorCode,
} from './errors/task-instruction.error';
import { mapTaskInstructionErrorToHttpException } from './errors/task-instruction-error.mapper';
import { mapTaskInstructionPlanningErrorToHttpException } from './errors/planning-error.mapper';
import {
  ContextSnapshot,
  TaskInstructionRecord,
} from './types/task-instruction.types';

const SCHEMA_NAME = 'task_instruction';

function toRecord(
  instruction: TaskInstruction,
  currentHeadSha: string | null,
): TaskInstructionRecord {
  return {
    id: instruction.id,
    projectId: instruction.projectId,
    taskId: instruction.taskId,
    version: instruction.version,
    sprintPlanId: instruction.sprintPlanId,
    architectureId: instruction.architectureId,
    projectAnalysisId: instruction.projectAnalysisId,
    objective: instruction.objective,
    repositoryObservations: instruction.repositoryObservations as string[],
    implementationPlan: instruction.implementationPlan as unknown[],
    constraints: instruction.constraints as string[],
    acceptanceCriteria: instruction.acceptanceCriteria as string[],
    validationPlan: instruction.validationPlan as unknown[],
    dependencyContext: instruction.dependencyContext as unknown[],
    risksOrWatchouts: instruction.risksOrWatchouts as string[],
    finalInstruction: instruction.finalInstruction,
    contextSnapshot: instruction.contextSnapshot,
    repositoryHeadSha: instruction.repositoryHeadSha,
    repositoryBranch: instruction.repositoryBranch,
    promptName: instruction.promptName,
    promptVersion: instruction.promptVersion,
    provider: instruction.provider,
    model: instruction.model,
    inputTokens: instruction.inputTokens,
    outputTokens: instruction.outputTokens,
    totalTokens: instruction.totalTokens,
    latencyMs: instruction.latencyMs,
    attempts: instruction.attempts,
    providerRequestId: instruction.providerRequestId,
    createdAt: instruction.createdAt,
    stale: isInstructionCurrent(instruction, currentHeadSha) === false,
  };
}

// Exported standalone (not just a private method) so Sprint 12 — and this
// module's own read paths — never need to reimplement staleness detection
// (item 55/108): an instruction is valid only for the exact repository
// state it was generated against.
export function isInstructionCurrent(
  instruction: { repositoryHeadSha: string },
  currentHeadSha: string | null,
): boolean {
  return (
    currentHeadSha !== null && instruction.repositoryHeadSha === currentHeadSha
  );
}

@Injectable()
export class TaskInstructionService {
  private readonly logger = new Logger(TaskInstructionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectsService: ProjectsService,
    private readonly approvalService: ApprovalService,
    private readonly workspaceService: WorkspaceService,
    private readonly git: GitService,
    private readonly contextBuilder: TaskContextBuilder,
    private readonly config: TaskInstructionConfigService,
    @Inject(PLANNING_AI_PROVIDER)
    private readonly planningAIProvider: PlanningAIProvider,
  ) {}

  // ---- generation (also serves as "regenerate" — always a fresh version) --

  async generate(
    userId: string,
    projectId: string,
    taskId: string,
  ): Promise<TaskInstructionRecord> {
    const project = await this.projectsService.findOneForUser(
      userId,
      projectId,
    );
    if (project.archivedAt) {
      throw new ConflictException(
        'Cannot generate a Task instruction for an archived project. Restore the project first.',
      );
    }

    const task = await this.prisma.task.findFirst({
      where: { id: taskId, sprintPlan: { projectId } },
    });
    if (!task) {
      throw mapTaskInstructionErrorToHttpException(
        new TaskInstructionError({
          code: TaskInstructionErrorCode.TASK_NOT_FOUND,
          message: 'Task not found.',
        }),
      );
    }

    try {
      await this.assertTaskInCurrentPlan(task.sprintPlanId, projectId);
    } catch (error) {
      if (error instanceof TaskInstructionError) {
        throw mapTaskInstructionErrorToHttpException(error);
      }
      throw error;
    }

    try {
      await this.approvalService.assertDevelopmentApproved(project.id);
    } catch (error) {
      if (error instanceof ApprovalError) {
        throw mapApprovalErrorToHttpException(error);
      }
      throw error;
    }

    let workspacePath: string;
    try {
      workspacePath = await this.assertWorkspaceReadyAndClean(project.id);
    } catch (error) {
      if (error instanceof GitError) throw mapGitErrorToHttpException(error);
      if (error instanceof TaskInstructionError) {
        throw mapTaskInstructionErrorToHttpException(error);
      }
      throw error;
    }

    this.logger.log(
      `Task instruction generation started (projectId=${project.id}, taskId=${task.id}, taskKey=${task.key})`,
    );

    try {
      const record = await this.runGeneration(
        project.id,
        task.id,
        workspacePath,
      );
      this.logger.log(
        `Task instruction generated (projectId=${project.id}, taskId=${task.id}, taskKey=${task.key}, version=${record.version}, headSha=${record.repositoryHeadSha})`,
      );
      return record;
    } catch (error) {
      if (error instanceof PlanningAIError) {
        this.logger.warn(
          `Task instruction generation failed (projectId=${project.id}, taskId=${task.id}, code=${error.code})`,
        );
        throw mapTaskInstructionPlanningErrorToHttpException(error);
      }
      if (error instanceof TaskInstructionError) {
        this.logger.warn(
          `Task instruction generation failed (projectId=${project.id}, taskId=${task.id}, code=${error.code})`,
        );
        throw mapTaskInstructionErrorToHttpException(error);
      }
      throw error;
    }
  }

  private async runGeneration(
    projectId: string,
    taskId: string,
    workspacePath: string,
  ): Promise<TaskInstructionRecord> {
    const initialHeadSha = await this.git.getHeadCommitSha(workspacePath);
    const context = await this.contextBuilder.build(taskId, workspacePath);

    const prompt = TaskInstructionPrompt.build(context);
    const startedAt = Date.now();
    const result = await this.planningAIProvider.generateStructuredOutput({
      operation: PlanningOperation.TASK_INSTRUCTION,
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      schema: TaskInstructionContentSchema,
      schemaName: SCHEMA_NAME,
      metadata: { projectId, taskId },
    });

    const failures = validateInstructionContent(
      result.data,
      {
        acceptanceCriteria: context.task.acceptanceCriteria,
        validationExpectations: context.task.validationExpectations,
        requirementIds: context.task.requirementIds,
      },
      context,
      workspacePath,
    );
    if (failures.length > 0) {
      throw new TaskInstructionError({
        code: TaskInstructionErrorCode.INVALID_INSTRUCTION_RESPONSE,
        message: `Generated instruction failed validation: ${failures.map((f) => f.reason).join('; ')}`,
      });
    }
    if (result.data.finalInstruction.length > this.config.maxInstructionChars) {
      throw new TaskInstructionError({
        code: TaskInstructionErrorCode.INVALID_INSTRUCTION_RESPONSE,
        message: `Generated instruction exceeds the ${this.config.maxInstructionChars}-character limit.`,
      });
    }

    // Re-check HEAD immediately before persisting (item 70) — the AI call
    // above may have taken tens of seconds, during which nothing prevents
    // the repository from changing (e.g. a concurrent generation for a
    // different Task, or, later, Sprint 12 executing something). A stale
    // instruction must never be silently persisted as current.
    const currentHeadSha = await this.git.getHeadCommitSha(workspacePath);
    if (currentHeadSha !== initialHeadSha) {
      throw new TaskInstructionError({
        code: TaskInstructionErrorCode.REPOSITORY_STATE_CHANGED,
        message:
          'The repository changed while the instruction was being generated. Please retry generation.',
      });
    }

    const contextSnapshot: ContextSnapshot = {
      projectAnalysisVersion: context.projectAnalysis.version,
      architectureVersion: context.architecture.version,
      sprintPlanVersion: context.sprintPlan.version,
      sprintNumber: context.sprint.number,
      taskKey: context.task.key,
      dependencyTaskKeys: context.dependencies.map((d) => d.taskKey),
      repositoryHeadSha: currentHeadSha ?? 'none',
      repositoryBranch: context.repository.branch,
      relevantFiles: context.repository.manifests.map((m) => m.path),
      repositoryTreeEntryCount: context.repository.tree.entries.length,
      repositoryTreeTruncated: context.repository.tree.truncated,
      manifestsSkipped: context.repository.manifestsSkipped,
    };

    const latencyMs = Date.now() - startedAt;

    let created: TaskInstruction;
    try {
      created = await this.persistNewVersion({
        projectId,
        taskId,
        sprintPlanId: context.sprintPlan.id,
        architectureId: context.architecture.id,
        projectAnalysisId: context.projectAnalysis.id,
        content: result.data,
        contextSnapshot,
        repositoryHeadSha: currentHeadSha ?? 'none',
        repositoryBranch: context.repository.branch,
        aiMetadata: {
          promptName: TaskInstructionPrompt.name,
          promptVersion: TaskInstructionPrompt.version,
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
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new TaskInstructionError({
          code: TaskInstructionErrorCode.GENERATION_IN_PROGRESS,
          message:
            'Another instruction generation for this Task completed at the same time. Please retry.',
        });
      }
      throw error;
    }

    return toRecord(created, currentHeadSha);
  }

  private async persistNewVersion(data: {
    projectId: string;
    taskId: string;
    sprintPlanId: string;
    architectureId: string;
    projectAnalysisId: string;
    content: {
      objective: string;
      repositoryObservations: string[];
      implementationPlan: unknown[];
      constraints: string[];
      acceptanceCriteria: string[];
      validationPlan: unknown[];
      dependencyContext: unknown[];
      risksOrWatchouts: string[];
      finalInstruction: string;
    };
    contextSnapshot: ContextSnapshot;
    repositoryHeadSha: string;
    repositoryBranch: string | null;
    aiMetadata: {
      promptName: string;
      promptVersion: string;
      provider: string;
      model: string;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      latencyMs: number;
      attempts: number;
      providerRequestId?: string;
    };
  }): Promise<TaskInstruction> {
    return this.prisma.$transaction(async (tx) => {
      const aggregate = await tx.taskInstruction.aggregate({
        where: { taskId: data.taskId },
        _max: { version: true },
      });
      const nextVersion = (aggregate._max.version ?? 0) + 1;

      return tx.taskInstruction.create({
        data: {
          projectId: data.projectId,
          taskId: data.taskId,
          version: nextVersion,
          sprintPlanId: data.sprintPlanId,
          architectureId: data.architectureId,
          projectAnalysisId: data.projectAnalysisId,
          objective: data.content.objective,
          repositoryObservations: data.content
            .repositoryObservations as Prisma.InputJsonValue,
          implementationPlan: data.content
            .implementationPlan as Prisma.InputJsonValue,
          constraints: data.content.constraints as Prisma.InputJsonValue,
          acceptanceCriteria: data.content
            .acceptanceCriteria as Prisma.InputJsonValue,
          validationPlan: data.content.validationPlan as Prisma.InputJsonValue,
          dependencyContext: data.content
            .dependencyContext as Prisma.InputJsonValue,
          risksOrWatchouts: data.content
            .risksOrWatchouts as Prisma.InputJsonValue,
          finalInstruction: data.content.finalInstruction,
          contextSnapshot:
            data.contextSnapshot as unknown as Prisma.InputJsonValue,
          repositoryHeadSha: data.repositoryHeadSha,
          repositoryBranch: data.repositoryBranch,
          promptName: data.aiMetadata.promptName,
          promptVersion: data.aiMetadata.promptVersion,
          provider: data.aiMetadata.provider,
          model: data.aiMetadata.model,
          inputTokens: data.aiMetadata.inputTokens,
          outputTokens: data.aiMetadata.outputTokens,
          totalTokens: data.aiMetadata.totalTokens,
          latencyMs: data.aiMetadata.latencyMs,
          attempts: data.aiMetadata.attempts,
          providerRequestId: data.aiMetadata.providerRequestId,
        },
      });
    });
  }

  // ---- reads -------------------------------------------------------------

  async getCurrent(
    userId: string,
    projectId: string,
    taskId: string,
  ): Promise<TaskInstructionRecord> {
    await this.projectsService.findOneForUser(userId, projectId);
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, sprintPlan: { projectId } },
      select: { id: true },
    });
    if (!task) {
      throw mapTaskInstructionErrorToHttpException(
        new TaskInstructionError({
          code: TaskInstructionErrorCode.TASK_NOT_FOUND,
          message: 'Task not found.',
        }),
      );
    }
    const instruction = await this.prisma.taskInstruction.findFirst({
      where: { taskId },
      orderBy: { version: 'desc' },
    });
    if (!instruction) {
      throw mapTaskInstructionErrorToHttpException(
        new TaskInstructionError({
          code: TaskInstructionErrorCode.TASK_NOT_FOUND,
          message: 'No instruction has been generated for this Task yet.',
        }),
      );
    }
    const currentHeadSha = await this.tryGetLiveHeadSha(projectId);
    return toRecord(instruction, currentHeadSha);
  }

  async getHistory(
    userId: string,
    projectId: string,
    taskId: string,
  ): Promise<TaskInstructionRecord[]> {
    await this.projectsService.findOneForUser(userId, projectId);
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, sprintPlan: { projectId } },
      select: { id: true },
    });
    if (!task) {
      throw mapTaskInstructionErrorToHttpException(
        new TaskInstructionError({
          code: TaskInstructionErrorCode.TASK_NOT_FOUND,
          message: 'Task not found.',
        }),
      );
    }
    const instructions = await this.prisma.taskInstruction.findMany({
      where: { taskId },
      orderBy: { version: 'desc' },
    });
    const currentHeadSha = await this.tryGetLiveHeadSha(projectId);
    return instructions.map((instruction) =>
      toRecord(instruction, currentHeadSha),
    );
  }

  async getVersion(
    userId: string,
    projectId: string,
    taskId: string,
    version: number,
  ): Promise<TaskInstructionRecord> {
    await this.projectsService.findOneForUser(userId, projectId);
    const instruction = await this.prisma.taskInstruction.findFirst({
      where: { taskId, version, task: { sprintPlan: { projectId } } },
    });
    if (!instruction) {
      throw mapTaskInstructionErrorToHttpException(
        new TaskInstructionError({
          code: TaskInstructionErrorCode.TASK_NOT_FOUND,
          message: 'Instruction version not found.',
        }),
      );
    }
    const currentHeadSha = await this.tryGetLiveHeadSha(projectId);
    return toRecord(instruction, currentHeadSha);
  }

  // ---- Sprint 12 integration point ---------------------------------------

  // The one call Sprint 12's Task orchestrator needs — never reimplements
  // stale detection (item 108): generates if nothing exists yet,
  // regenerates if the repository has moved on since the last version,
  // otherwise reuses the current instruction as-is. No ownership/userId
  // needed — this is for internal orchestration code that has already
  // resolved the project/task through its own trusted path.
  async getOrGenerateFreshInstruction(
    taskId: string,
  ): Promise<TaskInstructionRecord> {
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      select: { sprintPlan: { select: { projectId: true } } },
    });
    const projectId = task.sprintPlan.projectId;

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { userId: true },
    });

    const latest = await this.prisma.taskInstruction.findFirst({
      where: { taskId },
      orderBy: { version: 'desc' },
    });

    if (latest) {
      const currentHeadSha = await this.tryGetLiveHeadSha(projectId);
      if (isInstructionCurrent(latest, currentHeadSha)) {
        return toRecord(latest, currentHeadSha);
      }
    }

    return this.generate(project.userId, projectId, taskId);
  }

  // ---- internals -----------------------------------------------------

  private async assertTaskInCurrentPlan(
    taskSprintPlanId: string,
    projectId: string,
  ): Promise<void> {
    const currentPlan = await this.prisma.sprintPlan.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!currentPlan || currentPlan.id !== taskSprintPlanId) {
      throw new TaskInstructionError({
        code: TaskInstructionErrorCode.TASK_NOT_IN_CURRENT_PLAN,
        message:
          'This Task belongs to a Sprint Plan version that is no longer current. Instructions can only be generated for Tasks in the current plan.',
      });
    }
  }

  // Mirrors CodingAgentService's identically-named check — kept as its own
  // small local copy rather than a cross-module import, since task-instruction
  // and coding-agent are sibling modules with no dependency between them.
  private async assertWorkspaceReadyAndClean(
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
      throw new TaskInstructionError({
        code: TaskInstructionErrorCode.WORKSPACE_NOT_READY,
        message: `Workspace is on branch "${currentBranch ?? 'unknown'}", expected "${workspace.developmentBranch}".`,
      });
    }

    const status = await this.git.getStatus(workspacePath);
    if (!status.clean) {
      throw new TaskInstructionError({
        code: TaskInstructionErrorCode.WORKSPACE_DIRTY,
        message:
          'The workspace has uncommitted changes. Instruction generation requires a clean workspace so the captured HEAD SHA is unambiguous.',
      });
    }

    return workspacePath;
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
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
