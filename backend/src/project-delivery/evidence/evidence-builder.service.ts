import { Injectable } from '@nestjs/common';
import {
  SprintAcceptanceRecommendation,
  SprintAcceptanceStatus,
  TaskStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkspaceService } from '../../workspace/workspace.service';
import { GitService } from '../../workspace/git/git.service';
import {
  CommitDeliverySummary,
  ProjectDeliveryEvidence,
  RequirementDeliveryCoverageEntry,
  RequiredSprintEvidence,
  TaskDeliverySummary,
  UsageByCategory,
  UsageDeliverySummary,
  ValidationDeliverySummary,
} from '../types/evidence.types';

export interface DeliveryEvidenceBundle {
  evidence: ProjectDeliveryEvidence;
  liveHeadSha: string | null;
}

// Aggregates existing Sprint/SprintExecution/SprintAcceptance/Task/
// TaskExecution/ValidationAttempt/Architecture/ProjectAnalysis/AgentJob/Git
// state into one bounded, structured, project-wide object — the Project-
// level counterpart to SprintAcceptanceEvidenceBuilder. Never re-runs
// Sprint 13's validation checks, never re-generates a Sprint Acceptance
// review, and never mutates anything — purely a read aggregator over
// EVERY required Sprint (every Sprint in the current SprintPlan), not just
// one.
@Injectable()
export class ProjectDeliveryEvidenceBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceService: WorkspaceService,
    private readonly git: GitService,
  ) {}

  async build(
    projectId: string,
    sprintPlanId: string,
  ): Promise<DeliveryEvidenceBundle> {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
    });

    const sprintPlan = await this.prisma.sprintPlan.findUniqueOrThrow({
      where: { id: sprintPlanId },
    });

    const architecture = await this.prisma.architecture.findUniqueOrThrow({
      where: { id: sprintPlan.architectureId },
    });

    const projectAnalysis = await this.prisma.projectAnalysis.findUniqueOrThrow(
      { where: { id: architecture.projectAnalysisId } },
    );

    const sprints = await this.prisma.sprint.findMany({
      where: { sprintPlanId },
      orderBy: { order: 'asc' },
    });
    const sprintIds = sprints.map((s) => s.id);

    const latestExecutionBySprintId = await this.loadLatest(
      sprintIds,
      (ids) =>
        this.prisma.sprintExecution.findMany({
          where: { sprintId: { in: ids } },
          orderBy: { attempt: 'desc' },
        }),
      (row) => row.sprintId,
    );

    const latestAcceptanceBySprintId = await this.loadLatest(
      sprintIds,
      (ids) =>
        this.prisma.sprintAcceptance.findMany({
          where: { sprintId: { in: ids } },
          orderBy: { version: 'desc' },
        }),
      (row) => row.sprintId,
    );

    const warnings: string[] = [];
    const requiredSprints: RequiredSprintEvidence[] = sprints.map((sprint) => {
      const execution = latestExecutionBySprintId.get(sprint.id) ?? null;
      const acceptance = latestAcceptanceBySprintId.get(sprint.id) ?? null;

      if (
        acceptance?.status === SprintAcceptanceStatus.ACCEPTED &&
        (acceptance.recommendation ===
          SprintAcceptanceRecommendation.NEEDS_ATTENTION ||
          acceptance.recommendation === SprintAcceptanceRecommendation.REJECT)
      ) {
        warnings.push(
          `Sprint ${sprint.number} (${sprint.title}) was accepted despite an AI review recommendation of ${acceptance.recommendation}.`,
        );
      }

      return {
        sprintId: sprint.id,
        number: sprint.number,
        title: sprint.title,
        status: sprint.status,
        sprintExecutionId: execution?.id ?? null,
        sprintExecutionAttempt: execution?.attempt ?? null,
        repositoryEndSha: execution?.repositoryEndSha ?? null,
        completedAt: execution?.completedAt?.toISOString() ?? null,
        acceptanceVersion: acceptance?.version ?? null,
        acceptanceStatus: acceptance?.status ?? null,
      };
    });

    const tasks = await this.prisma.task.findMany({
      where: { sprintPlanId },
      orderBy: { order: 'asc' },
    });
    const taskIds = tasks.map((t) => t.id);

    const latestTaskExecutionByTaskId = await this.loadLatest(
      taskIds,
      (ids) =>
        this.prisma.taskExecution.findMany({
          where: { taskId: { in: ids } },
          orderBy: { attempt: 'desc' },
        }),
      (row) => row.taskId,
    );

    const latestValidationAttemptByTaskId = await this.loadLatest(
      taskIds,
      (ids) =>
        this.prisma.validationAttempt.findMany({
          where: { taskId: { in: ids } },
          orderBy: { attempt: 'desc' },
          include: { runs: true },
        }),
      (row) => row.taskId,
    );

    const taskSummary = this.buildTaskSummary(tasks);

    const acceptedSprintIds = new Set(
      requiredSprints
        .filter((s) => s.acceptanceStatus === SprintAcceptanceStatus.ACCEPTED)
        .map((s) => s.sprintId),
    );
    const requirementCoverage = this.buildRequirementCoverage(
      tasks,
      acceptedSprintIds,
      projectAnalysis.functionalRequirements as Array<{
        id: string;
        title: string;
      }>,
    );

    const validationSummary = this.buildValidationSummary(
      Array.from(latestValidationAttemptByTaskId.values()),
    );

    const commitSummary = this.buildCommitSummary(
      tasks,
      latestTaskExecutionByTaskId,
    );

    const usageSummary = await this.buildUsageSummary(projectId);

    const workspace = await this.buildWorkspaceSnapshot(projectId);

    const resolvedFinalSha = this.resolveAuthoritativeFinalSha(requiredSprints);

    const evidence: ProjectDeliveryEvidence = {
      project: { id: project.id, name: project.name },
      sprintPlan: { id: sprintPlan.id, version: sprintPlan.version },
      projectAnalysis: {
        id: projectAnalysis.id,
        version: projectAnalysis.version,
      },
      requiredSprints,
      requirementCoverage,
      taskSummary,
      validationSummary,
      commitSummary,
      usageSummary,
      warnings,
      workspace: {
        clean: workspace.clean,
        headCommitSha: workspace.headCommitSha,
        branch: workspace.branch,
      },
      resolvedFinalSha,
    };

    return { evidence, liveHeadSha: workspace.headCommitSha };
  }

  // Batched "latest row per key" load, no N+1 — same pattern as
  // SprintAcceptanceEvidenceBuilder's own per-Task lookups, generalized so
  // it can serve both per-Sprint and per-Task callers here.
  private async loadLatest<TRow, TKey>(
    ids: string[],
    fetch: (ids: string[]) => Promise<TRow[]>,
    keyOf: (row: TRow) => TKey,
  ): Promise<Map<TKey, TRow>> {
    const rows = ids.length === 0 ? [] : await fetch(ids);
    const byKey = new Map<TKey, TRow>();
    for (const row of rows) {
      const key = keyOf(row);
      if (!byKey.has(key)) {
        byKey.set(key, row);
      }
    }
    return byKey;
  }

  private buildTaskSummary(
    tasks: { key: string; status: TaskStatus }[],
  ): TaskDeliverySummary {
    const passed = tasks.filter((t) => t.status === TaskStatus.PASSED);
    return {
      totalTasks: tasks.length,
      passedTasks: passed.length,
      nonPassedTaskKeys: tasks
        .filter((t) => t.status !== TaskStatus.PASSED)
        .map((t) => t.key),
    };
  }

  private buildRequirementCoverage(
    tasks: {
      id: string;
      key: string;
      sprintId: string;
      status: TaskStatus;
      requirementIds: unknown;
    }[],
    acceptedSprintIds: Set<string>,
    functionalRequirements: Array<{ id: string; title: string }>,
  ): RequirementDeliveryCoverageEntry[] {
    return functionalRequirements.map((fr) => {
      const owningTasks = tasks.filter((t) =>
        ((t.requirementIds as string[]) ?? []).includes(fr.id),
      );
      // Delivered coverage (item's "requirement delivery coverage as
      // runtime evidence"): a Task must have actually PASSED, in a Sprint
      // that was formally ACCEPTED — original SprintPlan-time coverage
      // claims are never trusted on their own.
      const covered = owningTasks.some(
        (t) =>
          t.status === TaskStatus.PASSED && acceptedSprintIds.has(t.sprintId),
      );
      return {
        requirementId: fr.id,
        title: fr.title,
        covered,
        taskKeys: owningTasks.map((t) => t.key),
      };
    });
  }

  private buildValidationSummary(
    attempts: { runs: { required: boolean; status: string }[] }[],
  ): ValidationDeliverySummary {
    let totalChecks = 0;
    let requiredPassed = 0;
    let requiredFailed = 0;
    let optionalPassed = 0;
    let optionalFailed = 0;

    for (const attempt of attempts) {
      for (const run of attempt.runs) {
        totalChecks += 1;
        if (run.required) {
          if (run.status === 'PASSED') requiredPassed += 1;
          else if (run.status === 'FAILED') requiredFailed += 1;
        } else {
          if (run.status === 'PASSED') optionalPassed += 1;
          else if (run.status === 'FAILED') optionalFailed += 1;
        }
      }
    }

    return {
      totalChecks,
      requiredPassed,
      requiredFailed,
      optionalPassed,
      optionalFailed,
    };
  }

  private buildCommitSummary(
    tasks: { id: string; order: number }[],
    latestExecutionByTaskId: Map<string, { commitSha: string | null }>,
  ): CommitDeliverySummary {
    // Tasks are already ordered by `order` within the plan (item's
    // chronological-enough proxy — the real chronology is each
    // TaskExecution's own completedAt, but Task.order tracks planned
    // sequence, which is what commits were produced against).
    const commitShas = tasks
      .map((t) => latestExecutionByTaskId.get(t.id)?.commitSha ?? null)
      .filter((sha): sha is string => sha !== null);

    return {
      totalCommits: commitShas.length,
      firstCommitSha: commitShas[0] ?? null,
      lastCommitSha: commitShas[commitShas.length - 1] ?? null,
    };
  }

  // Read-only aggregation of every prior sprint's own AI-generation usage
  // (Sprint 17 itself never calls a provider — item 49/158). Nulls treated
  // as 0; USER_EDITED versions and failed attempts naturally contribute 0.
  private async buildUsageSummary(
    projectId: string,
  ): Promise<UsageDeliverySummary> {
    const [
      analyses,
      architectures,
      sprintPlans,
      taskInstructions,
      agentJobs,
      sprintAcceptances,
    ] = await Promise.all([
      this.prisma.projectAnalysis.findMany({
        where: { projectId },
        select: { inputTokens: true, outputTokens: true, totalTokens: true },
      }),
      this.prisma.architecture.findMany({
        where: { projectId },
        select: { inputTokens: true, outputTokens: true, totalTokens: true },
      }),
      this.prisma.sprintPlan.findMany({
        where: { projectId },
        select: { inputTokens: true, outputTokens: true, totalTokens: true },
      }),
      this.prisma.taskInstruction.findMany({
        where: { projectId },
        select: { inputTokens: true, outputTokens: true, totalTokens: true },
      }),
      this.prisma.agentJob.findMany({
        where: { projectId },
        select: { inputTokens: true, outputTokens: true },
      }),
      this.prisma.sprintAcceptance.findMany({
        where: { projectId },
        select: { inputTokens: true, outputTokens: true, totalTokens: true },
      }),
    ]);

    const categories: UsageByCategory[] = [
      this.sumCategory('project_analysis', analyses),
      this.sumCategory('architecture', architectures),
      this.sumCategory('sprint_plan', sprintPlans),
      this.sumCategory('task_instruction', taskInstructions),
      this.sumCategory('coding_agent', agentJobs),
      this.sumCategory('sprint_acceptance', sprintAcceptances),
    ];

    return {
      totalInputTokens: categories.reduce((sum, c) => sum + c.inputTokens, 0),
      totalOutputTokens: categories.reduce((sum, c) => sum + c.outputTokens, 0),
      totalTokens: categories.reduce((sum, c) => sum + c.totalTokens, 0),
      byCategory: categories,
    };
  }

  private sumCategory(
    category: string,
    rows: {
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens?: number | null;
    }[],
  ): UsageByCategory {
    const inputTokens = rows.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0);
    const outputTokens = rows.reduce(
      (sum, r) => sum + (r.outputTokens ?? 0),
      0,
    );
    // AgentJob has no stored totalTokens column — derive it rather than
    // reading a field that doesn't exist.
    const totalTokens = rows.reduce(
      (sum, r) =>
        sum + (r.totalTokens ?? (r.inputTokens ?? 0) + (r.outputTokens ?? 0)),
      0,
    );
    return { category, inputTokens, outputTokens, totalTokens };
  }

  // The authoritative final SHA (items 21/22): among required Sprints whose
  // execution actually COMPLETED, the repositoryEndSha of the one whose
  // execution finished last — never a naive "last Sprint in array order"
  // read, since Sprint dependency order and Sprint.order do not guarantee
  // execution order matches array order.
  private resolveAuthoritativeFinalSha(
    requiredSprints: RequiredSprintEvidence[],
  ): string | null {
    const completed = requiredSprints
      .filter((s) => s.completedAt !== null && s.repositoryEndSha !== null)
      .sort(
        (a, b) =>
          new Date(a.completedAt as string).getTime() -
          new Date(b.completedAt as string).getTime(),
      );
    return completed[completed.length - 1]?.repositoryEndSha ?? null;
  }

  private async buildWorkspaceSnapshot(projectId: string): Promise<{
    clean: boolean | null;
    headCommitSha: string | null;
    branch: string | null;
  }> {
    try {
      const workspacePath =
        await this.workspaceService.getReadyWorkspacePath(projectId);
      const [status, headCommitSha, branch] = await Promise.all([
        this.git.getStatus(workspacePath),
        this.git.getHeadCommitSha(workspacePath),
        this.git.getCurrentBranch(workspacePath),
      ]);
      return { clean: status.clean, headCommitSha, branch };
    } catch {
      return { clean: null, headCommitSha: null, branch: null };
    }
  }
}
